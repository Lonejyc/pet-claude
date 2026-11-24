//! Mini-chat : pose une question à Claude Code dans une COPIE de la session choisie (`--resume --fork-session`),
//! en lecture seule, et renvoie le texte au fil de l'eau au front (événement "chat").
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::Emitter;

const PERSONA: &str = "Tu es le petit pet de l'utilisateur, une créature-bloc orange qui vit sur son bureau. \
Réponds en français, en 2 phrases courtes maximum (140 caractères au total), sans markdown ni liste, \
sur un ton malicieux mais utile. Exception : si on te demande du code ou une commande, donne-le dans un court bloc ```, en plus de ta phrase. Tu peux lire le code du projet pour répondre, mais tu ne modifies rien.";

/// Sans session ouverte, le pet n'a aucun dossier à lire : il répond aux questions générales et renvoie vers un terminal pour le reste.
const NO_SESSION: &str = "Ici, aucune session Claude Code n'est ouverte et tu n'as accès à aucun fichier. \
Si la question porte sur des fichiers, du code ou un dossier précis, réponds poliment qu'il faut d'abord ouvrir Claude Code \
dans un terminal, dans ce dossier. Sinon, réponds normalement.";

/// Sans session mais avec un fichier déposé sur le pet : seul ce fichier est lisible.
const ATTACHMENT_ONLY: &str = "Un fichier joint t'est fourni : lis-le avec Read pour répondre, mais n'en lis aucun autre.";

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
            .and_then(|out| out.lines().map(str::trim).rfind(|l| l.starts_with('/')).map(String::from))
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

/// Copie un texte dans le presse-papiers via `pbcopy` (fiable dans une fenêtre non activante, contrairement à l'API web). 100 Ko maximum.
#[tauri::command]
pub fn copy_text(text: String) -> bool {
    use std::io::Write;
    if text.len() > 100_000 {
        return false;
    }
    let Ok(mut child) = Command::new("/usr/bin/pbcopy").stdin(Stdio::piped()).spawn() else { return false };
    let wrote = child.stdin.take().is_some_and(|mut s| s.write_all(text.as_bytes()).is_ok());
    child.wait().is_ok_and(|s| s.success()) && wrote
}

#[tauri::command]
pub fn ask(app: tauri::AppHandle, id: String, question: String, resume: Option<String>, cwd: Option<String>, fork: String, attach: Option<String>) {
    std::thread::spawn(move || {
        let emit = |kind: &str, text: &str| {
            let _ = app.emit("chat", serde_json::json!({ "id": id, "kind": kind, "text": text }));
        };
        // une question qui commencerait par "-" serait prise pour une option
        let question = if question.starts_with('-') { format!("Question : {question}") } else { question };
        let attach = attach.filter(|p| Path::new(p).is_absolute() && Path::new(p).is_file());
        let (tools, persona) = match (&resume, &attach) {
            (Some(_), _) => ("Read,Grep,Glob", PERSONA.to_string()),
            (None, Some(_)) => ("Read", format!("{PERSONA} {ATTACHMENT_ONLY}")),
            (None, None) => ("", format!("{PERSONA} {NO_SESSION}")), // "" : aucun outil
        };
        // pièce jointe déposée sur le pet : son chemin est donné à Claude, qui la lit avec Read ; son dossier est rendu lisible pour cette seule requête
        let question = match &attach {
            Some(path) => format!("{question}\n\nFichier joint : {path}"),
            None => question,
        };
        let mut cmd = Command::new(claude_path());
        // la question doit venir juste après -p : --tools accepte plusieurs valeurs et avalerait un argument positionnel placé après
        cmd.args(["-p", &question, "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
            .args(["--tools", tools, "--append-system-prompt", &persona, "--session-id", &fork]);
        if let Some(session) = &resume {
            cmd.args(["--resume", session, "--fork-session"]);
        }
        if let Some(dir) = attach.as_deref().and_then(|p| Path::new(p).parent()) {
            cmd.arg("--add-dir").arg(dir);
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
