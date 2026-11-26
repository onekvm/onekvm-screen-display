//! Fixed, local-only entry to the independent USB ADB service.
use std::process::Command;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};

#[derive(Default)]
pub struct AdbDebug {
    busy: AtomicBool,
    cached: Mutex<String>,
}
impl AdbDebug {
    pub fn begin(&self) -> bool {
        if self.busy.swap(true, Ordering::AcqRel) { return false; }
        *self.cached.lock().unwrap() = "{\"state\":\"busy\"}".into();
        true
    }
    pub fn run(&self, enabled: Option<bool>) {
        let result = if let Some(enabled) = enabled {
            Command::new("timeout").args(["25", "systemctl", if enabled { "start" } else { "stop" }, "onekvm-adb-debug.service"])
                .output().map(|output| {
                    if !output.status.success() {
                        log::warn!("local USB ADB: {}", String::from_utf8_lossy(&output.stderr).trim());
                    }
                    output.status.success()
                }).unwrap_or(false)
        } else { true };
        let active = Command::new("timeout").args(["3", "systemctl", "show", "onekvm-adb-debug.service", "-p", "ActiveState", "--value"])
            .output().ok().filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string());
        let state = match (result, active.as_deref()) {
            (true, Some("active")) => "on",
            (true, Some("inactive")) => "off",
            (true, Some("activating" | "deactivating")) => "busy",
            _ => "error",
        };
        *self.cached.lock().unwrap() = serde_json::json!({"state":state}).to_string();
        self.busy.store(false, Ordering::Release);
    }
    pub fn snapshot(&self) -> String { self.cached.lock().unwrap().clone() }
}
