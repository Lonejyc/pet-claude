//! Raccourci clavier global : ouvre le mini-chat au centre de l'écran actif, même si le pet est masqué ou sur un autre écran.
//! Le raccourci est un réglage (`chatShortcut`, vide = désactivé) : un raccourci global « vole » la combinaison à toutes les autres apps.
use std::str::FromStr;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Installe (ou retire) le raccourci. `accel` vide = désactivé ; un raccourci invalide ou déjà pris par une autre app est ignoré avec un message.
pub fn apply(app: &tauri::AppHandle, accel: &str) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if accel.is_empty() {
        return;
    }
    let Ok(shortcut) = Shortcut::from_str(accel) else {
        eprintln!("raccourci invalide : {accel}");
        return;
    };
    let result = gs.on_shortcut(shortcut, |app, _, event| {
        if event.state() == ShortcutState::Pressed {
            let handle = app.clone();
            // AppKit exige le thread principal
            let _ = app.run_on_main_thread(move || {
                if let Some(window) = handle.get_webview_window("main") {
                    crate::native::summon(&window);
                    let _ = handle.emit("open-chat", ());
                }
            });
        }
    });
    if let Err(e) = result {
        eprintln!("raccourci {accel} indisponible : {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Les valeurs proposées par le menu des réglages (settings.html) ; le défaut (setup.rs) évite ⌘⇧C, déjà pris par Chrome, VS Code, Xcode…
    #[test]
    fn every_shortcut_offered_in_the_settings_is_valid() {
        for p in ["Control+Alt+Space", "Super+Shift+Space", "Super+Shift+C"] {
            assert!(Shortcut::from_str(p).is_ok(), "{p}");
        }
    }
}
