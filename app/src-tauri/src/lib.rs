mod chat;
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

/// Icône toujours présente dans la barre de menus : accès aux réglages et à Quitter (le pet n'a ni icône Dock ni menu).
fn menu_bar_icon(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let toggle = MenuItem::with_id(app, "toggle", "Masquer le pet", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Réglages…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter pet-claude", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &PredefinedMenuItem::separator(app)?, &quit])?;
    let toggle_item = toggle.clone();
    TrayIconBuilder::with_id("pet-claude")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true) // silhouette noire que macOS teinte (blanche en mode sombre)
        .tooltip("pet-claude")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => {
                if let Some(window) = app.get_webview_window("main") {
                    let visible = native::toggle_pet(&window);
                    let _ = toggle_item.set_text(if visible { "Masquer le pet" } else { "Afficher le pet" });
                }
            }
            "settings" => open_settings(app),
            "quit" => app.exit(0),
            _ => {}
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
        .invoke_handler(tauri::generate_handler![native::screens, native::window_origin, native::set_window_origin, native::mouse, native::set_chat_open, native::set_hit_regions, native::set_sleeping, chat::ask, quit, open_settings_cmd, setup_status, hooks_enable, style_enable, login_enable, get_settings, save_settings])
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
