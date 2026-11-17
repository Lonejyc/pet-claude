//! Menu natif (NSMenu) de l'icône de la barre de menus : limites du forfait, coût estimé, sessions, puis les actions.
//! Un menu natif n'a que du texte : les barres de progression sont des blocs Unicode (▰▱).
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager};

/// Nombre de sessions Claude actives, envoyé par le pet (événement "sessions").
pub static SESSIONS: AtomicUsize = AtomicUsize::new(0);

/// (identifiant, nom du projet) de la session la plus récente, envoyé par le pet (événement "focus-session").
pub static FOCUS: Mutex<Option<(String, String)>> = Mutex::new(None);

const LIMITS: [(&str, &str, bool); 4] = [("five_hour", "Session · 5 h", true), ("seven_day", "Semaine", true), ("seven_day_sonnet", "Sonnet · semaine", false), ("seven_day_opus", "Opus · semaine", false)];

fn compact(n: f64) -> String {
    let (v, unit) = if n >= 1e6 { (n / 1e6, " M") } else if n >= 1e3 { (n / 1e3, " k") } else { (n, "") };
    let s = if unit.is_empty() { format!("{v:.0}") } else { format!("{v:.1}").replace('.', ",") };
    format!("{}{unit}", s.trim_end_matches(",0"))
}

fn usd(n: f64) -> String {
    format!("${n:.2}").replace('.', ",")
}

fn bar(pct: f64) -> String {
    let filled = (pct / 10.0).round().clamp(0.0, 10.0) as usize;
    format!("{}{}", "▰".repeat(filled), "▱".repeat(10 - filled))
}

fn reset_in(resets_at: &str) -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    let min = ((crate::local_usage::epoch(resets_at).unwrap_or(now) - now) / 60).max(0);
    if min >= 1440 { format!("{} j {} h", min / 1440, min % 1440 / 60) } else { format!("{} h {:02}", min / 60, min % 60) }
}

fn cost_line(name: &str, v: &Value) -> String {
    format!("{name} : ≈ {} · {}", usd(v["cost"].as_f64().unwrap_or(0.0)), compact(v["tokens"].as_f64().unwrap_or(0.0)))
}

/// Ligne grisée (non cliquable), comme « Version » dans les menus système.
/// « boutique · 1,84 $ · contexte 68 % » (le $ est sous-estimé si le modèle n'a pas de tarif connu : `~`).
fn session_line(name: &str, s: &Value) -> String {
    let approx = if s["partial"].as_bool() == Some(true) { "~" } else { "" };
    format!("{name} · {approx}{} · contexte {} %", usd(s["cost"].as_f64().unwrap_or(0.0)), s["pct"].as_f64().unwrap_or(0.0))
}

fn info(app: &AppHandle, text: impl AsRef<str>) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::new(app, text, false, None::<&str>)
}

fn build(app: &AppHandle, plan: Option<Value>, local: Option<Value>, focus: Option<(String, Value)>) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let sep = || PredefinedMenuItem::separator(app);
    let usage = plan.as_ref().map(|p| &p["usage"]);
    for (key, label, always) in LIMITS {
        let limit = usage.map(|u| &u[key]).filter(|l| l.is_object());
        if limit.is_none() && !always {
            continue;
        }
        match limit {
            Some(l) => {
                let pct = l["utilization"].as_f64().unwrap_or(0.0);
                menu.append(&info(app, format!("{label} : {} %", pct.round()))?)?;
                menu.append(&info(app, format!("{}  reset dans {}", bar(pct), reset_in(l["resets_at"].as_str().unwrap_or(""))))?)?;
            }
            None => menu.append(&info(app, format!("{label} : indisponible"))?)?,
        }
        menu.append(&sep()?)?;
    }
    if let Some(s) = usage.map(|u| &u["spend"]).filter(|s| s["enabled"].as_bool() == Some(true)) {
        let money = |m: &Value| usd(m["amount_minor"].as_f64().unwrap_or(0.0) / 10f64.powi(m["exponent"].as_i64().unwrap_or(2) as i32));
        let text = if s["limit"].is_object() { format!("Crédits : {} / {}", money(&s["used"]), money(&s["limit"])) } else { format!("Crédits : {}", money(&s["used"])) };
        menu.append(&info(app, text)?)?;
        menu.append(&sep()?)?;
    }
    if let Some(l) = &local {
        menu.append(&info(app, "Coût estimé")?)?;
        menu.append(&info(app, cost_line("24 h", &l["day"]))?)?;
        menu.append(&info(app, cost_line("7 jours", &l["week"]))?)?;
        let details = Submenu::new(app, "Détails · 7 jours", true)?;
        for r in l["models"].as_array().into_iter().flatten().chain(l["projects"].as_array().into_iter().flatten()) {
            details.append(&info(app, cost_line(r["name"].as_str().unwrap_or("?").trim_start_matches("claude-"), r))?)?;
        }
        menu.append(&details)?;
        if l["partial"].as_bool() == Some(true) {
            menu.append(&info(app, "Coût sous-estimé (modèle sans tarif connu)")?)?;
        }
        menu.append(&sep()?)?;
    }
    if let Some((name, s)) = &focus {
        menu.append(&info(app, session_line(name, s))?)?;
    }
    let n = SESSIONS.load(Ordering::Relaxed);
    if n > 0 {
        menu.append(&info(app, format!("{n} session{} Claude en cours", if n > 1 { "s" } else { "" }))?)?;
        menu.append(&sep()?)?;
    }
    let hidden = crate::native::HIDDEN.load(Ordering::Relaxed);
    menu.append(&MenuItem::with_id(app, "toggle", if hidden { "Afficher le pet" } else { "Masquer le pet" }, true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "Réglages…", true, None::<&str>)?)?;
    menu.append(&sep()?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quitter pet-claude", true, Some("Cmd+Q"))?)?;
    Ok(menu)
}

/// Relit les chiffres (en cache 2 min, sinon curl : jamais sur le thread principal) puis remplace le menu de l'icône.
pub fn refresh(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let plan = tauri::async_runtime::block_on(crate::plan_usage());
        let local = crate::local_usage::get();
        let focus = FOCUS.lock().unwrap().clone().and_then(|(id, name)| Some((name, crate::local_usage::session_stats(&id)?)));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let (Some(tray), Ok(menu)) = (handle.tray_by_id("pet-claude"), build(&handle, plan, local, focus)) {
                let _ = tray.set_menu(Some(menu));
            }
        });
    });
}

pub fn on_event(app: &AppHandle, id: &str) {
    match id {
        "toggle" => {
            if let Some(w) = app.get_webview_window("main") {
                crate::native::toggle_pet(&w);
            }
            refresh(app);
        }
        "settings" => crate::open_settings(app),
        "quit" => app.exit(0),
        _ => {}
    }
}
