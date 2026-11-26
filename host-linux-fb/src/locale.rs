use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use crate::bus;

static LANG: Mutex<String> = Mutex::new(String::new());
static TIMEZONE: Mutex<String> = Mutex::new(String::new());

const ZONEINFO: &str = "/usr/share/zoneinfo";
const LOCALTIME: &str = "/etc/localtime";

pub fn normalize_language(raw: &str) -> &'static str {
    let n = raw.trim().to_ascii_lowercase().replace('-', "_");
    match n.as_str() {
        "zh" | "zh_cn" => "zh",
        "zh_tw" => "zh_tw",
        _ => "en",
    }
}

pub fn parse_config_string(raw: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(text) = value.as_str() {
            return text.to_string();
        }
    }
    raw.trim().trim_matches('"').to_string()
}

fn language_file() -> PathBuf {
    crate::shared::extension_data_dir().join("language")
}

pub fn accept_language(raw: &str) -> bool {
    let raw = parse_config_string(raw);
    if raw.trim().is_empty() { return false; }
    let value = normalize_language(&raw);
    let mut lang = LANG.lock().unwrap();
    if lang.as_str() == value { return false; }
    *lang = value.into();
    drop(lang);
    if !crate::mode::is_init() { crate::apps::rebuild_for_language(); }
    true
}

pub fn read_language() -> String {
    let lang = LANG.lock().map(|g| g.clone()).unwrap_or_default();
    if lang.is_empty() {
        "en".into()
    } else {
        lang
    }
}

pub fn write_language(raw: &str) -> bool {
    let lang = normalize_language(raw);
    let _ = fs::create_dir_all(crate::shared::extension_data_dir());
    let _ = fs::write(language_file(), format!("{lang}\n"));
    let ok = bus::core_set_config_value("system.language", lang);
    if let Ok(mut slot) = LANG.lock() {
        *slot = lang.to_string();
    }
    if !crate::mode::is_init() {
        crate::apps::rebuild_for_language();
    }
    ok
}

pub fn read_timezone() -> String {
    let tz = TIMEZONE.lock().unwrap();
    if tz.is_empty() { "UTC".into() } else { tz.clone() }
}

pub fn sync_process_timezone() {
    let tz = timezone_from_localtime().or_else(timedatectl_timezone).unwrap_or_else(|| "UTC".into());
    apply_process_timezone(&tz);
}

pub fn write_timezone(tz: &str) -> bool {
    let tz = tz.trim();
    if !valid_timezone(tz) {
        return false;
    }
    let ok = if timedatectl(&["set-timezone", tz]) {
        true
    } else {
        let target = Path::new(ZONEINFO).join(tz);
        let _ = fs::remove_file(LOCALTIME);
        symlink(&target, LOCALTIME).is_ok()
    };
    if ok {
        apply_process_timezone(tz);
    }
    ok
}

fn apply_process_timezone(tz: &str) {
    *TIMEZONE.lock().unwrap() = tz.to_string();
    std::env::set_var("TZ", tz);
    unsafe extern "C" {
        fn tzset();
    }
    unsafe { tzset() };
}

pub fn home_hint(lang: &str) -> &'static str {
    match normalize_language(lang) {
        "zh" => "再滑一次返回首页",
        "zh_tw" => "再滑一次返回首頁",
        _ => "Swipe again for Home",
    }
}

pub fn knob_hold_hint(lang: &str) -> &'static str {
    match normalize_language(lang) {
        "zh" => "继续按下将返回",
        "zh_tw" => "繼續按下將返回",
        _ => "Keep holding to go Home",
    }
}

fn valid_timezone(tz: &str) -> bool {
    if tz.is_empty() || tz.contains("..") || tz.starts_with('/') {
        return false;
    }
    Path::new(ZONEINFO).join(tz).exists()
}

fn timezone_from_localtime() -> Option<String> {
    let target = fs::read_link(LOCALTIME).ok()?;
    let target = if target.is_absolute() {
        target
    } else {
        Path::new(LOCALTIME).parent()?.join(target)
    };
    let path = fs::canonicalize(&target).ok()?;
    let root = fs::canonicalize(ZONEINFO).ok()?;
    let relative = path.strip_prefix(root).ok()?;
    let text = relative.to_string_lossy().replace('\\', "/");
    if text.is_empty() || text.starts_with("..") {
        None
    } else {
        Some(text)
    }
}

fn timedatectl(args: &[&str]) -> bool {
    Command::new("timedatectl")
        .args(args)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn timedatectl_timezone() -> Option<String> {
    let output = Command::new("timedatectl")
        .args(["show", "-p", "Timezone", "--value"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
