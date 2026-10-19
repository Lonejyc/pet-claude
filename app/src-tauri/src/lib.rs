mod chat;
mod local_usage;
mod native;
mod server;
mod setup;

use tauri::{Emitter, Manager};
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt};

tauri_panel! {
    panel!(PetPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

/// Sans icône dans le Dock ni menu, l'app installée n'a pas d'autre moyen de se fermer : taper /quit dans le chat.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Usage du forfait en % (session 5 h, semaine), comme /usage. API OAuth non documentée et token lu dans le Keychain de Claude Code :
/// toute erreur (token expiré, hors ligne, 429, format changé) donne None. ponytail: pas de refresh du token, on attend que Claude Code le renouvelle.
fn live_usage() -> Option<serde_json::Value> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let keychain = Command::new("security").args(["find-generic-password", "-s", "Claude Code-credentials", "-w"]).output().ok()?;
    let creds: serde_json::Value = serde_json::from_slice(&keychain.stdout).ok()?;
    let token = creds["claudeAiOauth"]["accessToken"].as_str()?;
    // la config passe par stdin pour que le token n'apparaisse pas dans la liste des processus
    let mut curl = Command::new("curl")
        .args(["-sf", "-m", "10", "-K", "-", "https://api.anthropic.com/api/oauth/usage"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .ok()?;
    write!(curl.stdin.take()?, "header = \"Authorization: Bearer {token}\"\nheader = \"anthropic-beta: oauth-2025-04-20\"\n").ok()?;
    serde_json::from_slice(&curl.wait_with_output().ok()?.stdout).ok()
}

/// Repli : le cache que Claude Code écrit dans ~/.claude.json (frais seulement tant que Claude Code tourne).
fn cached_usage() -> Option<serde_json::Value> {
    let file = std::fs::read(std::path::Path::new(&std::env::var_os("HOME")?).join(".claude.json")).ok()?;
    let v = serde_json::from_slice::<serde_json::Value>(&file).ok()?;
    Some(serde_json::json!({ "usage": v.pointer("/cachedUsageUtilization/utilization")?, "cachedAt": v.pointer("/cachedUsageUtilization/fetchedAtMs") }))
}

/// Usage du forfait pour la fenêtre d'usage. Au plus un appel toutes les 2 min (429 sinon) ; en cas d'échec, dernière valeur connue.
/// `async` : l'appel bloque (curl), il ne doit pas tourner sur le thread principal.
#[tauri::command]
async fn plan_usage() -> Option<serde_json::Value> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static LAST: Mutex<Option<(Instant, Option<serde_json::Value>)>> = Mutex::new(None);
    let mut last = LAST.lock().ok()?;
    if let Some((at, value)) = &*last {
        if at.elapsed() < Duration::from_secs(120) {
            return value.clone();
        }
    }
    let value = live_usage().map(|usage| serde_json::json!({ "usage": usage, "cachedAt": null })).or_else(cached_usage).or_else(|| last.as_ref().and_then(|(_, v)| v.clone()));
    *last = Some((Instant::now(), value.clone()));
    value
}

/// Quand la fenêtre d'usage perd le focus (donc aussi au clic sur l'icône, avant que le clic ne soit relâché).
static USAGE_BLURRED: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// Ouvre ou ferme la fenêtre d'usage, centrée sous l'icône de la barre de menus.
fn toggle_usage(app: &tauri::AppHandle, icon: tauri::Rect) {
    let Some(w) = app.get_webview_window("usage") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    // un clic sur l'icône l'a déjà fermée en lui retirant le focus : ne pas la rouvrir
    if USAGE_BLURRED.lock().ok().and_then(|t| *t).is_some_and(|t| t.elapsed().as_millis() < 300) {
        return;
    }
    let scale = w.scale_factor().unwrap_or(1.0);
    let (pos, size) = (icon.position.to_physical::<f64>(scale), icon.size.to_physical::<f64>(scale));
    let width = w.outer_size().map_or(0.0, |s| s.width as f64);
    let _ = w.set_position(tauri::PhysicalPosition::new(pos.x + size.width / 2.0 - width / 2.0, pos.y + size.height));
    let _ = w.show();
    let _ = w.set_focus();
}

/// Icône toujours présente dans la barre de menus : un clic ouvre la fenêtre d'usage (usage, masquer le pet, réglages, quitter).
fn menu_bar_icon(app: &tauri::App) -> tauri::Result<()> {
    use tauri::tray::TrayIconBuilder;

    let usage = tauri::WebviewWindowBuilder::new(app, "usage", tauri::WebviewUrl::App("usage.html".into()))
        .inner_size(240.0, 208.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    let hide = usage.clone();
    usage.on_window_event(move |e| {
        if let tauri::WindowEvent::Focused(false) = e {
            if let Ok(mut t) = USAGE_BLURRED.lock() {
                *t = Some(std::time::Instant::now());
            }
            let _ = hide.hide();
        }
    });
    TrayIconBuilder::with_id("pet-claude")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true) // silhouette noire que macOS teinte (blanche en mode sombre)
        .tooltip("pet-claude")
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                toggle_usage(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    Ok(())
}

pub fn open_settings(app: &tauri::AppHandle) {
    native::set_dock_visible(true);
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("settings.html".into()))
        .title("Réglages de pet-claude")
        .inner_size(460.0, 640.0)
        .resizable(false)
        .build();
    match built {
        Ok(w) => w.on_window_event(|e| {
            if let tauri::WindowEvent::Destroyed = e {
                native::set_dock_visible(false);
            }
        }),
        Err(e) => eprintln!("fenêtre de réglages : {e}"),
    }
}

#[tauri::command]
async fn local_usage() -> Option<serde_json::Value> {
    local_usage::get()
}

#[tauri::command]
fn toggle_pet(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        native::toggle_pet(&window);
    }
}

#[tauri::command]
fn pet_hidden() -> bool {
    native::HIDDEN.load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
fn open_settings_cmd(app: tauri::AppHandle) {
    open_settings(&app);
}

#[tauri::command]
fn setup_status() -> serde_json::Value {
    let installed = std::env::current_exe().is_ok_and(|e| e.to_string_lossy().contains(".app/Contents/MacOS/"));
    serde_json::json!({ "hooks": setup::hooks_installed(), "style": setup::style_enabled(), "login": setup::login_enabled(), "installed": installed })
}

#[tauri::command]
fn hooks_enable(on: bool) -> Result<(), String> {
    setup::set_hooks(on)
}

#[tauri::command]
fn style_enable(on: bool) -> Result<(), String> {
    setup::set_style(on)
}

#[tauri::command]
fn login_enable(on: bool) -> Result<(), String> {
    setup::set_login(on)
}

#[tauri::command]
fn get_settings() -> serde_json::Value {
    setup::read_settings()
}

/// Enregistre et prévient toutes les fenêtres (le pet applique les réglages en direct).
#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    setup::write_settings(&settings)?;
    app.emit("settings", setup::read_settings()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if setup::run_cli() {
        return;
    }
    setup::migrate_legacy();
    setup::refresh_hooks_if_outdated();
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .invoke_handler(tauri::generate_handler![native::screens, native::window_origin, native::set_window_origin, native::mouse, native::set_chat_open, native::set_hit_regions, native::set_sleeping, chat::ask, quit, open_settings_cmd, plan_usage, local_usage, toggle_pet, pet_hidden, setup_status, hooks_enable, style_enable, login_enable, get_settings, save_settings])
        .setup(|app| {
            // Accessory : pas d'icône dans le Dock, requis pour s'afficher au-dessus du plein écran.
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            // Un NSPanel non activant : seule façon d'apparaître sur les Spaces des apps en plein écran.
            let panel = app.get_webview_window("main").unwrap().to_panel::<PetPanel>()?;
            panel.set_level(PanelLevel::Floating.value());
            panel.add_style_mask(StyleMask::empty().nonactivating_panel().into())?;
            panel.set_collection_behavior(
                CollectionBehavior::new().full_screen_auxiliary().can_join_all_spaces().into(),
            );
            allow_offscreen(&app.get_webview_window("main").unwrap());
            key_window_only_when_chatting(&app.get_webview_window("main").unwrap());
            menu_bar_icon(app)?;
            server::listen(app.handle().clone());
            native::pointer_loop(app.get_webview_window("main").unwrap());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // relancer l'app (Launchpad, Spotlight, Finder) alors qu'elle tourne déjà ouvre les réglages
            if let tauri::RunEvent::Reopen { .. } = event {
                open_settings(app);
            }
        });
}

/// Remplace `canBecomeKeyWindow` du panel par la valeur de `CHAT_OPEN` (la macro de tauri-nspanel ne permet qu'une valeur fixe).
fn key_window_only_when_chatting(window: &tauri::WebviewWindow) {
    use objc2::ffi::class_replaceMethod;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
    use objc2::sel;

    extern "C" fn can_become_key(_this: *mut AnyObject, _cmd: Sel) -> Bool {
        Bool::new(native::CHAT_OPEN.load(std::sync::atomic::Ordering::Relaxed))
    }

    unsafe {
        let ns_window = &*(window.ns_window().unwrap() as *const AnyObject);
        let class: &AnyClass = ns_window.class();
        let imp: objc2::runtime::Imp = std::mem::transmute(can_become_key as extern "C" fn(*mut AnyObject, Sel) -> Bool);
        class_replaceMethod(class as *const AnyClass as *mut _, sel!(canBecomeKeyWindow), imp, c"B@:".as_ptr());
    }
}

/// macOS replaque d'office une fenêtre sous la barre de menu (`constrainFrameRect:toScreen:`).
/// Comme ~150 px de la fenêtre sont vides au-dessus du pet, il ne pourrait jamais atteindre le haut de l'écran :
/// on remplace cette méthode (sur la classe du panel uniquement) par une qui rend le cadre tel quel.
#[cfg(target_os = "macos")]
fn allow_offscreen(window: &tauri::WebviewWindow) {
    use objc2::ffi::class_replaceMethod;
    use objc2::runtime::{AnyClass, AnyObject, Sel};
    use objc2::sel;
    use objc2_foundation::NSRect;

    extern "C" fn keep_frame(_this: *mut AnyObject, _cmd: Sel, frame: NSRect, _screen: *mut AnyObject) -> NSRect {
        frame
    }

    unsafe {
        let ns_window = &*(window.ns_window().unwrap() as *const AnyObject);
        let class: &AnyClass = ns_window.class();
        let imp: objc2::runtime::Imp = std::mem::transmute(keep_frame as extern "C" fn(*mut AnyObject, Sel, NSRect, *mut AnyObject) -> NSRect);
        class_replaceMethod(
            class as *const AnyClass as *mut _,
            sel!(constrainFrameRect:toScreen:),
            imp,
            c"{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@".as_ptr(),
        );
    }
}
