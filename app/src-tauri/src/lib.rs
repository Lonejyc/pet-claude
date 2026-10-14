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

/// Envoie au front la position du curseur par rapport au pet (px logiques), pour qu'il se tourne vers lui.
fn track_cursor(window: tauri::WebviewWindow) {
    std::thread::spawn(move || {
        let mut last = (f64::NAN, f64::NAN);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(33));
            let (Ok(c), Ok(p), Ok(s), Ok(k)) =
                (window.cursor_position(), window.outer_position(), window.outer_size(), window.scale_factor())
            else {
                continue;
            };
            // centre du pet : milieu de la fenêtre, 60 px (logiques) au-dessus du bas
            let dx = (c.x - (p.x as f64 + s.width as f64 / 2.0)) / k;
            let dy = (c.y - (p.y as f64 + s.height as f64 - 60.0 * k)) / k;
            if (dx, dy) != last {
                last = (dx, dy);
                let _ = window.emit("cursor", (dx, dy));
            }
        }
    });
}
