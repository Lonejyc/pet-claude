//! Mise à jour intégrée : vérification au démarrage (silencieuse) et depuis le menu, installation puis relance.
//! Les archives sont signées avec la clé minisign de `tauri.conf.json` (rien à voir avec la signature Apple).
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// Version disponible trouvée par la dernière vérification.
pub static AVAILABLE: Mutex<Option<String>> = Mutex::new(None);
/// La dernière vérification manuelle n'a rien trouvé.
pub static UP_TO_DATE: AtomicBool = AtomicBool::new(false);

/// Cherche une mise à jour ; toute erreur (hors ligne, pas de release…) est ignorée : on réessaiera au prochain démarrage.
pub async fn check(app: &AppHandle) {
    let found = async { app.updater().ok()?.check().await.ok()? }.await;
    UP_TO_DATE.store(found.is_none(), Ordering::Relaxed);
    *AVAILABLE.lock().unwrap() = found.map(|u| u.version);
    crate::menu::refresh(app);
}

/// Télécharge, installe puis relance l'app.
pub async fn install(app: &AppHandle) {
    let update = async { app.updater().ok()?.check().await.ok()? }.await;
    if let Some(update) = update
        && update.download_and_install(|_, _| {}, || {}).await.is_ok()
    {
        app.restart();
    }
}
