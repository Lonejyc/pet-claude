//! Position de la fenêtre et des écrans en coordonnées natives macOS.
//! Les conversions de Tauri/tao se mélangent entre écrans d'échelles ou de hauteurs différentes (le pet apparaissait en double) :
//! ici tout est en points, y vers le bas, origine en haut à gauche de l'écran principal.
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSEvent, NSScreen, NSWindow};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use objc2_foundation::{NSPoint, NSRect};
use serde::Serialize;
use tauri::WebviewWindow;

#[derive(Serialize)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Serialize)]
pub struct Screen {
    frame: Rect,
    work: Rect, // sans barre de menu ni Dock
}

pub fn ns_window(window: &WebviewWindow) -> &NSWindow {
    unsafe { &*(window.ns_window().unwrap() as *const NSWindow) }
}

fn primary_height(mtm: MainThreadMarker) -> f64 {
    NSScreen::screens(mtm).objectAtIndex(0).frame().size.height
}

fn flip(r: NSRect, primary_height: f64) -> Rect {
    Rect { x: r.origin.x, y: primary_height - (r.origin.y + r.size.height), w: r.size.width, h: r.size.height }
}

// Commandes synchrones : Tauri les exécute sur le thread principal, requis par AppKit.
fn main_thread() -> MainThreadMarker {
    MainThreadMarker::new().expect("commande exécutée sur le thread principal")
}

#[tauri::command]
pub fn screens() -> Vec<Screen> {
    let mtm = main_thread();
    let ph = primary_height(mtm);
    NSScreen::screens(mtm).iter().map(|s| Screen { frame: flip(s.frame(), ph), work: flip(s.visibleFrame(), ph) }).collect()
}

#[tauri::command]
pub fn window_origin(window: WebviewWindow) -> (f64, f64) {
    let f = ns_window(&window).frame();
    (f.origin.x, primary_height(main_thread()) - (f.origin.y + f.size.height))
}

#[tauri::command]
pub fn set_window_origin(window: WebviewWindow, x: f64, y: f64) {
    ns_window(&window).setFrameTopLeftPoint(NSPoint::new(x, primary_height(main_thread()) - y));
}

#[tauri::command]
pub fn mouse() -> (f64, f64) {
    let m = NSEvent::mouseLocation();
    (m.x, primary_height(main_thread()) - m.y)
}

/// Le panel du pet ne doit jamais prendre le clavier (sinon cliquer ou glisser le pet volerait le focus du terminal),
/// sauf pendant le mini-chat : `canBecomeKeyWindow` (cf. lib.rs) renvoie ce drapeau.
pub static CHAT_OPEN: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_chat_open(window: WebviewWindow, open: bool) {
    CHAT_OPEN.store(open, Ordering::Relaxed);
    let app = NSApplication::sharedApplication(main_thread());
    let w = ns_window(&window);
    if open {
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        w.makeKeyWindow();
    } else {
        // rend la main à l'application précédente (le terminal)
        app.hide(None);
        w.orderFrontRegardless();
    }
}

/// Icône dans le Dock (et menu de l'app) seulement pendant les réglages. Le reste du temps l'app est "Accessory", ce qui
/// est nécessaire pour que le pet reste visible au-dessus des apps en plein écran.
pub fn set_dock_visible(visible: bool) {
    let app = NSApplication::sharedApplication(main_thread());
    app.setActivationPolicy(if visible { NSApplicationActivationPolicy::Regular } else { NSApplicationActivationPolicy::Accessory });
    if visible {
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
    }
}

// ---- pointeur : clics à travers les zones transparentes, suivi du regard, économie d'énergie

/// Pet endormi : il ne suit plus la souris, on ralentit la surveillance et on arrête d'envoyer des positions au front.
pub static SLEEPING: AtomicBool = AtomicBool::new(false);
/// Pet masqué depuis le menu de la barre de menus : plus rien à surveiller.
pub static HIDDEN: AtomicBool = AtomicBool::new(false);
/// Zones cliquables [x, y, largeur, hauteur] en px depuis le haut gauche de la fenêtre, envoyées par le front (pet, bulle, champ de chat).
static HIT_REGIONS: Mutex<Vec<[f64; 4]>> = Mutex::new(Vec::new());

#[tauri::command]
pub fn set_hit_regions(regions: Vec<[f64; 4]>) {
    *HIT_REGIONS.lock().unwrap() = regions;
}

#[tauri::command]
pub fn set_sleeping(sleeping: bool) {
    SLEEPING.store(sleeping, Ordering::Relaxed);
}

/// Masque ou ré-affiche le pet ; retourne true s'il est maintenant visible.
pub fn toggle_pet(window: &WebviewWindow) -> bool {
    let show = HIDDEN.load(Ordering::Relaxed);
    HIDDEN.store(!show, Ordering::Relaxed);
    let w = ns_window(window);
    if show {
        w.orderFrontRegardless();
    } else {
        w.orderOut(None);
    }
    show
}

/// Une fenêtre transparente intercepte les clics sur toute sa surface : on la rend "traversante" tant que la souris n'est
/// pas sur une zone cliquable. Pendant un clic ou un glisser (bouton enfoncé), on ne change rien pour ne pas lâcher le pet.
fn update_click_through(window: &WebviewWindow) {
    if NSEvent::pressedMouseButtons() != 0 {
        return;
    }
    let w = ns_window(window);
    let f = w.frame();
    let m = NSEvent::mouseLocation();
    let (x, y) = (m.x - f.origin.x, f.size.height - (m.y - f.origin.y));
    let over = HIT_REGIONS.lock().unwrap().iter().any(|[rx, ry, rw, rh]| x >= *rx && x <= rx + rw && y >= *ry && y <= ry + rh);
    if w.ignoresMouseEvents() == over {
        w.setIgnoresMouseEvents(!over);
    }
}

/// Boucle de surveillance du pointeur (thread dédié, AppKit sur le thread principal). Remplace l'ancien `track_cursor`.
/// Cadence : 33 ms normalement, 100 ms endormi (les clics doivent pouvoir le réveiller), 500 ms masqué.
pub fn pointer_loop(window: WebviewWindow) {
    let last = Arc::new(Mutex::new((f64::NAN, f64::NAN)));
    std::thread::spawn(move || loop {
        let hidden = HIDDEN.load(Ordering::Relaxed);
        let ms = if hidden { 500 } else if SLEEPING.load(Ordering::Relaxed) { 100 } else { 33 };
        std::thread::sleep(std::time::Duration::from_millis(ms));
        if hidden {
            continue;
        }
        let (w, last) = (window.clone(), last.clone());
        let _ = window.run_on_main_thread(move || {
            update_click_through(&w);
            if SLEEPING.load(Ordering::Relaxed) {
                return;
            }
            let m = NSEvent::mouseLocation();
            let f = ns_window(&w).frame();
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
