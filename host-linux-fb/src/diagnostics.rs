//! Local diagnostics use the same installed systemd oneshot as the Web API.
use std::fs;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

#[derive(Default)]
pub struct Diagnostics {
    starting: AtomicBool,
    id: Mutex<String>,
    error: Mutex<String>,
}

impl Diagnostics {
    pub fn begin(&self) -> bool {
        if self.starting.swap(true, Ordering::AcqRel) {
            return false;
        }
        if matches!(self.state().as_str(), "queued" | "running") {
            self.starting.store(false, Ordering::Release);
            return false;
        }
        self.id.lock().unwrap().clear();
        self.error.lock().unwrap().clear();
        true
    }

    pub fn start_boot_export(&self) {
        let result = Command::new("timeout")
            .args(["10", "/usr/libexec/onekvm/diagnostics-job", "start", "boot"])
            .output()
            .map_err(|error| error.to_string())
            .and_then(|output| {
                if !output.status.success() {
                    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
                }
                let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !valid_id(&id) {
                    return Err("invalid diagnostics job id".into());
                }
                Ok(id)
            });
        match result {
            Ok(id) => *self.id.lock().unwrap() = id,
            Err(error) => {
                log::warn!("local diagnostics: {error}");
                *self.error.lock().unwrap() = if error.contains("/boot") {
                    "boot-unavailable"
                } else if error.contains("already running") {
                    "busy"
                } else {
                    "failed"
                }.into();
            }
        }
        self.starting.store(false, Ordering::Release);
    }

    fn state(&self) -> String {
        let id = self.id.lock().unwrap();
        if id.is_empty() { return String::new(); }
        fs::read_to_string(format!("/var/tmp/onekvm/diagnostics/jobs/{id}/state"))
            .unwrap_or_else(|_| "error".into()).trim().to_string()
    }

    pub fn snapshot(&self) -> String {
        let error = self.error.lock().unwrap().clone();
        let state = if self.starting.load(Ordering::Acquire) {
            "queued".into()
        } else if !error.is_empty() {
            "error".into()
        } else {
            self.state()
        };
        serde_json::json!({"state": state, "error": error}).to_string()
    }
}

fn valid_id(value: &str) -> bool {
    value.len() == 36 && value.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}
