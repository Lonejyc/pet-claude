//! Demandes de permission de Claude Code (hook `PermissionRequest`) : le serveur retient la requête HTTP du hook,
//! le pet affiche « Autoriser / Refuser » et la réponse part vers Claude seulement après un clic (commande `decide`, appelée par l'interface).
//! Aucune route HTTP ne permet d'approuver : un processus local ne peut pas s'auto-autoriser. Sans réponse à temps, le corps est vide
//! et Claude retombe sur sa boîte de dialogue normale : le pet ne dit JAMAIS « oui » par défaut. Cf. docs/spike-permissions.md.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

pub const EVENT: &str = "PermissionRequest";
/// Délai laissé à l'utilisateur ; le hook de Claude coupe à 30 s (cf. setup.rs), donc on répond avant lui.
pub const WAIT: Duration = Duration::from_secs(20);

static PENDING: Mutex<Option<HashMap<u64, Sender<bool>>>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(1);

/// Enregistre une demande en attente ; l'identifiant part vers l'interface, qui le renvoie dans `decide`.
fn register() -> (u64, Receiver<bool>) {
    let (tx, rx) = channel();
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    PENDING.lock().unwrap().get_or_insert_with(HashMap::new).insert(id, tx);
    (id, rx)
}

/// Attend la décision ; la demande est retirée dans tous les cas (un clic tardif ne trouve plus rien).
fn wait(id: u64, rx: &Receiver<bool>, timeout: Duration) -> Option<bool> {
    let decision = rx.recv_timeout(timeout).ok();
    if let Some(map) = PENDING.lock().unwrap().as_mut() {
        map.remove(&id);
    }
    decision
}

/// Appelée par l'interface au clic. Faux si la demande a expiré ou n'existe pas.
#[tauri::command]
pub fn decide(id: u64, allow: bool) -> bool {
    let tx = PENDING.lock().unwrap().as_mut().and_then(|m| m.remove(&id));
    tx.is_some_and(|tx| tx.send(allow).is_ok())
}

/// Corps renvoyé au hook (stdout du `curl`). `None` = aucune décision : corps vide, Claude demande lui-même.
/// Seuls `behavior` et `message` sont utilisés : le pet ne réécrit pas la commande et ne touche pas aux règles de permission.
fn response_body(decision: Option<bool>) -> Option<String> {
    let d = match decision? {
        true => serde_json::json!({ "behavior": "allow" }),
        false => serde_json::json!({ "behavior": "deny", "message": "Refusé depuis le pet" }),
    };
    Some(serde_json::json!({ "hookSpecificOutput": { "hookEventName": EVENT, "decision": d } }).to_string())
}

/// Traite une demande dans son propre thread (le serveur ne doit pas rester bloqué pendant l'attente).
pub fn serve(app: tauri::AppHandle, req: tiny_http::Request, payload: serde_json::Value) {
    // pet masqué : personne ne verrait la bulle, on rend la main tout de suite à la boîte de dialogue du terminal
    if crate::native::HIDDEN.load(Ordering::Relaxed) {
        let _ = req.respond(tiny_http::Response::empty(200));
        return;
    }
    let (id, rx) = register();
    let _ = app.emit(
        "permission",
        serde_json::json!({
            "id": id, "session": payload["session_id"], "cwd": payload["cwd"], "tool": payload["tool_name"],
            "input": payload["tool_input"], "timeoutMs": WAIT.as_millis() as u64,
        }),
    );
    match response_body(wait(id, &rx, WAIT)) {
        Some(body) => {
            let _ = req.respond(tiny_http::Response::from_string(body));
        }
        None => {
            let _ = req.respond(tiny_http::Response::empty(200));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_and_deny_produce_the_exact_format_claude_expects() {
        let allow: serde_json::Value = serde_json::from_str(&response_body(Some(true)).unwrap()).unwrap();
        assert_eq!(allow, serde_json::json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }));
        let deny: serde_json::Value = serde_json::from_str(&response_body(Some(false)).unwrap()).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert!(deny["hookSpecificOutput"]["decision"]["message"].is_string());
    }

    #[test]
    fn no_decision_means_an_empty_body_never_an_allow() {
        assert_eq!(response_body(None), None);
    }

    #[test]
    fn a_click_reaches_the_waiting_request_once() {
        let (id, rx) = register();
        assert!(decide(id, true));
        assert_eq!(wait(id, &rx, Duration::from_secs(1)), Some(true));
        assert!(!decide(id, false), "une demande n'est décidée qu'une fois");
    }

    #[test]
    fn a_denial_is_delivered_as_a_denial() {
        let (id, rx) = register();
        assert!(decide(id, false));
        assert_eq!(wait(id, &rx, Duration::from_secs(1)), Some(false));
    }

    #[test]
    fn an_expired_request_gives_no_decision_and_a_late_click_is_refused() {
        let (id, rx) = register();
        assert_eq!(wait(id, &rx, Duration::from_millis(30)), None);
        assert!(!decide(id, true), "le clic tardif ne doit rien autoriser");
    }

    #[test]
    fn unknown_ids_are_refused() {
        assert!(!decide(u64::MAX, true));
    }
}
