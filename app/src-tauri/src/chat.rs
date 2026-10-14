//! Mini-chat : pose une question à Claude Code dans une COPIE de la session choisie (`--resume --fork-session`),
//! en lecture seule, et renvoie le texte au fil de l'eau au front (événement "chat").
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::Emitter;

const PERSONA: &str = "Tu es le petit pet de l'utilisateur, une créature-bloc orange qui vit sur son bureau. \
Réponds en français, en 2 phrases courtes maximum (140 caractères au total), sans markdown ni liste, \
sur un ton malicieux mais utile. Tu peux lire le code du projet pour répondre, mais tu ne modifies rien.";

/// Une app lancée depuis le Finder n'a pas le PATH du terminal : on demande son chemin au shell de connexion (une seule fois).
fn claude_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        Command::new(shell)
            .args(["-lic", "command -v claude"])
            .stderr(Stdio::null())
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|out| out.lines().map(str::trim).filter(|l| l.starts_with('/')).last().map(String::from))
            .unwrap_or_else(|| "claude".into())
    })
}

/// La copie de session n'a plus d'utilité une fois la réponse reçue (chaque question refait une copie de l'original) :
/// on supprime son transcript pour ne rien laisser dans ~/.claude/projects.
fn remove_fork_files(fork: &str) {
    let is_uuid = fork.len() == 36 && fork.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    let (true, Some(home)) = (is_uuid, std::env::var_os("HOME")) else { return };
    let Ok(projects) = std::fs::read_dir(Path::new(&home).join(".claude/projects")) else { return };
    for dir in projects.flatten() {
        let _ = std::fs::remove_file(dir.path().join(format!("{fork}.jsonl")));
        let _ = std::fs::remove_dir_all(dir.path().join(fork));
    }
}

#[tauri::command]
pub fn ask(app: tauri::AppHandle, id: String, question: String, resume: Option<String>, cwd: Option<String>, fork: String) {
    std::thread::spawn(move || {
        let emit = |kind: &str, text: &str| {
            let _ = app.emit("chat", serde_json::json!({ "id": id, "kind": kind, "text": text }));
        };
        // une question qui commencerait par "-" serait prise pour une option
        let question = if question.starts_with('-') { format!("Question : {question}") } else { question };
        let mut cmd = Command::new(claude_path());
        // la question doit venir juste après -p : --tools accepte plusieurs valeurs et avalerait un argument positionnel placé après
        cmd.args(["-p", &question, "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
            .args(["--tools", "Read,Grep,Glob", "--append-system-prompt", PERSONA, "--session-id", &fork]);
        if let Some(session) = &resume {
            cmd.args(["--resume", session, "--fork-session"]);
        }
        if let Some(dir) = cwd.filter(|d| Path::new(d).is_dir()) {
            cmd.current_dir(dir);
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                remove_fork_files(&fork);
                return emit("error", &format!("impossible de lancer claude : {e}"));
            }
        };
        for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            if v["type"] == "stream_event" && v["event"]["delta"]["type"] == "text_delta" {
                emit("delta", v["event"]["delta"]["text"].as_str().unwrap_or(""));
            } else if v["type"] == "result" && v["is_error"] == true {
                emit("error", v["result"].as_str().unwrap_or("erreur inconnue"));
            }
        }
        let _ = child.wait();
        remove_fork_files(&fork);
        emit("done", "");
    });
}
