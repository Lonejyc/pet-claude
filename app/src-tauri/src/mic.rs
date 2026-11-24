//! Détecte qu'un appel est en cours : le micro par défaut est utilisé par une app (Zoom, Meet dans un navigateur, Teams, Slack Huddle, FaceTime…).
//! Aucune capture audio : on ne lit que le drapeau CoreAudio « ce périphérique tourne quelque part » (`kAudioDevicePropertyDeviceIsRunningSomewhere`).
//! Le pet s'en sert pour se faire discret (cf. réglage `stealth`). Une dictée vocale compte aussi comme micro utilisé.
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
unsafe extern "C" {
    fn AudioObjectGetPropertyData(object: u32, address: *const PropertyAddress, qualifier_size: u32, qualifier: *const c_void, size: *mut u32, data: *mut c_void) -> i32;
}

const SYSTEM_OBJECT: u32 = 1; // kAudioObjectSystemObject
const SCOPE_GLOBAL: u32 = u32::from_be_bytes(*b"glob");
const DEFAULT_INPUT_DEVICE: u32 = u32::from_be_bytes(*b"dIn "); // kAudioHardwarePropertyDefaultInputDevice
const RUNNING_SOMEWHERE: u32 = u32::from_be_bytes(*b"gone"); // kAudioDevicePropertyDeviceIsRunningSomewhere

/// Lit un entier 32 bits d'une propriété CoreAudio.
fn read_u32(object: u32, selector: u32) -> Option<u32> {
    let address = PropertyAddress { selector, scope: SCOPE_GLOBAL, element: 0 };
    let (mut value, mut size) = (0u32, size_of::<u32>() as u32);
    // SAFETY: `address`, `value` et `size` vivent pendant l'appel, et `size` annonce exactement la taille de `value`.
    let status = unsafe { AudioObjectGetPropertyData(object, &address, 0, std::ptr::null(), &mut size, (&mut value as *mut u32).cast()) };
    (status == 0).then_some(value)
}

pub fn mic_in_use() -> bool {
    read_u32(SYSTEM_OBJECT, DEFAULT_INPUT_DEVICE).filter(|device| *device != 0).and_then(|device| read_u32(device, RUNNING_SOMEWHERE)).is_some_and(|v| v != 0)
}

/// Surveille le micro toutes les 3 s et prévient le front (événement `mic`) quand l'état change.
pub fn watch(app: tauri::AppHandle) {
    static LAST: AtomicBool = AtomicBool::new(false);
    std::thread::spawn(move || loop {
        let now = mic_in_use();
        if LAST.swap(now, Ordering::Relaxed) != now {
            let _ = app.emit("mic", now);
        }
        std::thread::sleep(Duration::from_secs(3));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_coreaudio_selectors_spell_the_expected_four_char_codes() {
        assert_eq!(DEFAULT_INPUT_DEVICE, 0x6449_6e20);
        assert_eq!(RUNNING_SOMEWHERE, 0x676f_6e65);
        assert_eq!(SCOPE_GLOBAL, 0x676c_6f62);
    }

    #[test]
    fn asking_coreaudio_works_on_this_machine_without_crashing() {
        // l'état dépend de la machine (micro occupé ou non) : on vérifie seulement que l'appel aboutit
        println!("micro utilisé : {}", mic_in_use());
        assert!(read_u32(SYSTEM_OBJECT, DEFAULT_INPUT_DEVICE).is_some() || !cfg!(target_os = "macos"));
    }
}
