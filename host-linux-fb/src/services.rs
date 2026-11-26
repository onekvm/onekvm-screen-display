//! The built-in Services App uses Core's existing catalog and action policy.
use std::{collections::BTreeMap, sync::{Mutex, OnceLock, atomic::{AtomicU64, Ordering}}, time::Duration};
use serde_json::Value;

static UNITS: OnceLock<Mutex<UnitStates>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(1);

pub fn generation() -> u64 { GENERATION.load(Ordering::Relaxed) }
pub fn invalidate() { GENERATION.fetch_add(1, Ordering::Relaxed); }

#[derive(Default)]
struct UnitStates(BTreeMap<String, Option<bool>>);

impl UnitStates {
    fn observe(&mut self, path: &str, active: Option<&str>, invalidated: bool) -> bool {
        // New extension services are absent from the last inventory. Ignore
        // unrelated transient units, including individual SSH connections.
        if !self.0.contains_key(path) && !path.starts_with("/org/freedesktop/systemd1/unit/onekvm_2dextension_2d") { return false; }
        let previous = self.0.entry(path.into()).or_default();
        if let Some(active) = active {
            let running = matches!(active, "active" | "reloading" | "activating");
            let changed = *previous != Some(running);
            *previous = Some(running);
            changed
        } else if invalidated { previous.take().is_some() }
        else { false }
    }
}

pub fn observe(path: &str, active: Option<&str>, invalidated: bool) -> bool {
    UNITS.get_or_init(Default::default).lock().unwrap().observe(path, active, invalidated)
}

fn unit_path(unit: &str) -> String {
    let mut path = "/org/freedesktop/systemd1/unit/".to_string();
    for byte in unit.bytes() {
        if byte.is_ascii_alphanumeric() { path.push(byte as char); }
        else { path.push_str(&format!("_{byte:02x}")); }
    }
    path
}

pub fn call(action: &str, payload: &str) -> Result<Value, String> {
    let conn = zbus::blocking::connection::Builder::system()
        .and_then(|builder| builder.method_timeout(Duration::from_secs(25)).build())
        .map_err(|error| error.to_string())?;
    let proxy = zbus::blocking::Proxy::new(&conn, "org.onekvm.Core1", "/org/onekvm/Core1/Management", "org.onekvm.Core1.Management")
        .map_err(|error| error.to_string())?;
    let raw: String = proxy.call("Services", &(action, payload)).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    if action == "list" {
        let items = value.as_array().ok_or("invalid service catalog")?;
        let states = items.iter().filter_map(|item| Some((unit_path(item["unit"].as_str()?), Some(item["running"].as_bool()?)))).collect();
        *UNITS.get_or_init(Default::default).lock().unwrap() = UnitStates(states);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_socket_status_and_transient_units_do_not_reload_services() {
        let socket = unit_path("dropbear.socket");
        let mut states = UnitStates([(socket.clone(), Some(true))].into());
        for _ in 0..100 { assert!(!states.observe(&socket, Some("active"), false)); }
        assert!(!states.observe(&unit_path("dropbear@123.service"), Some("active"), false));
        assert!(!states.observe(&socket, None, false));
        assert!(states.observe(&socket, Some("inactive"), false));
        assert!(!states.observe(&socket, Some("failed"), false));
        assert!(states.observe(&socket, Some("active"), false));
        assert!(states.observe(&socket, None, true));
        assert!(!states.observe(&socket, None, true));
        assert!(states.observe(&unit_path("onekvm-extension-new@main.service"), Some("active"), false));
    }

    #[test]
    fn inventory_units_match_systemd_event_paths() {
        assert_eq!(unit_path("onekvm-extension-foo@main.service"), "/org/freedesktop/systemd1/unit/onekvm_2dextension_2dfoo_40main_2eservice");
        assert_eq!(unit_path("dropbear.socket"), "/org/freedesktop/systemd1/unit/dropbear_2esocket");

    }
}
