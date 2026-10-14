//! Position de la fenêtre et des écrans en coordonnées natives macOS.
//! Les conversions de Tauri/tao se mélangent entre écrans d'échelles ou de hauteurs différentes (le pet apparaissait en double) :
//! ici tout est en points, y vers le bas, origine en haut à gauche de l'écran principal.
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSEvent, NSScreen, NSWindow};
use std::sync::atomic::{AtomicBool, Ordering};
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
