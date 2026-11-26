use serde_json::{json, Value};

const MAX_SANE_BYTES: u64 = 10_000_000_000_000_000; // 10 PB

pub fn overlay_system_json(raw: &str, resources: Option<&Value>) -> String {
    let Ok(mut value) = serde_json::from_str::<Value>(raw) else {
        return raw.to_string();
    };
    let Some(system) = value.get_mut("system").and_then(Value::as_object_mut) else {
        return raw.to_string();
    };
    let reported = system
        .get("storage_total_bytes")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let (total, available) = storage_usage("/data")
        .or_else(|| storage_usage("/"))
        .unwrap_or((0, 0));
    if !plausible(reported) || reported == 0 {
        system.insert("storage_total_bytes".into(), json!(total));
        system.insert("storage_available_bytes".into(), json!(available));
    }
    if let Some(resources) = resources {
        merge_resources(&mut value, resources);
    }
    value.to_string()
}

/// Merge only renderable resource values. Sample timestamps do not dirty pixels.
pub fn merge_resources(state: &mut Value, resources: &Value) -> bool {
    let Some(system) = state.get_mut("system").and_then(Value::as_object_mut) else { return false; };
    let mut changed = false;
    for key in ["cpu_percent", "memory_used_bytes", "memory_total_bytes", "temperature_celsius"] {
        if let Some(value) = resources.get(key).filter(|value| value.is_number()) {
            if system.get(key) != Some(value) {
                system.insert(key.into(), value.clone());
                changed = true;
            }
        }
    }
    if let (Some(used), Some(total)) = (resources["memory_used_bytes"].as_u64(), resources["memory_total_bytes"].as_u64()) {
        let available = json!(total.saturating_sub(used));
        if system.get("memory_available_bytes") != Some(&available) {
            system.insert("memory_available_bytes".into(), available);
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resources_update_without_core_state_events_and_keep_other_state() {
        let mut state = json!({"system":{"storage_total_bytes":1024},"network":{"ip":"192.0.2.10"}});
        assert!(merge_resources(&mut state, &json!({"cpu_percent":25.5,"memory_total_bytes":100,"memory_used_bytes":40,"timestamp":1})));
        assert_eq!(state["system"]["cpu_percent"], 25.5);
        assert_eq!(state["system"]["memory_available_bytes"], 60);
        assert!(merge_resources(&mut state, &json!({"cpu_percent":0.0,"timestamp":2})));
        assert_eq!(state["system"]["cpu_percent"], 0.0);
        assert_eq!(state["network"]["ip"], "192.0.2.10");
        assert_eq!(state["system"]["storage_total_bytes"], 1024);
        assert!(state["system"].get("timestamp").is_none());
    }

    #[test]
    fn resource_timestamps_and_invalid_values_do_not_repaint() {
        let mut state = json!({"system":{"cpu_percent":25.5}});
        assert!(!merge_resources(&mut state, &json!({"cpu_percent":25.5,"timestamp":99})));
        assert!(!merge_resources(&mut state, &json!({"cpu_percent":"invalid"})));
        assert!(!merge_resources(&mut state, &Value::Null));
    }

    #[test]
    fn new_core_state_preserves_the_latest_resource_sample() {
        let resources = json!({"cpu_percent":12.5,"memory_total_bytes":100,"memory_used_bytes":40});
        let state: Value = serde_json::from_str(&overlay_system_json(r#"{"system":{"cpu_percent":99,"storage_total_bytes":1024}}"#, Some(&resources))).unwrap();
        assert_eq!(state["system"]["cpu_percent"], 12.5);
        assert_eq!(state["system"]["memory_available_bytes"], 60);
    }
}

fn plausible(bytes: u64) -> bool {
    bytes > 0 && bytes <= MAX_SANE_BYTES
}

fn storage_usage(path: &str) -> Option<(u64, u64)> {
    let c_path = std::ffi::CString::new(path).ok()?;
    let mut vfs = unsafe { std::mem::zeroed::<libc::statvfs>() };
    if unsafe { libc::statvfs(c_path.as_ptr(), &mut vfs) } != 0 {
        return None;
    }
    let frsize = vfs.f_frsize as u64;
    if frsize == 0 {
        return None;
    }
    let total = (vfs.f_blocks as u64).saturating_mul(frsize);
    let available = (vfs.f_bavail as u64).saturating_mul(frsize);
    if !plausible(total) {
        return None;
    }
    Some((total, available))
}
