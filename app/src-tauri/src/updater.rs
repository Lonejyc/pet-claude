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
    let found = find(app).await;
    UP_TO_DATE.store(found.is_none(), Ordering::Relaxed);
    *AVAILABLE.lock().unwrap() = found.map(|u| u.version);
    crate::menu::refresh(app);
}

/// Télécharge, installe puis relance l'app.
pub async fn install(app: &AppHandle) {
    if let Some(update) = find(app).await {
        match update.download_and_install(|_, _| {}, || {}).await {
            Ok(()) => app.restart(),
            Err(e) => eprintln!("mise à jour : installation impossible : {e}"),
        }
    }
}

async fn find(app: &AppHandle) -> Option<tauri_plugin_updater::Update> {
    match async { app.updater()?.check().await }.await {
        Ok(update) => update,
        Err(e) => {
            eprintln!("mise à jour : vérification impossible : {e}");
            None
        }
    }
}
