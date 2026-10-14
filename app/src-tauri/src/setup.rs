//! Configuration du pet sur la machine : hooks Claude Code, personnalité globale, lancement au démarrage, réglages.
//! Utilisé par la fenêtre de réglages ET par la ligne de commande (`app --install-hooks`, appelée par l'installateur .pkg).
use serde_json::{json, Map, Value};
use std::path::PathBuf;

const EVENTS: [&str; 5] = ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUseFailure", "Stop"];
const HOOK_PREFIX: &str = "curl -s -m 1 --data-binary @- localhost:4242/";
const STYLE_MD: &str = include_str!("../../../.claude/output-styles/pet.md");

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").expect("HOME non défini"))
}
fn claude_settings_path() -> PathBuf {
    home().join(".claude/settings.json")
}
fn hook_command(event: &str) -> String {
    format!("{HOOK_PREFIX}{event} || true")
}
fn is_ours(command: &str) -> bool {
    command.starts_with(HOOK_PREFIX)
}

fn read_claude_settings() -> Result<Value, String> {
    match std::fs::read_to_string(claude_settings_path()) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("~/.claude/settings.json illisible : {e}")),
        Err(_) => Ok(json!({})),
    }
}

fn write_claude_settings(settings: &Value) -> Result<(), String> {
    let path = claude_settings_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    // sauvegarde unique, avant la toute première modification
    let backup = path.with_file_name("settings.json.bak-pet-claude");
    if path.exists() && !backup.exists() {
        std::fs::copy(&path, &backup).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())? + "\n";
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// Les hooks qui appartiennent au pet, par événement.
fn our_events(settings: &Value) -> Vec<&'static str> {
    EVENTS
        .iter()
        .copied()
        .filter(|ev| {
            settings["hooks"][ev].as_array().is_some_and(|groups| {
                groups.iter().any(|g| g["hooks"].as_array().is_some_and(|hs| hs.iter().any(|h| h["command"].as_str().is_some_and(is_ours))))
            })
        })
        .collect()
}

pub fn hooks_installed() -> bool {
    read_claude_settings().map(|s| our_events(&s).len() == EVENTS.len()).unwrap_or(false)
}

pub fn set_hooks(on: bool) -> Result<(), String> {
    let mut settings = read_claude_settings()?;
    let root = settings.as_object_mut().ok_or("~/.claude/settings.json n'est pas un objet JSON")?;
    let hooks = root.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
    let hooks = hooks.as_object_mut().ok_or("« hooks » n'est pas un objet")?;
    for ev in EVENTS {
        let groups = hooks.entry(ev).or_insert_with(|| json!([]));
        let groups = groups.as_array_mut().ok_or("une liste de hooks est invalide")?;
        // on retire d'abord les nôtres (pas de doublon, et c'est la désinstallation), puis on rajoute
        groups.retain(|g| !g["hooks"].as_array().is_some_and(|hs| hs.iter().any(|h| h["command"].as_str().is_some_and(is_ours))));
        if on {
            groups.push(json!({ "hooks": [{ "type": "command", "command": hook_command(ev) }] }));
        }
    }
    hooks.retain(|_, v| v.as_array().is_none_or(|a| !a.is_empty()));
    if hooks.is_empty() {
        root.remove("hooks");
    }
    write_claude_settings(&settings)
}

pub fn style_enabled() -> bool {
    read_claude_settings().map(|s| s["outputStyle"] == "Pet").unwrap_or(false)
}

pub fn set_style(on: bool) -> Result<(), String> {
    let mut settings = read_claude_settings()?;
    let root = settings.as_object_mut().ok_or("~/.claude/settings.json n'est pas un objet JSON")?;
    if on {
        let dir = home().join(".claude/output-styles");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("pet.md"), STYLE_MD).map_err(|e| e.to_string())?;
        root.insert("outputStyle".into(), json!("Pet"));
    } else if root.get("outputStyle") == Some(&json!("Pet")) {
        root.remove("outputStyle");
    }
    write_claude_settings(&settings)
}

fn login_plist() -> PathBuf {
    home().join("Library/LaunchAgents/fr.perso.petclaude.plist")
}

pub fn login_enabled() -> bool {
    login_plist().exists()
}

/// Le plist ne prend effet qu'à la prochaine ouverture de session : on ne le charge pas maintenant, ça lancerait une 2e instance.
pub fn set_login(on: bool) -> Result<(), String> {
    let plist = login_plist();
    if !on {
        let _ = std::fs::remove_file(plist);
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy();
    if !exe.contains(".app/Contents/MacOS/") {
        return Err("lancement au démarrage impossible depuis une version de développement : installe l'app d'abord".into());
    }
    std::fs::create_dir_all(plist.parent().unwrap()).map_err(|e| e.to_string())?;
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>fr.perso.petclaude</string>
  <key>ProgramArguments</key><array><string>{exe}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
"#
    );
    std::fs::write(plist, xml).map_err(|e| e.to_string())
}

// ---- réglages du pet (fichier JSON dans le dossier de données de l'app)

fn settings_path() -> PathBuf {
    home().join("Library/Application Support/fr.perso.petclaude/settings.json")
}

fn default_settings() -> Value {
    json!({ "cooldownSec": 12, "sleepAfterSec": 60, "confetti": true, "sound": true, "volume": 1.0 })
}

pub fn read_settings() -> Value {
    let mut merged = default_settings();
    if let Some(stored) = std::fs::read_to_string(settings_path()).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        for (k, v) in stored.as_object().into_iter().flatten() {
            if merged.get(k).is_some() {
                merged[k] = v.clone();
            }
        }
    }
    merged
}

pub fn write_settings(settings: &Value) -> Result<(), String> {
    let path = settings_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

// ---- ligne de commande : `app --install-hooks` etc. Retourne true si une commande a été exécutée (l'app ne doit alors pas démarrer).

pub fn run_cli() -> bool {
    let Some(flag) = std::env::args().nth(1).filter(|a| a.starts_with("--")) else { return false };
    let result = match flag.as_str() {
        "--install-hooks" => set_hooks(true),
        "--remove-hooks" => set_hooks(false),
        "--enable-style" => set_style(true),
        "--disable-style" => set_style(false),
        "--enable-login" => set_login(true),
        "--disable-login" => set_login(false),
        "--status" => {
            println!("hooks={} style={} login={}", hooks_installed(), style_enabled(), login_enabled());
            Ok(())
        }
        _ => return false,
    };
    match result {
        Ok(()) => println!("ok"),
        Err(e) => {
            eprintln!("erreur : {e}");
            std::process::exit(1);
        }
    }
    true
}
