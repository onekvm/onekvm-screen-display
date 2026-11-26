use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

struct Registry {
    faces: String,
    widgets: String,
    widgets_base: String,
    apps: String,
    homes: String,
    epoch: String,
    valid: bool,
    errors: std::collections::BTreeMap<String, String>,
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| {
        Mutex::new(Registry {
            faces: "[]".into(),
            widgets: "[]".into(),
            widgets_base: "[]".into(),
            apps: "[]".into(),
            homes: "[]".into(),
            epoch: String::new(),
            valid: false,
            errors: Default::default(),
        })
    })
}

/// Refresh off the frame path. The extension host filters disabled plugins
/// and verifies that each item matches the active point version.
pub fn epoch() -> String {
    std::fs::read_to_string("/run/onekvm/contributions-generation").unwrap_or_default()
}

pub fn ready() -> bool {
    registry()
        .lock()
        .map(|current| current.valid)
        .unwrap_or(false)
}

pub fn errors() -> serde_json::Value {
    serde_json::to_value(&registry().lock().unwrap().errors).unwrap_or_default()
}

pub fn refresh() -> bool {
    let epoch = epoch();
    let results = std::thread::scope(|scope| {
        let handles: Vec<_> = [
            "screen-display.app",
            "screen-display.home",
            "screen-display.face",
            "screen-display.widget",
        ]
        .into_iter()
        .map(|point| (point, scope.spawn(move || query(point))))
        .collect();
        handles
            .into_iter()
            .map(|(point, handle)| {
                (
                    point,
                    handle
                        .join()
                        .unwrap_or_else(|_| Err("catalog query panicked".into())),
                )
            })
            .collect::<Vec<_>>()
    });
    // Discard mixed snapshots if a lifecycle mutation happened during queries.
    if epoch != self::epoch() {
        return false;
    }
    let Ok(mut current) = registry().lock() else {
        return false;
    };
    let mut changed = false;
    let previous_valid = current.valid;
    let executable_ready = results.iter().filter(|(point, _)| *point != "screen-display.face").all(|(_, result)| result.is_ok());
    if executable_ready { current.valid = true; }
    else if current.epoch != epoch { current.valid = false; }
    changed |= previous_valid != current.valid;
    for (point, result) in results {
        match result {
            Ok(next) => {
                current.errors.remove(point);
                let old = match point {
                    "screen-display.app" => {
                        current.epoch = epoch.clone();
                        &mut current.apps
                    }
                    "screen-display.face" => &mut current.faces,
                    "screen-display.home" => &mut current.homes,
                    _ => {
                        if current.widgets_base == next {
                            continue;
                        }
                        current.widgets_base = next.clone();
                        &mut current.widgets
                    }
                };
                if *old != next {
                    *old = next;
                    changed = true;
                }
            }
            Err(error) => {
                if point == "screen-display.app" && current.epoch != epoch {
                    current.valid = false;
                    changed = true;
                }
                log::warn!("{point} catalog: {error}");
                current.errors.insert(point.into(), error);
            }
        }
    }
    changed
}

/// Called at discovery and explicit producer invalidation, with a total budget.
pub fn refresh_widgets() -> bool {
    let original = list("screen-display.widget");
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&original) else {
        return false;
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    enrich_widgets(&mut value, deadline);
    let next = value.to_string();
    let mut current = registry().lock().unwrap();
    if current.widgets != original || next == original {
        return false;
    }
    current.widgets = next;
    true
}

pub fn list(point: &str) -> String {
    let Ok(current) = registry().lock() else {
        return "[]".into();
    };
    match point {
        "screen-display.face" => current.faces.clone(),
        "screen-display.widget" => current.widgets.clone(),
        "screen-display.app" => current.apps.clone(),
        "screen-display.home" => current.homes.clone(),
        _ => "[]".into(),
    }
}

fn query(point: &str) -> Result<String, String> {
    let output = crate::command::run(
        Command::new("/usr/bin/onekvm-extension").args(["contributions", point]),
        b"",
        Duration::from_secs(3),
        256 * 1024,
        &AtomicBool::new(false),
    )?;
    if !output.status.success() {
        return Err("extension catalog unavailable".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    if !value.is_array() {
        return Err("invalid catalog response".into());
    }
    Ok(value.to_string())
}

fn enrich_widgets(value: &mut serde_json::Value, deadline: Instant) {
    {
        if let Some(entries) = value.as_array_mut() {
            for entry in entries {
                let source = entry
                    .get("source")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                let method = entry
                    .get("method")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                if source.is_empty() || method.is_empty() {
                    continue;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                let Ok(output) = crate::command::run(
                    Command::new("/usr/bin/onekvm-extension").args(["invoke", source, method]),
                    b"",
                    remaining.min(Duration::from_millis(500)),
                    4096,
                    &AtomicBool::new(false),
                ) else {
                    continue;
                };
                if !output.status.success() || output.stdout.len() > 4096 {
                    continue;
                }
                let Ok(state) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
                    continue;
                };
                let Some(data) = entry
                    .get_mut("data")
                    .and_then(|value| value.as_object_mut())
                else {
                    continue;
                };
                if let Some(text) = state.get("text").and_then(|value| value.as_str()) {
                    data.insert(
                        "preview".into(),
                        serde_json::Value::String(text.chars().take(24).collect()),
                    );
                }
                if let Some(accent) = state.get("accent").and_then(|value| value.as_str()) {
                    if accent.len() == 7
                        && accent.starts_with('#')
                        && accent[1..].bytes().all(|ch| ch.is_ascii_hexdigit())
                    {
                        data.insert("accent".into(), serde_json::Value::String(accent.into()));
                    }
                }
            }
        }
    }
}
