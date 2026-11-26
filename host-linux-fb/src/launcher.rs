//! Launcher grid: icon pages are `columns × rows` (default 3×3). Machines
//! override via `/usr/share/onekvm/machine.json` `screen_display`, then
//! `/usr/share/onekvm/screen-display/launcher.json`.

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use serde_json::{json, Value};

static JSON: Mutex<String> = Mutex::new(String::new());

#[derive(Clone, Copy, Debug)]
pub struct Launcher {
    pub icon_columns: u8,
    pub icon_rows: u8,
    pub icon_size: u16,
    pub list_rows: u8,
}

impl Default for Launcher {
    fn default() -> Self {
        Self {
            icon_columns: 3,
            icon_rows: 3,
            icon_size: 52,
            list_rows: 4,
        }
    }
}

pub fn json() -> String {
    let cached = JSON.lock().unwrap();
    if cached.is_empty() {
        drop(cached);
        reload();
        return JSON.lock().unwrap().clone();
    }
    cached.clone()
}

pub fn reload() {
    let l = load();
    let encoded = json!({
        "icon_columns": l.icon_columns,
        "icon_rows": l.icon_rows,
        "icon_size": l.icon_size,
        "list_rows": l.list_rows,
    })
    .to_string();
    if let Ok(mut slot) = JSON.lock() {
        *slot = encoded;
    }
}

pub fn load() -> Launcher {
    let mut launcher = Launcher::default();
    merge(
        &mut launcher,
        load_json(Path::new("/usr/share/onekvm/machine.json"))
            .and_then(|v| v.get("screen_display").cloned()),
    );
    merge(
        &mut launcher,
        load_json(Path::new("/usr/share/onekvm/screen-display/launcher.json")),
    );
    launcher
}

fn load_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn merge(launcher: &mut Launcher, value: Option<Value>) {
    let Some(Value::Object(map)) = value else {
        return;
    };
    if let Some(n) = int_field(&map, "icon_columns") {
        launcher.icon_columns = n.clamp(1, 5) as u8;
    }
    if let Some(n) = int_field(&map, "icon_rows") {
        launcher.icon_rows = n.clamp(1, 5) as u8;
    }
    if let Some(n) = int_field(&map, "icon_size") {
        launcher.icon_size = n.clamp(24, 96) as u16;
    }
    if let Some(n) = int_field(&map, "list_rows") {
        launcher.list_rows = n.clamp(1, 8) as u8;
    }
}

fn int_field(map: &serde_json::Map<String, Value>, name: &str) -> Option<i64> {
    map.get(name).and_then(Value::as_i64)
}
