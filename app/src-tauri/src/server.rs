//! Serveur local qui reçoit les hooks de Claude Code (`curl localhost:4242/<Event>`) et les relaie au front.
//! Il n'accepte que les requêtes qui portent le secret du pet : sans lui, n'importe quelle page web ouverte dans un navigateur
//! pourrait poster vers `localhost` et faire dire ce qu'elle veut au pet (un en-tête personnalisé force en plus une requête
//! préalable CORS que ce serveur ne valide jamais).
use crate::setup::{token, EVENTS};
use std::io::Read;
use tauri::Emitter;

const MAX_BODY: usize = 4 * 1024 * 1024;
const HOSTS: [&str; 2] = ["localhost:4242", "127.0.0.1:4242"];

/// Compare sans s'arrêter au premier octet différent.
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Décide si une requête est acceptée. Retourne le code HTTP de refus sinon.
/// `Host` est vérifié contre le rebinding DNS : un site malveillant dont le nom pointerait vers 127.0.0.1 enverrait son propre nom.
fn authorize(is_post: bool, host: Option<&str>, secret: Option<&str>, content_length: Option<usize>, event: &str, expected: &str) -> Result<(), u16> {
    if !is_post {
        return Err(405);
    }
    if !host.is_some_and(|h| HOSTS.contains(&h)) || !secret.is_some_and(|s| same_secret(s, expected)) {
        return Err(403);
    }
    if !EVENTS.contains(&event) {
        return Err(404);
    }
    if content_length.is_some_and(|n| n > MAX_BODY) {
        return Err(413);
    }
    Ok(())
}

pub fn listen(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Ok(server) = tiny_http::Server::http("127.0.0.1:4242") else {
            eprintln!("port 4242 déjà pris : le pet ne recevra pas les hooks");
            return;
        };
        let expected = token();
        for mut req in server.incoming_requests() {
            let header = |name: &'static str| req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str().to_owned());
            let event = req.url().trim_start_matches('/').to_string();
            let verdict = authorize(
                *req.method() == tiny_http::Method::Post,
                header("Host").as_deref(),
                header("X-Pet-Token").as_deref(),
                req.body_length(),
                &event,
                &expected,
            );
            if let Err(code) = verdict {
                let _ = req.respond(tiny_http::Response::empty(code));
                continue;
            }
            let mut body = String::new();
            let _ = req.as_reader().take(MAX_BODY as u64).read_to_string(&mut body);
            let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
            let _ = app.emit(
                "hook",
                serde_json::json!({ "event": event, "session": v["session_id"], "cwd": v["cwd"], "tool": v["tool_name"], "message": v["last_assistant_message"] }),
            );
            let _ = req.respond(tiny_http::Response::empty(200));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "0123456789abcdef0123456789abcdef";
    const OK_HOST: Option<&str> = Some("localhost:4242");

    fn check(is_post: bool, host: Option<&str>, secret: Option<&str>, len: Option<usize>, event: &str) -> Result<(), u16> {
        authorize(is_post, host, secret, len, event, SECRET)
    }

    #[test]
    fn a_valid_hook_is_accepted() {
        assert_eq!(check(true, OK_HOST, Some(SECRET), Some(1200), "Stop"), Ok(()));
        assert_eq!(check(true, Some("127.0.0.1:4242"), Some(SECRET), None, "PreToolUse"), Ok(()));
    }

    #[test]
    fn a_missing_or_wrong_secret_is_refused() {
        assert_eq!(check(true, OK_HOST, None, Some(10), "Stop"), Err(403));
        assert_eq!(check(true, OK_HOST, Some("fedcba9876543210fedcba9876543210"), Some(10), "Stop"), Err(403));
        assert_eq!(check(true, OK_HOST, Some(""), Some(10), "Stop"), Err(403));
        assert_eq!(check(true, OK_HOST, Some(&SECRET[..31]), Some(10), "Stop"), Err(403), "un préfixe du secret ne suffit pas");
    }

    #[test]
    fn a_foreign_host_is_refused_even_with_the_secret() {
        for host in [None, Some("evil.com"), Some("localhost"), Some("localhost.evil.com:4242"), Some("localhost:4243"), Some("10.0.0.2:4242")] {
            assert_eq!(check(true, host, Some(SECRET), Some(10), "Stop"), Err(403), "{host:?}");
        }
    }

    #[test]
    fn only_post_is_accepted() {
        assert_eq!(check(false, OK_HOST, Some(SECRET), None, "Stop"), Err(405));
    }

    #[test]
    fn unknown_events_are_refused() {
        for event in ["", "Nope", "stop", "../etc/passwd", "Stop/extra"] {
            assert_eq!(check(true, OK_HOST, Some(SECRET), Some(10), event), Err(404), "{event:?}");
        }
    }

    #[test]
    fn oversized_bodies_are_refused() {
        assert_eq!(check(true, OK_HOST, Some(SECRET), Some(MAX_BODY), "Stop"), Ok(()));
        assert_eq!(check(true, OK_HOST, Some(SECRET), Some(MAX_BODY + 1), "Stop"), Err(413));
    }

    #[test]
    fn the_secret_comparison_checks_every_byte() {
        assert!(same_secret(SECRET, SECRET));
        assert!(!same_secret(SECRET, "0123456789abcdef0123456789abcdee"));
        assert!(!same_secret(SECRET, "1123456789abcdef0123456789abcdef"));
    }
}
