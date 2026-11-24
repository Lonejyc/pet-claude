//! Raccourci clavier global : ouvre le mini-chat au centre de l'écran actif, même si le pet est masqué ou sur un autre écran.
//! Le raccourci est un réglage (`chatShortcut`, vide = désactivé) : un raccourci global « vole » la combinaison à toutes les autres apps.
use std::str::FromStr;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Installe (ou retire) le raccourci. `accel` vide = désactivé ; un raccourci invalide ou déjà pris par une autre app est ignoré avec un message.
pub fn apply(app: &tauri::AppHandle, accel: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if accel.is_empty() {
        return Ok(());
    }
    let shortcut = parse(accel)?;
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
    result.map_err(|e| format!("Raccourci indisponible (déjà utilisé par une autre app ?) : {e}"))
}

/// Raccourci valide, ou message d'erreur affichable. Vide = désactivé (valide).
/// Sans ⌃, ⌥ ou ⌘ (Maj seul ne compte pas), la combinaison volerait une simple frappe à toutes les apps : refusée.
pub fn parse(accel: &str) -> Result<Shortcut, String> {
    let shortcut = Shortcut::from_str(accel).map_err(|_| format!("Raccourci invalide : {accel}"))?;
    if !shortcut.mods.intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER) {
        return Err("Raccourci invalide : ajoute ⌃, ⌥ ou ⌘ à la touche".into());
    }
    Ok(shortcut)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Les chaînes que produit l'enregistreur des réglages (accelerator.ts) et le défaut (setup.rs) doivent toutes être comprises par Rust.
    #[test]
    fn every_combination_the_settings_can_produce_is_valid() {
        for p in ["Control+Alt+Space", "Shift+Super+C", "Control+Alt+Shift+Super+7", "Alt+F12", "Alt+F24", "Super+ArrowUp", "Control+Backquote", "Alt+BracketLeft", "Control+Alt+Enter", "Super+Minus", "Alt+Tab"] {
            assert!(parse(p).is_ok(), "{p}");
        }
    }

    #[test]
    fn nonsense_is_refused_with_a_readable_message() {
        for p in ["", "Space", "Shift+Space", "Control+", "Control+Alt+Banane", "n'importe quoi"] {
            assert!(parse(p).is_err(), "{p:?}");
        }
        assert!(parse("Banane").unwrap_err().contains("invalide"));
        assert!(parse("Shift+Space").unwrap_err().contains("⌃"));
    }
}
