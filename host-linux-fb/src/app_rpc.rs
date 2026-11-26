//! Local screen Apps share the extension host's validated settings path.
use serde_json::{json, Value};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Debug, Default)]
pub struct Policy {
    pub owner: String,
    pub grants: Vec<Value>,
    pub manage_extensions: bool,
    pub power_actions: bool,
    pub service_actions: bool,
    pub security_actions: bool,
    pub media_actions: bool,
    pub keyboard_actions: bool,
}

impl Policy {
    pub fn allows(&self, request: &Request) -> bool {
        let (target, method) = match request {
            Request::Invoke {
                extension, method, ..
            } => (extension, Some(method)),
            Request::Configure { extension, .. } => (extension, None),
            Request::Power { .. } => return self.power_actions,
            Request::Services { .. } => return self.service_actions,
            Request::Security { .. } => return self.security_actions,
            Request::VirtualMedia { .. } => return self.media_actions,
            Request::Keyboard { .. } => return self.keyboard_actions,
        };
        if target != &self.owner && !self.manage_extensions {
            return false;
        }
        self.grants.iter().any(|grant| {
            let extension = grant
                .get("extension")
                .and_then(Value::as_str)
                .unwrap_or(&self.owner);
            extension == target
                && match method {
                    Some(method) => {
                        grant
                            .get("methods")
                            .and_then(Value::as_array)
                            .is_some_and(|methods| {
                                methods.iter().any(|value| value.as_str() == Some(method))
                            })
                    }
                    None => grant.get("configure").and_then(Value::as_bool) == Some(true),
                }
        })
    }
}

#[derive(Default)]
struct State {
    next_id: u64,
    busy: bool,
    response: String,
}

/// One guest's channel. Closing a guest cancels collection and drops late replies.
pub struct Session {
    pub policy: Policy,
    closed: AtomicBool,
    state: Mutex<State>,
    notify: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

/// Guest ownership is separate from worker references, including failed boots.
pub struct Channel(pub Arc<Session>);
impl std::ops::Deref for Channel {
    type Target = Arc<Session>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl Drop for Channel {
    fn drop(&mut self) {
        self.0.close();
    }
}

impl Session {
    pub fn new(policy: Policy) -> Arc<Self> {
        Arc::new(Self {
            policy,
            closed: AtomicBool::new(false),
            state: Mutex::new(State::default()),
            notify: Mutex::new(None),
        })
    }
    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.state.lock().unwrap().response.clear();
    }
    pub fn on_completion(&self, notify: Arc<dyn Fn() + Send + Sync>) {
        *self.notify.lock().unwrap() = Some(notify);
    }
    pub fn response(&self) -> String {
        self.state.lock().unwrap().response.clone()
    }
    pub fn submit(self: &Arc<Self>, raw: &str) {
        self.submit_with(raw, |request, cancel| request.run_with_cancel(cancel));
    }
    fn submit_with(
        self: &Arc<Self>,
        raw: &str,
        run: impl FnOnce(Request, &AtomicBool) -> Result<Value, String> + Send + 'static,
    ) {
        if self.closed.load(Ordering::Acquire) {
            return;
        }
        let request_id = (raw.len() <= 8192)
            .then(|| serde_json::from_str::<Value>(raw).ok())
            .flatten()
            .and_then(|v| v.get("requestId").cloned())
            .filter(|v| v.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 64));
        let request = Request::parse(raw).and_then(|request| {
            if self.policy.allows(&request) {
                Ok(request)
            } else {
                Err("App RPC permission denied".into())
            }
        });
        let mut state = self.state.lock().unwrap();
        state.next_id = state.next_id.wrapping_add(1).max(1);
        let id = state.next_id;
        // A rejected caller gets an explicit result carrying its own request ID.
        let error = if state.busy {
            Some("App RPC is busy".to_string())
        } else {
            request.as_ref().err().cloned()
        };
        if let Some(error) = error {
            state.response =
                json!({"id":id,"requestId":request_id,"busy":false,"ok":false,"error":error})
                    .to_string();
            return;
        }
        state.busy = true;
        state.response = json!({"id":id,"requestId":request_id,"busy":true}).to_string();
        drop(state);
        let this = self.clone();
        std::thread::spawn(move || {
            let result = run(request.unwrap(), &this.closed);
            let mut state = this.state.lock().unwrap();
            state.busy = false;
            if !this.closed.load(Ordering::Acquire) {
                state.response = match result {
                    Ok(value) => json!({"id":id,"requestId":request_id,"busy":false,"ok":true,"response":value}),
                    Err(error) => json!({"id":id,"requestId":request_id,"busy":false,"ok":false,"error":error}),
                }.to_string();
                drop(state);
                if let Some(notify) = this.notify.lock().unwrap().as_ref() { notify(); }
            }
        });
    }
}

pub enum Request {
    VirtualMedia { action: String, payload: String },
    Keyboard { action: String, payload: String },
    Services { action: String, payload: String },
    Security { action: String, payload: String },
    Power {
        action: String,
    },
    Invoke {
        extension: String,
        method: String,
        payload: String,
    },
    Configure {
        extension: String,
        payload: String,
    },
}

fn valid_name(value: &str) -> bool {
    value
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphanumeric)
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
}

impl Request {
    pub fn parse(raw: &str) -> Result<Self, String> {
        if raw.len() > 8192 {
            return Err("screen request is too large".into());
        }
        let value: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
        let extension = value
            .get("extension")
            .and_then(|v| v.as_str())
            .filter(|s| valid_name(s))
            .ok_or("invalid extension id")?
            .to_owned();
        let request = value
            .get("request")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let operation = value
            .get("operation")
            .and_then(|v| v.as_str())
            .unwrap_or("invoke");
        let payload = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        if payload.len() > 4096 {
            return Err("screen payload is too large".into());
        }
        match operation {
            "virtual-media" | "keyboard" if request.is_object() => {
                let action = value["method"].as_str().ok_or("missing control action")?;
                let allowed: &[&str] = if operation == "virtual-media" {
                    &["get", "browse", "mount", "eject", "connect", "disconnect"]
                } else { &["get", "press", "text"] };
                if !allowed.contains(&action) { return Err("invalid control action".into()); }
                if operation == "virtual-media" { Ok(Self::VirtualMedia { action: action.into(), payload }) }
                else { Ok(Self::Keyboard { action: action.into(), payload }) }
            }
            "security" if request.is_object() => {
                let action = value["method"].as_str()
                    .filter(|action| matches!(*action, "get" | "save" | "add-ban" | "remove-ban"))
                    .ok_or("invalid security action")?;
                Ok(Self::Security { action: action.into(), payload })
            }
            "services" if request.is_object() => {
                let action = value["method"].as_str()
                    .filter(|action| matches!(*action, "list" | "start" | "stop" | "restart"))
                    .ok_or("invalid service action")?;
                Ok(Self::Services { action: action.into(), payload })
            }
            "power" => {
                let action = request
                    .get("action")
                    .and_then(Value::as_str)
                    .filter(|action| matches!(*action, "on" | "off" | "reset"))
                    .ok_or("invalid power action")?;
                Ok(Self::Power {
                    action: action.into(),
                })
            }
            "invoke" => {
                let method = value
                    .get("method")
                    .and_then(|v| v.as_str())
                    .filter(|s| valid_name(s))
                    .ok_or("invalid extension method")?
                    .to_owned();
                Ok(Self::Invoke {
                    extension,
                    method,
                    payload,
                })
            }
            // Wrap only settings. Apps cannot smuggle an enabled flag into
            // the host's configure envelope or bypass schema validation.
            "configure" if request.is_object() => Ok(Self::Configure {
                extension,
                payload: serde_json::json!({"settings": request}).to_string(),
            }),
            _ => Err("invalid screen operation".into()),
        }
    }

    pub fn run(&self) -> Result<Value, String> {
        self.run_with_cancel(&AtomicBool::new(false))
    }

    pub fn run_with_cancel(&self, cancel: &AtomicBool) -> Result<serde_json::Value, String> {
        if cancel.load(Ordering::Acquire) {
            return Err("App session closed".into());
        }
        if let Self::Power { action } = self {
            crate::bus::core_power(action)?;
            return Ok(json!({"action":action}));
        }
        if let Self::Security { action, payload } = self {
            return crate::security::call(action, payload);
        }
        if let Self::VirtualMedia { action, payload } = self {
            return crate::local_control::call("VirtualMedia", action, payload);
        }
        if let Self::Keyboard { action, payload } = self {
            return crate::local_control::call("Keyboard", action, payload);
        }
        if let Self::Services { action, payload } = self {
            return crate::services::call(action, payload);
        }
        let (args, payload, configure) = match self {
            Self::Power { .. } | Self::Services { .. } | Self::Security { .. } | Self::VirtualMedia { .. } | Self::Keyboard { .. } => unreachable!(),
            Self::Invoke {
                extension,
                method,
                payload,
            } => (vec!["invoke", extension, method], payload, false),
            Self::Configure { extension, payload } => (vec!["configure", extension], payload, true),
        };
        let output = crate::command::run(
            Command::new("/usr/bin/onekvm-extension").args(args),
            payload.as_bytes(),
            Duration::from_secs(20),
            16 * 1024,
            cancel,
        )?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if error.is_empty() {
                "extension call failed".into()
            } else {
                error.chars().take(240).collect()
            });
        }
        if output.stdout.len() > 16 * 1024 {
            return Err("extension response is too large".into());
        }
        if configure {
            return Ok(serde_json::json!({"saved": true}));
        }
        serde_json::from_slice(&output.stdout).map_err(|_| "invalid extension response".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_and_keyboard_are_private_to_their_built_in_apps() {
        let media = Request::parse(r#"{"extension":"virtual-media","operation":"virtual-media","method":"browse","request":{}}"#).unwrap();
        let keyboard = Request::parse(r#"{"extension":"keyboard","operation":"keyboard","method":"press","request":{}}"#).unwrap();
        let contributor = Policy { owner: "virtual-media".into(), manage_extensions: true, grants: vec![json!({"methods":["browse","press"],"configure":true})], ..Policy::default() };
        assert!(!contributor.allows(&media)); assert!(!contributor.allows(&keyboard));
        assert!(Policy { media_actions: true, ..Policy::default() }.allows(&media));
        assert!(!Policy { media_actions: true, ..Policy::default() }.allows(&keyboard));
        assert!(Policy { keyboard_actions: true, ..Policy::default() }.allows(&keyboard));
        assert!(Request::parse(r#"{"extension":"virtual-media","operation":"virtual-media","method":"delete","request":{}}"#).is_err());
    }

    #[test]
    fn only_packaged_security_can_change_security_settings() {
        for method in ["get", "save", "add-ban", "remove-ban"] {
            let raw = json!({"extension":"security","operation":"security","method":method,"request":{}}).to_string();
            let request = Request::parse(&raw).unwrap();
            assert!(!policy().allows(&request));
            assert!(!Policy { owner: "security".into(), manage_extensions: true, ..Policy::default() }.allows(&request));
            assert!(Policy { security_actions: true, ..Policy::default() }.allows(&request));
        }
        assert!(Request::parse(r#"{"extension":"security","operation":"security","method":"shell","request":{}}"#).is_err());
    }

    #[test]
    fn only_the_builtin_services_policy_can_manage_services() {
        let request = Request::parse(r#"{"extension":"services","operation":"services","method":"stop","request":{"id":"system.ssh"}}"#).unwrap();
        assert!(!policy().allows(&request));
        let mut services = Policy::default();
        services.service_actions = true;
        assert!(services.allows(&request));
        assert!(Request::parse(r#"{"extension":"services","operation":"services","method":"shell","request":{}}"#).is_err());
        assert!(Request::parse(r#"{"extension":"services","operation":"services","method":"list","request":[]}"#).is_err());
    }

    fn policy() -> Policy {
        Policy {
            owner: "owner".into(),
            grants: vec![json!({"methods":["status"],"configure":true})],
            manage_extensions: false,
            power_actions: false,
            service_actions: false,
            security_actions: false,
            media_actions: false,
            keyboard_actions: false,
        }
    }

    #[test]
    fn identity_and_method_grants_are_enforced() {
        assert!(
            policy().allows(&Request::parse(r#"{"extension":"owner","method":"status"}"#).unwrap())
        );
        assert!(!policy()
            .allows(&Request::parse(r#"{"extension":"other","method":"status"}"#).unwrap()));
        assert!(
            !policy().allows(&Request::parse(r#"{"extension":"owner","method":"erase"}"#).unwrap())
        );
        assert!(!policy().allows(
            &Request::parse(r#"{"extension":"other","operation":"configure","request":{}}"#)
                .unwrap()
        ));
    }

    #[test]
    fn late_responses_and_busy_results_are_scoped_to_their_guest() {
        let first = Session::new(policy());
        let second = Session::new(policy());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        first.submit_with(
            r#"{"extension":"owner","method":"status","requestId":"A"}"#,
            move |_, _| {
                ready_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(json!({"secret":"first"}))
            },
        );
        ready_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        first.submit(r#"{"extension":"owner","method":"status","requestId":"B"}"#);
        let rejected: Value = serde_json::from_str(&first.response()).unwrap();
        assert_eq!(rejected["requestId"], "B");
        assert_eq!(rejected["ok"], false);
        assert_eq!(second.response(), "");
        first.close();
        release_tx.send(()).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while first.state.lock().unwrap().busy && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(!first.state.lock().unwrap().busy);
        assert_eq!(first.response(), "");
        assert_eq!(second.response(), "");
    }

    #[test]
    fn existing_invoke_contract_is_preserved() {
        let Request::Invoke {
            method, payload, ..
        } = Request::parse(
            r#"{"extension":"nanokvm-pro-hdmi-loopout","method":"status","request":{}}"#,
        )
        .unwrap()
        else {
            panic!("expected invoke")
        };
        assert_eq!(method, "status");
        assert_eq!(payload, "{}");
    }

    #[test]
    fn configure_wraps_partial_settings_without_lifecycle_flags() {
        let Request::Configure { payload, .. } = Request::parse(
            r#"{"extension":"nanokvm-pro-hdmi-loopout","operation":"configure","enabled":true,"request":{"privacy_enabled":true}}"#).unwrap()
            else { panic!("expected configure") };
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"settings":{"privacy_enabled":true}})
        );
    }

    #[test]
    fn rejects_invalid_commands_ids_and_payloads() {
        for raw in [
            r#"{"extension":"../bad","method":"status"}"#,
            r#"{"extension":"valid","method":"--help"}"#,
            r#"{"extension":"valid","operation":"enable","request":{}}"#,
            r#"{"extension":"valid","operation":"configure","request":true}"#,
        ] {
            assert!(Request::parse(raw).is_err(), "{raw}");
        }
    }
}
