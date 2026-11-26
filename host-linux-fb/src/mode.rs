use std::sync::atomic::{AtomicBool, Ordering};

static INIT: AtomicBool = AtomicBool::new(false);

pub fn set_init(on: bool) {
    INIT.store(on, Ordering::Relaxed);
}

pub fn is_init() -> bool {
    INIT.load(Ordering::Relaxed)
}

/// Recovery is restricted to packaged local guests, never contributed Apps.
pub fn local_recovery_guest(id: &str, init: bool) -> bool {
    id == "settings" || (init && id == "init")
}

#[cfg(test)]
mod tests {
    use super::local_recovery_guest;

    #[test]
    fn recovery_is_available_only_to_initialization_and_settings() {
        for init in [false, true] {
            assert!(local_recovery_guest("settings", init));
            assert_eq!(local_recovery_guest("init", init), init);
            for id in ["shell", "power", "security", "example/settings", "example/init", "../settings"] {
                assert!(!local_recovery_guest(id, init), "{id}");
            }
        }
    }
}
