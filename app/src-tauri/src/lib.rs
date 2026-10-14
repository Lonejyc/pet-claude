mod native;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![native::screens, native::window_origin, native::set_window_origin, native::mouse])
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
            listen_to_hooks(app.handle().clone());
            track_cursor(app.get_webview_window("main").unwrap());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
                serde_json::json!({ "event": event, "tool": v["tool_name"], "message": v["last_assistant_message"] }),
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
