//! Private built-in Settings controls; destructive writes are not on D-Bus.
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    Reboot,
    FactoryReset,
    Recovery,
}
impl Action {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "reboot" => Some(Self::Reboot),
            "factory-reset" => Some(Self::FactoryReset),
            "recovery" => Some(Self::Recovery),
            _ => None,
        }
    }
    fn unit(self) -> &'static str {
        match self {
            Self::Reboot => "onekvm-reboot.timer",
            Self::FactoryReset => "onekvm-factory-reset.service",
            Self::Recovery => "onekvm-enter-recovery.service",
        }
    }
    fn available(self) -> bool {
        [
            "/usr/lib/systemd/system",
            "/lib/systemd/system",
            "/etc/systemd/system",
        ]
        .iter()
        .any(|dir| Path::new(dir).join(self.unit()).is_file())
    }
}

#[derive(Default)]
struct Gate {
    pending: Option<(Action, Instant)>,
    holding: Option<Instant>,
    submitted: bool,
    status: String,
}
impl Gate {
    fn prepare(&mut self, action: Option<Action>, now: Instant) {
        if self.submitted && !self.status.starts_with("error:") {
            return;
        }
        *self = Self {
            pending: action.map(|a| (a, now + Duration::from_secs(5))),
            ..Self::default()
        };
    }
    fn hold(&mut self, down: bool, now: Instant) {
        if !down {
            self.holding = None;
        } else if !self.submitted
            && self.holding.is_none()
            && self.pending.is_some_and(|(_, ready)| now >= ready)
        {
            self.holding = Some(now);
        }
    }
    fn confirm(&mut self, action: Action, now: Instant) -> bool {
        if self.submitted
            || !self
                .pending
                .is_some_and(|(pending, ready)| pending == action && now >= ready)
            || !self
                .holding
                .is_some_and(|start| now.duration_since(start) >= Duration::from_secs(2))
        {
            return false;
        }
        self.submitted = true;
        self.status = "busy".into();
        true
    }
}

#[derive(Default)]
pub struct SystemActions {
    gate: Mutex<Gate>,
    pressed: AtomicBool,
}
impl SystemActions {
    pub fn capabilities(&self) -> String {
        serde_json::json!({"reboot": Action::Reboot.available(), "factory-reset": Action::FactoryReset.available(), "recovery": Action::Recovery.available()}).to_string()
    }
    pub fn preparing(&self) -> bool {
        self.gate.lock().unwrap().pending.is_some()
    }
    pub fn pressed(&self) -> bool {
        self.pressed.load(Ordering::Relaxed)
    }
    pub fn set_pressed(&self, down: bool) {
        self.pressed.store(down, Ordering::Relaxed);
    }
    pub fn prepare(&self, value: &str) {
        self.gate
            .lock()
            .unwrap()
            .prepare(Action::parse(value), Instant::now());
    }
    pub fn hold(&self, down: bool) {
        self.gate.lock().unwrap().hold(down, Instant::now());
    }
    pub fn status(&self) -> String {
        self.gate.lock().unwrap().status.clone()
    }
    pub fn ready(&self) -> bool {
        self.gate
            .lock()
            .unwrap()
            .pending
            .is_some_and(|(_, ready)| Instant::now() >= ready)
    }
    pub fn hold_ready(&self) -> bool {
        self.gate
            .lock()
            .unwrap()
            .holding
            .is_some_and(|start| start.elapsed() >= Duration::from_secs(2))
    }
    pub fn confirm(&self, value: &str) -> Option<Action> {
        let action = Action::parse(value)?;
        self.gate
            .lock()
            .unwrap()
            .confirm(action, Instant::now())
            .then_some(action)
    }
    pub fn execute(&self, action: Action) {
        // Same lifecycle units as Core's system API. No shell or boot writes.
        let boot_mounted = || {
            std::fs::read_to_string("/proc/self/mountinfo")
                .unwrap_or_default()
                .lines()
                .any(|line| line.split_whitespace().nth(4) == Some("/boot"))
        };
        let result = if !action.available() {
            Err("operation is not supported on this device".into())
        } else if action != Action::Reboot && !boot_mounted() {
            Err("/boot is not mounted".into())
        } else {
            Command::new("systemctl")
                .args(["start", action.unit()])
                .output()
                .map_err(|err| err.to_string())
                .and_then(|out| {
                    if out.status.success() {
                        Ok(())
                    } else {
                        Err(String::from_utf8_lossy(&out.stderr)
                            .trim()
                            .chars()
                            .take(240)
                            .collect())
                    }
                })
        };
        self.gate.lock().unwrap().status = match result {
            Ok(()) => "done".into(),
            Err(err) => {
                log::warn!("screen system action {action:?}: {err}");
                format!("error:{err}")
            }
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_fixed_lifecycle_units_are_accepted() {
        assert_eq!(
            Action::parse("reboot").unwrap().unit(),
            "onekvm-reboot.timer"
        );
        assert_eq!(
            Action::parse("factory-reset").unwrap().unit(),
            "onekvm-factory-reset.service"
        );
        assert_eq!(
            Action::parse("recovery").unwrap().unit(),
            "onekvm-enter-recovery.service"
        );
        for bad in ["", "reset", "reboot;poweroff", "../reboot", "Reboot"] {
            assert_eq!(Action::parse(bad), None);
        }
    }
    #[test]
    fn requires_wait_then_fresh_hold_and_dispatches_once() {
        for action in [Action::Reboot, Action::FactoryReset, Action::Recovery] {
            let t = Instant::now();
            let mut gate = Gate::default();
            gate.prepare(Some(action), t);
            gate.hold(true, t + Duration::from_secs(4));
            assert!(!gate.confirm(action, t + Duration::from_secs(8)));
            gate.hold(true, t + Duration::from_secs(8));
            assert!(!gate.confirm(action, t + Duration::from_millis(9999)));
            assert!(gate.confirm(action, t + Duration::from_secs(10)));
            assert!(!gate.confirm(action, t + Duration::from_secs(11)));
        }
    }
    #[test]
    fn mismatched_released_and_cancelled_holds_cannot_execute() {
        let t = Instant::now();
        let mut gate = Gate::default();
        gate.prepare(Some(Action::FactoryReset), t);
        gate.hold(true, t + Duration::from_secs(5));
        assert!(!gate.confirm(Action::Recovery, t + Duration::from_secs(8)));
        gate.hold(false, t + Duration::from_secs(8));
        assert!(!gate.confirm(Action::FactoryReset, t + Duration::from_secs(10)));
        gate.hold(true, t + Duration::from_secs(10));
        gate.prepare(None, t + Duration::from_secs(11));
        assert!(!gate.confirm(Action::FactoryReset, t + Duration::from_secs(13)));
    }
}
