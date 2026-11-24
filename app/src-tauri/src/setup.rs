//! Configuration du pet sur la machine : hooks Claude Code, lancement au démarrage, réglages, secret.
//! Utilisé par la fenêtre de réglages ET par la ligne de commande (`app --install-hooks`, appelée par l'installateur .pkg).
//! Toutes les fonctions `*_in` prennent le dossier personnel en paramètre : c'est ce qui permet de les tester sur un faux dossier.
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub const IDENTIFIER: &str = "io.github.lonejyc.pet-claude";
const LEGACY_IDENTIFIER: &str = "fr.perso.petclaude"; // identifiant des betas 1 et 2, migré au démarrage
pub const EVENTS: [&str; 9] = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "PermissionRequest", "Stop"];

fn real_home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").expect("HOME non défini"))
}
fn claude_settings_path(home: &Path) -> PathBuf {
    home.join(".claude/settings.json")
}
fn support_dir(home: &Path, id: &str) -> PathBuf {
    home.join("Library/Application Support").join(id)
}

/// Écriture atomique : fichier temporaire puis renommage, avec les permissions de l'original.
/// Un arrêt en plein milieu ne peut jamais laisser un fichier tronqué.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("chemin invalide")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp-pet-claude");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

// ---- secret partagé : seuls les hooks qui le connaissent sont acceptés par le pet (cf. lib.rs)

pub fn token() -> String {
    token_in(&real_home())
}

fn token_in(home: &Path) -> String {
    use std::io::Read;
    use std::os::unix::fs::PermissionsExt;
    let path = support_dir(home, IDENTIFIER).join("token");
    if let Some(t) = std::fs::read_to_string(&path).ok().map(|t| t.trim().to_string()).filter(|t| t.len() == 32) {
        return t;
    }
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).expect("/dev/urandom illisible");
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let _ = write_atomic(&path, &token);
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    token
}

// ---- hooks Claude Code

fn hook_command(event: &str, token: &str) -> String {
    // le hook des permissions attend la décision de l'utilisateur : délai plus long (cf. permission.rs, WAIT = 20 s)
    let secs = if event == "PermissionRequest" { 25 } else { 1 };
    format!("curl -s -m {secs} -H \"X-Pet-Token: {token}\" --data-binary @- localhost:4242/{event} || true")
}

/// Un hook est à nous s'il envoie vers le port du pet (y compris les anciens, sans secret, et celui des permissions, dont le délai est plus long).
fn is_ours(command: &str) -> bool {
    command.starts_with("curl -s -m ") && command.contains("localhost:4242/")
}

fn read_claude_settings(home: &Path) -> Result<Value, String> {
    match std::fs::read_to_string(claude_settings_path(home)) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("~/.claude/settings.json illisible, non modifié : {e}")),
        Err(_) => Ok(json!({})),
    }
}

fn write_claude_settings(home: &Path, settings: &Value) -> Result<(), String> {
    let path = claude_settings_path(home);
    // sauvegarde unique, avant la toute première modification
    let backup = path.with_file_name("settings.json.bak-pet-claude");
    if path.exists() && !backup.exists() {
        std::fs::copy(&path, &backup).map_err(|e| e.to_string())?;
    }
    write_atomic(&path, &(serde_json::to_string_pretty(settings).map_err(|e| e.to_string())? + "\n"))
}

/// Commandes de hooks du pet trouvées, par événement.
fn our_commands<'a>(settings: &'a Value, event: &str) -> Vec<&'a str> {
    settings["hooks"][event]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|g| g["hooks"].as_array().into_iter().flatten())
        .filter_map(|h| h["command"].as_str())
        .filter(|c| is_ours(c))
        .collect()
}

fn hooks_installed_in(home: &Path, token: &str) -> bool {
    let Ok(settings) = read_claude_settings(home) else { return false };
    EVENTS.iter().all(|ev| our_commands(&settings, ev) == [hook_command(ev, token).as_str()])
}

fn hooks_present_in(home: &Path) -> bool {
    read_claude_settings(home).is_ok_and(|s| EVENTS.iter().any(|ev| !our_commands(&s, ev).is_empty()))
}

fn set_hooks_in(home: &Path, token: &str, on: bool) -> Result<(), String> {
    let mut settings = read_claude_settings(home)?;
    let root = settings.as_object_mut().ok_or("~/.claude/settings.json n'est pas un objet JSON")?;
    let hooks = root.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
    let hooks = hooks.as_object_mut().ok_or("« hooks » n'est pas un objet")?;
    for ev in EVENTS {
        let groups = hooks.entry(ev).or_insert_with(|| json!([]));
        let groups = groups.as_array_mut().ok_or("une liste de hooks est invalide")?;
        // on retire d'abord les nôtres (pas de doublon, c'est aussi la désinstallation et la mise à jour du secret), puis on rajoute
        groups.retain(|g| !g["hooks"].as_array().is_some_and(|hs| hs.iter().any(|h| h["command"].as_str().is_some_and(is_ours))));
        if on {
            let mut hook = json!({ "type": "command", "command": hook_command(ev, token) });
            if ev == "PermissionRequest" {
                hook["timeout"] = json!(30); // sans cela, Claude attendrait jusqu'à 600 s si le pet ne répond jamais
            }
            groups.push(json!({ "hooks": [hook] }));
        }
    }
    hooks.retain(|_, v| v.as_array().is_none_or(|a| !a.is_empty()));
    if hooks.is_empty() {
        root.remove("hooks");
    }
    write_claude_settings(home, &settings)
}

pub fn hooks_installed() -> bool {
    let home = real_home();
    hooks_installed_in(&home, &token_in(&home))
}

pub fn set_hooks(on: bool) -> Result<(), String> {
    let home = real_home();
    set_hooks_in(&home, &token_in(&home), on)
}

/// Au démarrage : si des hooks du pet existent mais ne portent pas le secret actuel (anciennes versions, secret régénéré),
/// on les remet à jour, sinon le pet refuserait leurs événements. On ne touche à rien si l'utilisateur n'en a aucun.
pub fn refresh_hooks_if_outdated() {
    let home = real_home();
    let token = token_in(&home);
    if hooks_present_in(&home) && !hooks_installed_in(&home, &token)
        && let Err(e) = set_hooks_in(&home, &token, true) {
            eprintln!("mise à jour des hooks : {e}");
        }
}

// ---- lancement au démarrage

fn login_plist(home: &Path, id: &str) -> PathBuf {
    home.join("Library/LaunchAgents").join(format!("{id}.plist"))
}

pub fn login_enabled() -> bool {
    login_plist(&real_home(), IDENTIFIER).exists()
}

/// Le plist ne prend effet qu'à la prochaine ouverture de session : on ne le charge pas maintenant, ça lancerait une 2e instance.
pub fn set_login(on: bool) -> Result<(), String> {
    set_login_in(&real_home(), on, std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().as_ref())
}

fn set_login_in(home: &Path, on: bool, exe: &str) -> Result<(), String> {
    let _ = std::fs::remove_file(login_plist(home, LEGACY_IDENTIFIER)); // ancien agent des betas 1 et 2
    let plist = login_plist(home, IDENTIFIER);
    if !on {
        let _ = std::fs::remove_file(plist);
        return Ok(());
    }
    if !exe.contains(".app/Contents/MacOS/") {
        return Err("lancement au démarrage impossible depuis une version de développement : installe l'app d'abord".into());
    }
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{IDENTIFIER}</string>
  <key>ProgramArguments</key><array><string>{exe}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
"#
    );
    write_atomic(&plist, &xml)
}

// ---- réglages du pet (fichier JSON dans le dossier de données de l'app)

fn settings_path(home: &Path) -> PathBuf {
    support_dir(home, IDENTIFIER).join("settings.json")
}

fn default_settings() -> Value {
    json!({ "cooldownSec": 12, "sleepAfterSec": 60, "confetti": true, "sound": true, "soundMode": "all", "chatShortcut": "Control+Alt+Space", "stealth": true, "petScale": 1.0, "volume": 1.0, "emotes": false, "emoteEverySec": 30, "skinColor": "orange", "skinAccessory": "none" })
}

// ---- succès : compteurs locaux qui débloquent des accessoires (jamais envoyés nulle part)

const COUNTERS: [&str; 3] = ["files", "fixes", "cleanSessions"];

fn achievements_path(home: &Path) -> PathBuf {
    support_dir(home, IDENTIFIER).join("achievements.json")
}

/// Compteurs lus sur disque : seules les clés connues, des entiers positifs plafonnés (un fichier édité à la main ne casse rien).
fn read_achievements_in(home: &Path) -> Value {
    let stored: Value = std::fs::read_to_string(achievements_path(home)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    Value::Object(COUNTERS.iter().map(|k| (k.to_string(), json!(stored[k].as_u64().unwrap_or(0).min(1_000_000_000)))).collect())
}

fn write_achievements_in(home: &Path, counters: &Value) -> Result<(), String> {
    // même nettoyage qu'à la lecture
    let clean: Value = Value::Object(COUNTERS.iter().map(|k| (k.to_string(), json!(counters[k].as_u64().unwrap_or(0).min(1_000_000_000)))).collect());
    write_atomic(&achievements_path(home), &serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?)
}

pub fn read_achievements() -> Value {
    read_achievements_in(&real_home())
}

pub fn write_achievements(counters: &Value) -> Result<(), String> {
    write_achievements_in(&real_home(), counters)
}

pub fn read_settings() -> Value {
    let mut merged = default_settings();
    if let Some(stored) = std::fs::read_to_string(settings_path(&real_home())).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        for (k, v) in stored.as_object().into_iter().flatten() {
            // `christmas` n'a pas de valeur par défaut : absent = « selon la saison » (cf. christmas.ts)
            if merged.get(k).is_some() || k == "christmas" {
                merged[k] = v.clone();
            }
        }
    }
    merged
}

pub fn write_settings(settings: &Value) -> Result<(), String> {
    write_atomic(&settings_path(&real_home()), &serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?)
}

// ---- première ouverture (installation par glisser-déposer depuis le .dmg) : mêmes réglages que le .pkg avec ses cases cochées par défaut

fn configured_marker(home: &Path) -> PathBuf {
    support_dir(home, IDENTIFIER).join("configured")
}

pub fn mark_configured() -> Result<(), String> {
    write_atomic(&configured_marker(&real_home()), "")
}

/// Hooks Claude Code et lancement au démarrage activés à la toute première ouverture, une seule fois : on ne les remet jamais après un choix de l'utilisateur.
/// Rien n'est fait si l'app tourne depuis le .dmg ou un dossier de développement (le lancement au démarrage pointerait vers le disque monté),
/// ni si la machine a déjà une configuration (réglages enregistrés, hooks, lancement au démarrage : mise à jour d'une version antérieure).
fn first_run_in(home: &Path, exe: &str) -> Result<bool, String> {
    let installed = exe.starts_with("/Applications/") || exe.starts_with(&format!("{}/Applications/", home.display()));
    if !installed || !exe.contains(".app/Contents/MacOS/") || configured_marker(home).exists() {
        return Ok(false);
    }
    let already = settings_path(home).exists() || hooks_present_in(home) || login_plist(home, IDENTIFIER).exists();
    write_atomic(&configured_marker(home), "")?;
    if already {
        return Ok(false);
    }
    set_hooks_in(home, &token_in(home), true)?;
    set_login_in(home, true, exe)?;
    Ok(true)
}

pub fn apply_first_run_defaults() {
    let Ok(exe) = std::env::current_exe() else { return };
    if let Err(e) = first_run_in(&real_home(), &exe.to_string_lossy()) {
        eprintln!("première ouverture : {e}");
    }
}

// ---- migration depuis les betas 1 et 2 (ancien identifiant)

pub fn migrate_legacy() {
    migrate_legacy_in(&real_home(), std::env::current_exe().ok().map(|e| e.to_string_lossy().into_owned()).as_deref());
}

fn migrate_legacy_in(home: &Path, exe: Option<&str>) {
    let old_settings = settings_path_for(home, LEGACY_IDENTIFIER);
    if old_settings.exists() && !settings_path(home).exists()
        && let Ok(text) = std::fs::read_to_string(&old_settings) {
            let _ = write_atomic(&settings_path(home), &text);
        }
    // l'ancien agent de lancement est remplacé par le nouveau (le lancement au démarrage reste activé)
    if login_plist(home, LEGACY_IDENTIFIER).exists() {
        let _ = set_login_in(home, true, exe.unwrap_or(""));
        let _ = std::fs::remove_file(login_plist(home, LEGACY_IDENTIFIER));
    }
}

fn settings_path_for(home: &Path, id: &str) -> PathBuf {
    support_dir(home, id).join("settings.json")
}

// ---- ligne de commande : `app --install-hooks` etc. Retourne true si une commande a été exécutée (l'app ne doit alors pas démarrer).

pub fn run_cli() -> bool {
    let Some(flag) = std::env::args().nth(1).filter(|a| a.starts_with("--")) else { return false };
    let result = match flag.as_str() {
        "--install-hooks" => set_hooks(true),
        "--remove-hooks" => set_hooks(false),
        "--enable-login" => set_login(true),
        "--mark-configured" => mark_configured(), // le .pkg a déjà fait ses choix : pas de réglages par défaut à la première ouverture
        "--disable-login" => set_login(false),
        "--status" => {
            println!("hooks={} login={}", hooks_installed(), login_enabled());
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    const OTHER_TOKEN: &str = "fedcba9876543210fedcba9876543210";

    /// Faux dossier personnel, propre à chaque test (les tests tournent en parallèle).
    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pet-claude-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        dir
    }
    fn write_claude(home: &Path, value: &Value) {
        std::fs::write(claude_settings_path(home), serde_json::to_string_pretty(value).unwrap()).unwrap();
    }
    fn read_claude(home: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(claude_settings_path(home)).unwrap()).unwrap()
    }
    fn count_ours(settings: &Value, ev: &str) -> usize {
        our_commands(settings, ev).len()
    }

    #[test]
    fn install_on_missing_file_creates_all_the_hooks() {
        let home = temp_home("missing");
        std::fs::remove_dir_all(home.join(".claude")).unwrap();
        set_hooks_in(&home, TOKEN, true).unwrap();
        let s = read_claude(&home);
        for ev in EVENTS {
            assert_eq!(count_ours(&s, ev), 1, "{ev}");
        }
        assert!(hooks_installed_in(&home, TOKEN));
    }

    #[test]
    fn hooks_installed_by_an_older_version_are_detected_as_outdated() {
        let home = temp_home("older");
        let old: Vec<_> = ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUseFailure", "Stop"].into();
        let hooks: Map<String, Value> = old
            .iter()
            .map(|ev| (ev.to_string(), json!([{ "hooks": [{ "type": "command", "command": hook_command(ev, TOKEN) }] }])))
            .collect();
        write_claude(&home, &json!({ "hooks": hooks }));
        // refresh_hooks_if_outdated agit exactement sur ce couple de conditions
        assert!(hooks_present_in(&home) && !hooks_installed_in(&home, TOKEN));
        set_hooks_in(&home, TOKEN, true).unwrap();
        assert!(hooks_installed_in(&home, TOKEN));
    }

    #[test]
    fn the_permission_hook_with_a_longer_timeout_is_recognized_as_ours_and_foreign_curls_are_not() {
        assert!(is_ours("curl -s -m 25 -H \"X-Pet-Token: abc\" --data-binary @- localhost:4242/PermissionRequest || true"));
        assert!(!is_ours("curl -s -m 5 https://example.com/hook"));
        assert!(!is_ours("curl -s -m 5 localhost:8080/PermissionRequest"));
    }

    #[test]
    fn only_the_permission_hook_waits_for_the_user() {
        let home = temp_home("perm");
        write_claude(&home, &json!({ "hooks": { "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "/usr/local/bin/mon-hook" }] }] } }));
        set_hooks_in(&home, TOKEN, true).unwrap();
        let s = read_claude(&home);
        let groups = s["hooks"]["PermissionRequest"].as_array().unwrap();
        assert_eq!(groups.len(), 2, "le hook de l'utilisateur est conservé à côté du nôtre");
        let ours = groups.iter().flat_map(|g| g["hooks"].as_array().unwrap()).find(|h| is_ours(h["command"].as_str().unwrap())).unwrap();
        assert_eq!(ours["timeout"], 30);
        assert!(ours["command"].as_str().unwrap().starts_with("curl -s -m 25 "));
        let stop = &s["hooks"]["Stop"][0]["hooks"][0];
        assert!(stop["command"].as_str().unwrap().starts_with("curl -s -m 1 ") && stop.get("timeout").is_none());
        set_hooks_in(&home, TOKEN, false).unwrap();
        let after = read_claude(&home);
        assert_eq!(after["hooks"]["PermissionRequest"].as_array().unwrap().len(), 1, "la désinstallation ne retire que le nôtre");
    }

    #[test]
    fn achievements_start_at_zero_roundtrip_and_ignore_junk() {
        let home = temp_home("ach");
        assert_eq!(read_achievements_in(&home), json!({ "files": 0, "fixes": 0, "cleanSessions": 0 }));
        write_achievements_in(&home, &json!({ "files": 120, "fixes": 3, "cleanSessions": 1, "evil": 9, "x": "y" })).unwrap();
        assert_eq!(read_achievements_in(&home), json!({ "files": 120, "fixes": 3, "cleanSessions": 1 }));
        std::fs::write(achievements_path(&home), r#"{"files":-5,"fixes":"beaucoup","cleanSessions":99999999999999}"#).unwrap();
        assert_eq!(read_achievements_in(&home), json!({ "files": 0, "fixes": 0, "cleanSessions": 1_000_000_000 }));
        std::fs::write(achievements_path(&home), "pas du json").unwrap();
        assert_eq!(read_achievements_in(&home)["files"], 0);
    }

    #[test]
    fn install_is_idempotent() {
        let home = temp_home("idem");
        write_claude(&home, &json!({ "model": "x" }));
        set_hooks_in(&home, TOKEN, true).unwrap();
        let first = std::fs::read_to_string(claude_settings_path(&home)).unwrap();
        set_hooks_in(&home, TOKEN, true).unwrap();
        assert_eq!(first, std::fs::read_to_string(claude_settings_path(&home)).unwrap());
    }

    #[test]
    fn foreign_hooks_other_keys_and_key_order_are_preserved() {
        let home = temp_home("foreign");
        write_claude(
            &home,
            &json!({
                "model": "opus",
                "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "mon-script" }] }], "Notification": [{ "hooks": [{ "type": "command", "command": "autre" }] }] },
                "theme": "dark"
            }),
        );
        set_hooks_in(&home, TOKEN, true).unwrap();
        let s = read_claude(&home);
        assert_eq!(s.as_object().unwrap().keys().collect::<Vec<_>>(), ["model", "hooks", "theme"]);
        assert_eq!(s["hooks"]["Stop"][0]["hooks"][0]["command"], "mon-script");
        assert_eq!(s["hooks"]["Notification"][0]["hooks"][0]["command"], "autre");
        assert_eq!(s["hooks"]["Stop"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn remove_deletes_only_ours_and_cleans_up_empties() {
        let home = temp_home("remove");
        write_claude(&home, &json!({ "model": "x" }));
        set_hooks_in(&home, TOKEN, true).unwrap();
        set_hooks_in(&home, TOKEN, false).unwrap();
        assert_eq!(read_claude(&home), json!({ "model": "x" }));

        write_claude(&home, &json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "mon-script" }] }] } }));
        set_hooks_in(&home, TOKEN, true).unwrap();
        set_hooks_in(&home, TOKEN, false).unwrap();
        assert_eq!(read_claude(&home), json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "mon-script" }] }] } }));
    }

    #[test]
    fn invalid_json_is_left_untouched() {
        let home = temp_home("invalid");
        std::fs::write(claude_settings_path(&home), "{ pas du json").unwrap();
        assert!(set_hooks_in(&home, TOKEN, true).is_err());
        assert_eq!(std::fs::read_to_string(claude_settings_path(&home)).unwrap(), "{ pas du json");
        assert!(!hooks_installed_in(&home, TOKEN));
    }

    #[test]
    fn backup_is_made_once_from_the_original() {
        let home = temp_home("backup");
        write_claude(&home, &json!({ "model": "original" }));
        set_hooks_in(&home, TOKEN, true).unwrap();
        let backup = home.join(".claude/settings.json.bak-pet-claude");
        assert_eq!(serde_json::from_str::<Value>(&std::fs::read_to_string(&backup).unwrap()).unwrap(), json!({ "model": "original" }));
        let mut s = read_claude(&home);
        s["model"] = json!("modifié depuis");
        write_claude(&home, &s);
        set_hooks_in(&home, TOKEN, true).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&std::fs::read_to_string(&backup).unwrap()).unwrap(), json!({ "model": "original" }));
    }

    #[test]
    fn a_new_token_replaces_the_hooks_instead_of_duplicating_them() {
        let home = temp_home("token");
        set_hooks_in(&home, TOKEN, true).unwrap();
        set_hooks_in(&home, OTHER_TOKEN, true).unwrap();
        let s = read_claude(&home);
        for ev in EVENTS {
            assert_eq!(count_ours(&s, ev), 1, "{ev}");
        }
        assert!(hooks_installed_in(&home, OTHER_TOKEN));
        assert!(!hooks_installed_in(&home, TOKEN), "un hook portant un autre secret est périmé");
    }

    #[test]
    fn legacy_hooks_without_secret_are_recognized_and_replaced() {
        let home = temp_home("legacy");
        let legacy = "curl -s -m 1 --data-binary @- localhost:4242/Stop || true";
        write_claude(&home, &json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": legacy }] }] } }));
        assert!(hooks_present_in(&home) && !hooks_installed_in(&home, TOKEN));
        set_hooks_in(&home, TOKEN, true).unwrap();
        let s = read_claude(&home);
        assert_eq!(count_ours(&s, "Stop"), 1);
        assert!(!serde_json::to_string(&s).unwrap().contains(legacy));
    }

    #[test]
    fn writes_leave_no_temporary_file() {
        let home = temp_home("atomic");
        set_hooks_in(&home, TOKEN, true).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(home.join(".claude")).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().contains("tmp-pet-claude")).collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn write_keeps_the_original_permissions() {
        let home = temp_home("perms");
        write_claude(&home, &json!({}));
        std::fs::set_permissions(claude_settings_path(&home), std::fs::Permissions::from_mode(0o600)).unwrap();
        set_hooks_in(&home, TOKEN, true).unwrap();
        assert_eq!(std::fs::metadata(claude_settings_path(&home)).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn token_is_stable_random_and_private() {
        let home = temp_home("tok");
        let t = token_in(&home);
        assert_eq!(t.len(), 32);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(t, token_in(&home));
        let path = support_dir(&home, IDENTIFIER).join("token");
        assert_eq!(std::fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_ne!(t, token_in(&temp_home("tok2")));
    }

    #[test]
    fn login_agent_is_written_and_removed() {
        let home = temp_home("login");
        assert!(set_login_in(&home, true, "/tmp/dev/target/debug/app").is_err(), "refusé hors d'une app installée");
        set_login_in(&home, true, "/Applications/pet-claude.app/Contents/MacOS/app").unwrap();
        let plist = std::fs::read_to_string(login_plist(&home, IDENTIFIER)).unwrap();
        assert!(plist.contains(IDENTIFIER) && plist.contains("/Applications/pet-claude.app/Contents/MacOS/app") && plist.contains("RunAtLoad"));
        set_login_in(&home, false, "").unwrap();
        assert!(!login_plist(&home, IDENTIFIER).exists());
    }

    #[test]
    fn first_run_enables_hooks_and_login_once() {
        let home = temp_home("firstrun");
        let exe = "/Applications/pet-claude.app/Contents/MacOS/app";
        assert!(!first_run_in(&home, "/Volumes/pet-claude/pet-claude.app/Contents/MacOS/app").unwrap(), "depuis le .dmg : rien");
        assert!(!first_run_in(&home, "/tmp/dev/target/debug/app").unwrap(), "développement : rien");
        assert!(first_run_in(&home, exe).unwrap());
        assert!(hooks_installed_in(&home, &token_in(&home)) && login_plist(&home, IDENTIFIER).exists());
        // l'utilisateur change d'avis : on n'y retouche jamais
        set_hooks_in(&home, &token_in(&home), false).unwrap();
        set_login_in(&home, false, "").unwrap();
        assert!(!first_run_in(&home, exe).unwrap());
        assert!(!hooks_present_in(&home) && !login_plist(&home, IDENTIFIER).exists());
    }

    #[test]
    fn first_run_respects_an_existing_configuration() {
        let home = temp_home("firstrun-existing");
        std::fs::create_dir_all(support_dir(&home, IDENTIFIER)).unwrap();
        std::fs::write(settings_path(&home), "{}").unwrap();
        assert!(!first_run_in(&home, "/Applications/pet-claude.app/Contents/MacOS/app").unwrap());
        assert!(!hooks_present_in(&home) && !login_plist(&home, IDENTIFIER).exists());
        assert!(configured_marker(&home).exists());
    }

    #[test]
    fn legacy_install_is_migrated() {
        let home = temp_home("migrate");
        std::fs::create_dir_all(support_dir(&home, LEGACY_IDENTIFIER)).unwrap();
        std::fs::write(settings_path_for(&home, LEGACY_IDENTIFIER), r#"{"cooldownSec": 30}"#).unwrap();
        std::fs::create_dir_all(home.join("Library/LaunchAgents")).unwrap();
        std::fs::write(login_plist(&home, LEGACY_IDENTIFIER), "<plist/>").unwrap();
        migrate_legacy_in(&home, Some("/Applications/pet-claude.app/Contents/MacOS/app"));
        assert_eq!(std::fs::read_to_string(settings_path(&home)).unwrap(), r#"{"cooldownSec": 30}"#);
        assert!(!login_plist(&home, LEGACY_IDENTIFIER).exists());
        assert!(login_plist(&home, IDENTIFIER).exists(), "le lancement au démarrage reste activé");
    }
}
