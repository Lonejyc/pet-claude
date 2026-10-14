mod chat;
mod native;
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
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![native::screens, native::window_origin, native::set_window_origin, native::mouse, native::set_chat_open, chat::ask, quit, open_settings_cmd, setup_status, hooks_enable, style_enable, login_enable, get_settings, save_settings])
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
            listen_to_hooks(app.handle().clone());
            track_cursor(app.get_webview_window("main").unwrap());
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

/// Reçoit les hooks de Claude Code (`curl localhost:4242/<Event>`) et les relaie au front.
fn listen_to_hooks(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Ok(server) = tiny_http::Server::http("127.0.0.1:4242") else {
            eprintln!("port 4242 déjà pris : le pet ne recevra pas les hooks");
            return;
        };
        for mut req in server.incoming_requests() {
            let event = req.url().trim_start_matches('/').to_string();
            let mut body = String::new();
            let _ = req.as_reader().read_to_string(&mut body);
            let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
            let _ = app.emit(
                "hook",
                serde_json::json!({ "event": event, "session": v["session_id"], "cwd": v["cwd"], "tool": v["tool_name"], "message": v["last_assistant_message"] }),
            );
            let _ = req.respond(tiny_http::Response::empty(200));
        }
    });
}

/// Envoie au front la position du curseur par rapport au pet (points), pour qu'il se tourne vers lui.
/// Repère natif macOS (même repère pour la souris et la fenêtre, quel que soit l'écran) ; AppKit exige le thread principal.
fn track_cursor(window: tauri::WebviewWindow) {
    let last = std::sync::Arc::new(std::sync::Mutex::new((f64::NAN, f64::NAN)));
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(33));
        let (w, last) = (window.clone(), last.clone());
        let _ = window.run_on_main_thread(move || {
            let m = objc2_app_kit::NSEvent::mouseLocation();
            let f = native::ns_window(&w).frame();
            // centre du pet : milieu de la fenêtre, 92 pt au-dessus du bas (36 de marge + moitié du pet)
            let d = (m.x - (f.origin.x + f.size.width / 2.0), (f.origin.y + 92.0) - m.y);
            let mut last = last.lock().unwrap();
            if d != *last {
                *last = d;
                let _ = w.emit("cursor", d);
            }
        });
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
