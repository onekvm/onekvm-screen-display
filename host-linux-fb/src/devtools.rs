//! Per-guest, bounded PocketJS transport behind Core's session-authenticated Unix proxy.
//! No filesystem mailbox, public listener, or JS execution on an HTTP thread.
use crate::shared::Shared;
use anyhow::{bail, Result};
use pocket_mod::{qjs::Function, Guest};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const LEASE: Duration = Duration::from_secs(60);
const MAX_LINE: usize = 64 * 1024;
const EVENT_BYTES: usize = 512 * 1024;
const MAX_EVENTS: usize = 256;
const MAX_COMMANDS: usize = 16;
const MAX_CODE: usize = 4096;

#[derive(Default)]
struct Target {
    app: String,
    instance: String,
    role: String,
    commands: VecDeque<String>,
}

#[derive(Default)]
struct State {
    until: Option<Instant>,
    next_target: u64,
    sequence: u64,
    targets: BTreeMap<u64, Target>,
    events: VecDeque<(u64, u64, String)>,
    bytes: usize,
    dropped: u64,
}

impl State {
    fn disable(&mut self) {
        self.until = None;
        self.events.clear();
        self.bytes = 0;
        for target in self.targets.values_mut() {
            target.commands.clear();
            // These cleanup commands must still be polled with developer mode off.
            target.commands.push_back("{\"t\":\"resume\"}".into());
            target
                .commands
                .push_back("{\"t\":\"inspect\",\"id\":0}".into());
        }
    }
    fn expire(&mut self) {
        if self.until.is_some_and(|at| at <= Instant::now()) {
            self.disable();
        }
    }
    fn emit(&mut self, target: u64, line: String) {
        if self.until.is_none() || !self.targets.contains_key(&target) {
            return;
        }
        if line.len() > MAX_LINE {
            self.dropped += 1;
            return;
        }
        if serde_json::from_str::<Value>(&line).is_err() {
            return;
        }
        while self.events.len() >= MAX_EVENTS || self.bytes + line.len() > EVENT_BYTES {
            if let Some((_, _, old)) = self.events.pop_front() {
                self.bytes -= old.len();
                self.dropped += 1;
            } else {
                break;
            }
        }
        self.sequence += 1;
        self.bytes += line.len();
        self.events.push_back((self.sequence, target, line));
    }
}

#[derive(Default)]
pub struct Hub(Mutex<State>);

impl Hub {
    pub fn attach(
        self: &Arc<Self>,
        guest: &Guest,
        app: &str,
        instance: &str,
        role: &str,
    ) -> Result<Connection> {
        let id = {
            let mut state = self.0.lock().unwrap();
            anyhow::ensure!(state.targets.len() < 16, "too many developer targets");
            state.next_target += 1;
            let id = state.next_target;
            state.targets.insert(
                id,
                Target {
                    app: app.into(),
                    instance: instance.into(),
                    role: role.into(),
                    ..Default::default()
                },
            );
            id
        };
        let connection = Connection {
            hub: self.clone(),
            id,
        };
        guest.mount("__pocketDevtoolsTransport", |ctx, ns| {
            let hub = self.clone();
            ns.set(
                "recv",
                Function::new(ctx.clone(), move || -> Option<String> {
                    let mut state = hub.0.lock().unwrap();
                    state.expire();
                    state.targets.get_mut(&id)?.commands.pop_front()
                })?,
            )?;
            let hub = self.clone();
            ns.set(
                "send",
                Function::new(ctx.clone(), move |line: String| {
                    let mut state = hub.0.lock().unwrap();
                    state.expire();
                    state.emit(id, line);
                })?,
            )?;
            ns.set("everyFrames", 1)?;
            Ok(())
        })?;
        Ok(connection)
    }

    fn snapshot(&self, after: u64) -> Value {
        let mut state = self.0.lock().unwrap();
        state.expire();
        if state.until.is_some() {
            state.until = Some(Instant::now() + LEASE);
        }
        json!({"enabled":state.until.is_some(), "cursor":state.sequence, "dropped":state.dropped,
            "targets":state.targets.iter().map(|(id,t)| json!({"id":id.to_string(),"app":t.app,"instance":t.instance,"role":t.role})).collect::<Vec<_>>(),
            "events":state.events.iter().filter(|(seq,_,_)| *seq > after).map(|(seq,target,line)|
                json!({"sequence":seq,"target":target.to_string(),"message":serde_json::from_str::<Value>(line).unwrap_or(Value::Null)})).collect::<Vec<_>>()})
    }

    fn action(&self, request: &Value) -> Result<()> {
        let mut state = self.0.lock().unwrap();
        state.expire();
        match request["action"].as_str() {
            Some("enable") => {
                state.until = Some(Instant::now() + LEASE);
            }
            Some("disable") => state.disable(),
            Some("command") => {
                anyhow::ensure!(state.until.is_some(), "developer mode is off");
                let id = request["target"]
                    .as_str()
                    .and_then(|id| id.parse::<u64>().ok())
                    .ok_or_else(|| anyhow::anyhow!("invalid target"))?;
                let command = &request["command"];
                match command["t"].as_str() {
                    Some("getTree" | "pause" | "resume" | "devStats") => {}
                    Some("step") => {
                        anyhow::ensure!(
                            command.get("n").is_none() || command["n"] == 1,
                            "step accepts one frame"
                        );
                    }
                    Some("inspect") => {
                        anyhow::ensure!(
                            command["id"]
                                .as_u64()
                                .is_some_and(|id| id <= i32::MAX as u64),
                            "invalid node"
                        );
                    }
                    Some("eval") => {
                        anyhow::ensure!(
                            command["code"]
                                .as_str()
                                .is_some_and(|code| code.len() <= MAX_CODE),
                            "expression exceeds 4096 bytes"
                        );
                    }
                    _ => bail!("unsupported debug command"),
                }
                let target = state
                    .targets
                    .get_mut(&id)
                    .ok_or_else(|| anyhow::anyhow!("target closed; select a running target"))?;
                anyhow::ensure!(
                    target.commands.len() < MAX_COMMANDS,
                    "debug command queue is full"
                );
                target.commands.push_back(command.to_string());
            }
            _ => bail!("unknown developer action"),
        }
        Ok(())
    }
}

pub struct Connection {
    hub: Arc<Hub>,
    id: u64,
}
impl Connection {
    pub fn pending(&self) -> bool {
        let mut state = self.hub.0.lock().unwrap();
        state.expire();
        state
            .targets
            .get(&self.id)
            .is_some_and(|target| !target.commands.is_empty())
    }
    pub fn error(&self, error: &str) {
        self.hub.0.lock().unwrap().emit(
            self.id,
            json!({"t":"error","message":error.chars().take(2048).collect::<String>()}).to_string(),
        );
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        self.hub.0.lock().unwrap().targets.remove(&self.id);
    }
}

pub fn serve(
    shared: &Arc<Shared>,
    method: &str,
    path: &str,
    length: Option<u64>,
    reader: &mut impl Read,
    writer: &mut impl Write,
) -> Result<()> {
    let result: Result<Value> = (|| {
        match method {
            "GET" => {
                let after = path
                    .split_once('?')
                    .and_then(|(_, q)| q.strip_prefix("after="))
                    .unwrap_or("0")
                    .parse::<u64>()?;
                Ok(shared.devtools.snapshot(after))
            }
            "POST" => {
                let length = length.ok_or_else(|| anyhow::anyhow!("Content-Length required"))?;
                anyhow::ensure!(length <= 8192, "developer request too large");
                let mut bytes = vec![0; length as usize];
                reader.read_exact(&mut bytes)?;
                let request: Value = serde_json::from_slice(&bytes)?;
                if request["action"] == "reload" {
                    anyhow::ensure!(
                        shared.devtools.snapshot(0)["enabled"] == true,
                        "developer mode is off"
                    );
                    shared.request_catalog_refresh();
                } else {
                    shared.devtools.action(&request)?;
                }
                shared.wake.notify();
                // The regular frame timer makes active, idle and paused guests repaint.
                shared.frame_timer.schedule_earlier(Duration::ZERO);
                Ok(json!({"ok":true}))
            }
            _ => bail!("unsupported method"),
        }
    })();
    let (status, body) = match result {
        Ok(value) => ("200 OK", value),
        Err(error) => ("400 Bad Request", json!({"error":error.to_string()})),
    };
    let body = body.to_string();
    write!(writer, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn targets_are_isolated_and_disabling_cancels_eval_and_resumes() {
        let hub = Arc::new(Hub::default());
        let a = Guest::new().unwrap();
        let b = Guest::new().unwrap();
        let first = hub.attach(&a, "example/home", "home", "home").unwrap();
        let second = hub
            .attach(&b, "example/widget", "counter-2", "widget")
            .unwrap();
        let command = json!({"action":"command","target":first.id.to_string(),"command":{"t":"eval","code":"1+1"}});
        assert!(hub.action(&command).is_err());
        hub.action(&json!({"action":"enable"})).unwrap();
        hub.action(&command).unwrap();
        assert!(first.pending());
        assert!(!second.pending());
        hub.action(&json!({"action":"disable"})).unwrap();
        a.eval("cleanup", "if (JSON.parse(__pocketDevtoolsTransport.recv()).t !== 'resume') throw Error('unsafe cleanup')").unwrap();
        assert!(hub.snapshot(0)["events"].as_array().unwrap().is_empty());
        drop(first);
        assert_eq!(hub.snapshot(0)["targets"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn lease_expiry_and_floods_stay_bounded() {
        let hub = Arc::new(Hub::default());
        let guest = Guest::new().unwrap();
        let target = hub.attach(&guest, "example/home", "home", "home").unwrap();
        hub.action(&json!({"action":"enable"})).unwrap();
        {
            let mut state = hub.0.lock().unwrap();
            for _ in 0..1000 {
                state.emit(
                    target.id,
                    json!({"t":"log","args":["x".repeat(4000)]}).to_string(),
                );
            }
            assert!(state.bytes <= EVENT_BYTES);
            assert!(state.events.len() <= MAX_EVENTS);
            assert!(state.dropped > 0);
            state.until = Some(Instant::now() - Duration::from_secs(1));
        }
        assert!(target.pending());
        assert_eq!(hub.snapshot(0)["enabled"], false);
    }

    #[test]
    #[ignore = "requires the generated screen-sdk-example home JS/PAK"]
    fn sdk_bundle_supports_tree_eval_pause_step_and_timeout() -> Result<()> {
        use crate::guest::HostedGuest;
        use pocket_ui_surface::UiSurface;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../examples/screen-sdk-example/dist/home");
        let source = std::fs::read_to_string(root.join("main.vue-vapor.js"))?;
        let surface = UiSurface::new((320.0, 172.0));
        surface.feed_pak(&std::fs::read(root.join("main.vue-vapor.pak"))?);
        let guest = HostedGuest::new(true)?;
        guest.mount("onekvm", |ctx, ns| {
            ns.set(
                "get",
                Function::new(ctx.clone(), |key: String| -> String {
                    match key.as_str() {
                        "screenW" => "320",
                        "screenH" => "172",
                        "screenState" | "surfaceContext" => "{}",
                        "language" => "en",
                        "controls" => "[\"touch\",\"rotary\"]",
                        _ => "",
                    }
                    .into()
                })?,
            )?;
            ns.set(
                "set",
                Function::new(ctx.clone(), |_: String, _: String| {})?,
            )?;
            Ok(())
        })?;
        surface.mount(&guest)?;
        let hub = Arc::new(Hub::default());
        let target = hub.attach(&guest, "example/home", "home", "home")?;
        hub.action(&json!({"action":"enable"}))?;
        guest.eval("home", &source)?;
        let send = |command| {
            hub.action(
                &json!({"action":"command","target":target.id.to_string(),"command":command}),
            )
        };
        let tick = || -> Result<()> {
            guest.arm(Duration::from_millis(50));
            guest.frame(0)?;
            surface.tick();
            Ok(())
        };
        tick()?;
        send(json!({"t":"pause"}))?;
        tick()?;
        assert!(surface.with_ui(|ui| ui.debug_paused()));
        send(
            json!({"t":"eval","id":1,"code":"globalThis.debugCheck = 40; console.log('debug-bridge'); debugCheck + 2"}),
        )?;
        send(json!({"t":"getTree"}))?;
        tick()?;
        let snapshot = hub.snapshot(0);
        let events = snapshot["events"].as_array().unwrap();
        assert!(events
            .iter()
            .any(|e| e["message"]["t"] == "tree" && e["message"]["root"]["k"].is_array()));
        assert!(events.iter().any(|e| e["message"]["t"] == "log"));
        assert!(events
            .iter()
            .any(|e| e["message"]["t"] == "evalResult" && e["message"]["value"] == "42"));
        let frame = events
            .iter()
            .rev()
            .find_map(|e| e["message"]["frame"].as_u64())
            .unwrap();
        send(json!({"t":"step","n":1}))?;
        tick()?;
        tick()?;
        send(json!({"t":"devStats"}))?;
        tick()?;
        let snapshot = hub.snapshot(0);
        let next = snapshot["events"]
            .as_array()
            .unwrap()
            .iter()
            .rev()
            .find_map(|e| e["message"]["frame"].as_u64())
            .unwrap();
        assert_eq!(next, frame + 1);
        send(json!({"t":"eval","id":2,"code":"while(true) {}"}))?;
        let start = Instant::now();
        let _ = tick();
        assert!(start.elapsed() < Duration::from_secs(1));
        hub.action(&json!({"action":"disable"}))?;
        tick()?;
        assert!(!surface.with_ui(|ui| ui.debug_paused()));
        Ok(())
    }
}
