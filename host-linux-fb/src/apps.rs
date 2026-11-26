//! Screen-display app plugins. Built-ins use `plugin.json` (or `pocket.json`)
//! beside their PocketJS files; installed extensions contribute bundles via
//! `screen-display.app`. Shell and the web designer both read this registry.

use std::collections::BTreeMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};

use crate::dist_roots;

struct Catalog {
    plugins: Vec<AppPlugin>,
    json: String,
}

static CATALOG: Mutex<Catalog> = Mutex::new(Catalog {
    plugins: Vec::new(),
    json: String::new(),
});

#[derive(Clone, Debug)]
pub struct AppPlugin {
    pub id: String,
    pub title: String,
    pub titles: BTreeMap<String, String>,
    pub icon: String,
    pub slots: Vec<String>,
    pub controls: Vec<String>,
    pub order: i32,
    icon_asset: Option<PathBuf>,
    bundle: Option<PathBuf>,
    revision: u64,
    policy: crate::app_rpc::Policy,
}

/// Only paths resolved and validated by the app catalog reach the renderer.
pub fn launcher_icons() -> Vec<(String, PathBuf)> {
    CATALOG.lock().map(|cat| cat.plugins.iter().filter_map(|plugin| {
        plugin.icon_asset.as_ref().map(|path| (plugin.icon.clone(), path.clone()))
    }).collect()).unwrap_or_default()
}

static FAILURES: Mutex<BTreeMap<String, (u64, u32, std::time::Instant, String)>> = Mutex::new(BTreeMap::new());

pub fn record_failure(id: &str, error: &str) {
    let revision = revision(id).unwrap_or_default();
    let mut failures = FAILURES.lock().unwrap();
    let state = failures.entry(id.into()).or_insert((revision, 0, std::time::Instant::now(), String::new()));
    if state.0 != revision || state.2.elapsed() >= std::time::Duration::from_secs(30) { state.0 = revision; state.1 = 0; }
    state.1 += 1;
    state.2 = std::time::Instant::now();
    state.3 = error.chars().take(240).collect();
}

pub fn failures() -> Value {
    Value::Object(FAILURES.lock().unwrap().iter().map(|(id, (_, count, _, error))| (id.clone(), json!({"failures":count,"error":error}))).collect())
}

pub fn launcher_fonts() -> Vec<(PathBuf, String)> {
    CATALOG.lock().unwrap().plugins.iter().filter_map(|app| {
        Some((app.bundle.as_ref()?.join("main.vue-vapor.pak"), app.titles.values().cloned().collect::<Vec<_>>().join("")))
    }).collect()
}

pub fn icons_json() -> String {
    let icons: BTreeMap<_, _> = launcher_icons().into_iter().filter_map(|(key,path)| {
        Some((key, crate::remote::base64(&fs::read(path).ok()?)))
    }).collect();
    serde_json::to_string(&icons).unwrap_or_else(|_| "{}".into())
}

pub fn can_launch(id: &str) -> bool {
    let rev = revision(id).unwrap_or_default();
    if FAILURES.lock().unwrap().get(id).is_some_and(|(old, count, at, _)| *old == rev && *count >= 3 && at.elapsed() < std::time::Duration::from_secs(30)) { return false; }
    if id.contains('/') && !crate::contributions::ready() { return false; }
    if id == "shell" {
        return true;
    }
    CATALOG
        .lock()
        .map(|cat| cat.plugins.iter().any(|plugin| plugin.id == id))
        .unwrap_or(false)
}

/// Return the bundle directory for an app registered through the generic app
/// catalog. Built-in apps continue to resolve through the PocketJS dist root.
pub fn bundle_dir(id: &str) -> Option<PathBuf> {
    CATALOG.lock().ok().and_then(|cat| {
        cat.plugins
            .iter()
            .find(|plugin| plugin.id == id)
            .and_then(|plugin| plugin.bundle.clone())
    })
}

pub fn signature() -> String {
    let catalog = CATALOG.lock().unwrap();
    format!("{}:{:?}",catalog.json,catalog.plugins.iter().map(|app| app.revision).collect::<Vec<_>>())
}

pub fn revision(id: &str) -> Option<u64> {
    CATALOG.lock().ok()?.plugins.iter().find(|app| app.id == id).map(|app| app.revision)
}

pub fn policy(id: &str) -> crate::app_rpc::Policy {
    let mut policy = CATALOG.lock().ok().and_then(|cat| cat.plugins.iter().find(|app| app.id == id).map(|app| app.policy.clone())).unwrap_or_default();
    policy.power_actions = id == "power";
    policy.service_actions = id == "services";
    policy.security_actions = id == "security";
    policy.media_actions = id == "virtual-media";
    policy.keyboard_actions = id == "keyboard";
    policy
}

/// Identify a bundle by its files' inode, size and timestamps. Packages replace
/// bundle files atomically, so any update yields a new inode. Reading the
/// contents here would pull every installed App into the page cache, which is
/// charged to the screen service on every catalog refresh.
pub fn bundle_revision(dir: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    let mut digest = std::collections::hash_map::DefaultHasher::new();
    dir.hash(&mut digest);
    for name in ["main.vue-vapor.js", "main.vue-vapor.pak", "main.vue-vapor.jsc", "main.vue-vapor.jsc.abi", "main.vue-vapor.jsc.meta"] {
        name.hash(&mut digest);
        fs::metadata(dir.join(name))
            .ok()
            .map(|meta| (meta.dev(), meta.ino(), meta.len(), meta.mtime(), meta.mtime_nsec(), meta.ctime(), meta.ctime_nsec()))
            .hash(&mut digest);
    }
    digest.finish()
}

pub fn apps_json() -> String {
    let cat = CATALOG.lock().unwrap();
    if cat.json.is_empty() {
        drop(cat);
        refresh();
        return CATALOG.lock().unwrap().json.clone();
    }
    cat.json.clone()
}

pub fn has_slot(id: &str, slot: &str) -> bool {
    CATALOG.lock().unwrap().plugins.iter().any(|app| app.id == id && app.slots.iter().any(|item| item == slot))
}

pub fn supports_controls(id: &str, controls: &[String]) -> bool {
    CATALOG.lock().unwrap().plugins.iter().find(|app| app.id == id)
        .is_some_and(|app| app.controls.is_empty() || app.controls.iter().any(|mode| controls.contains(mode)))
}

pub fn surfaces_json(slot: &str) -> String {
    encode(&CATALOG.lock().unwrap().plugins.iter().filter(|app| app.slots.iter().any(|item| item == slot)).cloned().collect::<Vec<_>>(), "")
}

/// Rescan plugin dirs. Call from boot or D-Bus Refresh — not from the frame path.
pub fn refresh() {
    let lang = crate::locale::read_language();
    let plugins = scan();
    let json = encode(&plugins, &lang);
    let ids: Vec<_> = plugins.iter().map(|plugin| plugin.id.clone()).collect();
    if let Ok(mut cat) = CATALOG.lock() {
        cat.plugins = plugins;
        cat.json = json;
    }
    crate::prune_app_caches(&ids);
}

/// Paths owned by installed catalogs and contributed bundles. The event
/// worker watches ancestors as well, so missing/replaced directories recover.
pub fn watch_paths() -> Vec<PathBuf> {
    let mut paths = dist_roots();
    paths.push(PathBuf::from("/usr/share/onekvm/display/apps"));
    paths.push(crate::shared::extension_data_dir().join("apps"));
    if let Ok(cat) = CATALOG.lock() {
        paths.extend(cat.plugins.iter().filter_map(|app| app.bundle.clone()));
    }
    paths
}

/// Re-resolve titles after a language change. No directory scan.
pub fn rebuild_for_language() {
    let lang = crate::locale::read_language();
    if let Ok(mut cat) = CATALOG.lock() {
        for plugin in &mut cat.plugins {
            plugin.title = title_for(&plugin.titles, &plugin.id, &lang);
        }
        cat.json = encode(&cat.plugins, &lang);
    }
}

fn encode(plugins: &[AppPlugin], _lang: &str) -> String {
    let values: Vec<Value> = plugins
        .iter()
        .map(|plugin| {
            json!({
                "id": plugin.id,
                "title": plugin.title,
                "icon": plugin.icon,
                "slots": plugin.slots,
                "controls": plugin.controls,
                "order": plugin.order,
            })
        })
        .collect();
    serde_json::to_string(&values).unwrap_or_else(|_| "[]".into())
}

pub fn scan() -> Vec<AppPlugin> {
    let mut by_id: BTreeMap<String, AppPlugin> = BTreeMap::new();
    for root in dist_roots() {
        load_app_dirs(&root.join("apps"), &mut by_id);
    }
    load_dropins(Path::new("/usr/share/onekvm/display/apps"), &mut by_id);
    if let Ok(data) = std::env::var("ONEKVM_EXTENSION_DATA") {
        load_dropins(&PathBuf::from(data).join("apps"), &mut by_id);
    } else {
        load_dropins(
            Path::new("/data/onekvm/app-data/screen-display/apps"),
            &mut by_id,
        );
    }
    load_contributed_apps(&mut by_id);
    let mut plugins: Vec<AppPlugin> = by_id.into_values().collect();
    plugins.sort_by(|a, b| a.order.cmp(&b.order).then(a.id.cmp(&b.id)));
    plugins
}

static VALIDATION_ERRORS: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());

pub fn validation_errors() -> Value { serde_json::to_value(&*VALIDATION_ERRORS.lock().unwrap()).unwrap_or_default() }

fn load_contributed_apps(by_id: &mut BTreeMap<String, AppPlugin>) {
    let mut errors = BTreeMap::new();
    for (point, slot) in [("screen-display.app", "app"), ("screen-display.home", "home"), ("screen-display.widget", "widget")] {
      let entries = serde_json::from_str::<Vec<Value>>(&crate::contributions::list(point)).unwrap_or_default();
      for mut entry in entries {
        if slot == "widget" && entry.pointer("/data/bundle").is_none() { continue; }
        if slot != "app" && entry.pointer("/data/icon").is_none() { entry["data"]["icon"] = "settings.png".into(); }
        match contributed_app(&entry) {
            Ok(mut plugin) => {
                plugin.slots = vec![slot.into()];
                if by_id.contains_key(&plugin.id) { errors.insert(plugin.id.clone(), "screen contribution IDs must be unique across App, home and widget".into()); }
                else { by_id.insert(plugin.id.clone(), plugin); }
            }
            Err(error) => {
                let id = entry.get("id").and_then(Value::as_str).unwrap_or("unknown");
                log::warn!("screen App {id}: {error}");
                errors.insert(id.to_string(), error);
            }
        }
      }
    }
    *VALIDATION_ERRORS.lock().unwrap() = errors;
}

fn contributed_app(entry: &Value) -> Result<AppPlugin, String> {
    let id = entry.get("id").and_then(Value::as_str).ok_or("missing App id")?;
    if !valid_app_id(id) { return Err("invalid App id".into()); }
    let source = entry.get("source").and_then(Value::as_str).ok_or("missing contributor identity")?;
    if id.split_once('/').map(|(owner, _)| owner) != Some(source) { return Err("App owner does not match contributor".into()); }
    let data = entry.get("data").ok_or("missing App data")?;
    if data.get("runtime").and_then(Value::as_str).is_some_and(|runtime| runtime != "pocketjs-vue-vapor") { return Err("unsupported App runtime".into()); }
    if data.get("bridge_version").is_some_and(|version| !version.as_u64().is_some_and(|version| (1..=2).contains(&version))) { return Err("unsupported screen bridge version".into()); }
    if let Some(features) = data.get("required_features") {
        let features = features.as_array().ok_or("required_features must be an array")?;
        if features.iter().any(|feature| !matches!(feature.as_str(), Some("rpc" | "configure" | "icons" | "launcher-fonts" | "state-events" | "qr-code" | "screen-surfaces-v1"))) { return Err("unsupported App feature".into()); }
    }
    let root = entry.get("package_root").and_then(Value::as_str).ok_or("missing installed package root")?;
    let bundle = data.get("bundle").and_then(Value::as_str).ok_or("missing bundle directory")?;
    if !Path::new(root).is_absolute() || !safe_relative(bundle) { return Err("bundle must be relative to the installed package".into()); }
    let root = fs::canonicalize(root).map_err(|e| format!("package root: {e}"))?;
    let bundle_dir = fs::canonicalize(root.join(bundle)).map_err(|e| format!("App bundle: {e}"))?;
    if !bundle_dir.starts_with(&root) { return Err("bundle escapes installed package".into()); }
    if !bundle_ready(&bundle_dir) { return Err("bundle requires JS and PAK files".into()); }
    for name in ["main.vue-vapor.js", "main.vue-vapor.pak", "main.vue-vapor.jsc", "main.vue-vapor.jsc.abi", "main.vue-vapor.jsc.meta"] {
        let path = bundle_dir.join(name);
        if path.exists() && !fs::canonicalize(&path).is_ok_and(|path| path.starts_with(&bundle_dir)) { return Err(format!("{name} escapes App bundle")); }
    }
    if data.get("glyph").is_some() { return Err("glyph is not supported; provide an image icon".into()); }
    let mut plugin = from_value_for_id(data, id).ok_or("App requires an image icon")?;
    plugin.id = id.into();
    plugin.policy.owner = source.into();
    plugin.policy.manage_extensions = entry.get("permissions").and_then(Value::as_array).is_some_and(|permissions| permissions.iter().any(|permission| permission == "opkg-admin"));
    if let Some(path) = resolve_icon(&bundle_dir, &plugin.icon) {
        let mut digest = std::collections::hash_map::DefaultHasher::new();
        fs::read(&path).unwrap_or_default().hash(&mut digest);
        plugin.icon = format!("app-icon:{id}:{:x}", digest.finish());
        plugin.icon_asset = Some(path);
    } else if !matches!(plugin.icon.as_str(), "settings.png" | "stream.png" | "stick.png" | "power.png" | "hdmi.png") { return Err("App icon must be a packaged, valid ICO1 image or a shared launcher image".into()); }
    let mut digest = std::collections::hash_map::DefaultHasher::new();
    bundle_revision(&bundle_dir).hash(&mut digest); entry.to_string().hash(&mut digest);
    plugin.revision = digest.finish();
    plugin.bundle = Some(bundle_dir);
    Ok(plugin)
}

fn resolve_icon(bundle: &Path, name: &str) -> Option<PathBuf> {
    if !safe_relative(name) || !name.ends_with(".bin") { return None; }
    let path = fs::canonicalize(bundle.join(name)).ok()?;
    if !path.starts_with(bundle) || crate::chrome::LoadIcon::from_path(&path).is_none() { return None; }
    Some(path)
}

fn load_app_dirs(apps: &Path, by_id: &mut BTreeMap<String, AppPlugin>) {
    let Ok(entries) = fs::read_dir(apps) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if !bundle_ready(&dir) {
            continue;
        }
        let fallback_id = entry.file_name().to_string_lossy().into_owned();
        if let Some(plugin) = read_plugin(&dir.join("plugin.json"), &fallback_id)
            .or_else(|| read_pocket(&dir.join("pocket.json"), &fallback_id))
        {
            if valid_id(&plugin.id) {
                let mut plugin = plugin;
                plugin.revision = bundle_revision(&dir);
                if plugin.icon.ends_with(".bin") {
                    let Ok(bundle) = fs::canonicalize(&dir) else { continue; };
                    let Some(icon) = resolve_icon(&bundle, &plugin.icon) else { continue; };
                    let mut digest = std::collections::hash_map::DefaultHasher::new();
                    fs::read(&icon).ok().hash(&mut digest);
                    plugin.icon = format!("app-icon:{}:{:016x}", plugin.id, digest.finish());
                    plugin.icon_asset = Some(icon);
                    plugin.bundle = Some(bundle);
                }
                by_id.insert(plugin.id.clone(), plugin);
            }
        }
    }
}

fn load_dropins(dir: &Path, by_id: &mut BTreeMap<String, AppPlugin>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let fallback_id = path
            .file_stem()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let Some(plugin) = read_plugin(&path, &fallback_id) else {
            continue;
        };
        if !valid_id(&plugin.id) {
            continue;
        }
        let bundled = dist_roots()
            .into_iter()
            .any(|root| bundle_ready(&root.join("apps").join(&plugin.id)));
        if bundled {
            by_id.insert(plugin.id.clone(), plugin);
        }
    }
}

fn bundle_ready(dir: &Path) -> bool {
    dir.join("main.vue-vapor.js").is_file() && dir.join("main.vue-vapor.pak").is_file()
}

fn read_plugin(path: &Path, fallback_id: &str) -> Option<AppPlugin> {
    let value: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    from_value(&value, fallback_id)
}

fn read_pocket(path: &Path, fallback_id: &str) -> Option<AppPlugin> {
    let value: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let id = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .or_else(|| value.get("name").and_then(Value::as_str))
        .unwrap_or(id);
    let mut titles = BTreeMap::new();
    titles.insert("default".into(), title.to_string());
    Some(AppPlugin {
        id: id.to_string(),
        title: title.to_string(),
        titles,
        icon: format!("{id}.png"),
        slots: vec!["app".into()],
        controls: Vec::new(),
        order: 50,
        icon_asset: None,
        bundle: None,
        revision: 0,
        policy: crate::app_rpc::Policy::default(),
    })
}

fn from_value(value: &Value, fallback_id: &str) -> Option<AppPlugin> {
    from_value_for_id(value, fallback_id)
}

fn from_value_for_id(value: &Value, fallback_id: &str) -> Option<AppPlugin> {
    if value.get("glyph").is_some() { return None; }
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    if !valid_app_id(id) {
        return None;
    }
    let titles = collect_titles(value, id);
    let title = title_for(&titles, id, &crate::locale::read_language());
    let icon = value.get("icon").and_then(Value::as_str).filter(|icon| !icon.trim().is_empty())?.to_string();
    let slots = value
        .get("slots")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .filter(|items: &Vec<String>| !items.is_empty())
        .unwrap_or_else(|| vec!["app".into()]);
    let order = value.get("order").and_then(Value::as_i64).unwrap_or(50) as i32;
    let controls = value
        .get("controls")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|mode| matches!(*mode, "touch" | "rotary"))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Some(AppPlugin {
        id: id.to_string(),
        title,
        titles,
        icon,
        slots,
        controls,
        order,
        icon_asset: None,
        bundle: None,
        revision: 0,
        policy: crate::app_rpc::Policy {
            owner: id.split('/').next().unwrap_or_default().into(),
            manage_extensions: false,
            power_actions: false,
            service_actions: false,
            security_actions: false,
            media_actions: false,
            keyboard_actions: false,
            grants: value.pointer("/permissions/rpc").and_then(Value::as_array).cloned().unwrap_or_default(),
        },
    })
}

fn collect_titles(value: &Value, fallback: &str) -> BTreeMap<String, String> {
    let mut titles = BTreeMap::new();
    if let Some(title) = value.get("title").and_then(Value::as_str) {
        titles.insert("default".into(), title.to_string());
    }
    if let Some(i18n) = value.get("i18n").and_then(Value::as_object) {
        for (key, entry) in i18n {
            let title = entry
                .get("title")
                .and_then(Value::as_str)
                .or_else(|| entry.as_str());
            if let Some(title) = title {
                titles.insert(
                    key.replace('-', "_").to_ascii_lowercase(),
                    title.to_string(),
                );
            }
        }
    }
    if !titles.contains_key("default") {
        titles.insert("default".into(), fallback.to_string());
    }
    titles
}

fn title_for(titles: &BTreeMap<String, String>, fallback: &str, lang: &str) -> String {
    let key = if lang == "en" { "default" } else { lang };
    titles
        .get(key)
        .or_else(|| titles.get("default"))
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

fn valid_id(id: &str) -> bool { valid_id_part(id,31) }

fn valid_id_part(id: &str, max: usize) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some('a'..='z' | '0'..='9'))
        && id.len() <= max
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

fn valid_app_id(id: &str) -> bool {
    valid_id(id)
        || id
            .split_once('/')
            .is_some_and(|(source, local)| valid_id_part(source, 63) && valid_id_part(local, 63))
}

fn safe_relative(value: &str) -> bool {
    !value.is_empty()
        && !Path::new(value).is_absolute()
        && Path::new(value)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytecode_only_replacement_changes_bundle_revision() {
        let root = std::env::temp_dir().join(format!("screen-bytecode-revision-{}",std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("main.vue-vapor.js"),b"source").unwrap();
        fs::write(root.join("main.vue-vapor.pak"),b"resources").unwrap();
        fs::write(root.join("main.vue-vapor.jsc"),b"old").unwrap();
        let before = bundle_revision(&root);
        // Package updates replace files atomically.
        fs::write(root.join("main.vue-vapor.jsc.next"),b"new").unwrap();
        fs::rename(root.join("main.vue-vapor.jsc.next"),root.join("main.vue-vapor.jsc")).unwrap();
        assert_ne!(before,bundle_revision(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unsupported_bridge_and_runtime_have_actionable_registration_errors() {
        let entry = json!({"id":"example/main","source":"example","data":{"runtime":"unknown"}});
        assert!(contributed_app(&entry).unwrap_err().contains("runtime"));
        let entry = json!({"id":"example/main","source":"example","data":{"bridge_version":99}});
        assert!(contributed_app(&entry).unwrap_err().contains("bridge version"));
        assert!(contributed_app(&json!({"id":"other/main","source":"example","data":{}})).unwrap_err().contains("owner"));
    }

    #[test]
    fn bundle_icons_cannot_escape_or_load_malformed_data() {
        let dir = std::env::temp_dir().join(format!("screen-app-icon-{}",std::process::id()));
        fs::create_dir_all(dir.join("bundle")).unwrap();
        let bundle = fs::canonicalize(dir.join("bundle")).unwrap();
        let mut icon = b"ICO1\x01\x00\x01\x00".to_vec();
        icon.extend_from_slice(&[0x00,0xf8,0xff]);
        fs::write(bundle.join("icon.bin"),&icon).unwrap();
        assert_eq!(resolve_icon(&bundle,"icon.bin"),Some(bundle.join("icon.bin")));
        assert!(resolve_icon(&bundle,"../icon.bin").is_none());
        assert!(resolve_icon(&bundle,"/tmp/icon.bin").is_none());
        fs::write(dir.join("outside.bin"),&icon).unwrap();
        std::os::unix::fs::symlink(dir.join("outside.bin"),bundle.join("escape.bin")).unwrap();
        assert!(resolve_icon(&bundle,"escape.bin").is_none());
        fs::write(bundle.join("bad.bin"),b"not an icon").unwrap();
        assert!(resolve_icon(&bundle,"bad.bin").is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn contributed_apps_require_artwork_and_reject_letter_metadata() {
        let root = std::env::temp_dir().join(format!("screen-required-icon-{}", std::process::id()));
        let bundle = root.join("screen-app");
        fs::create_dir_all(&bundle).unwrap();
        fs::write(bundle.join("main.vue-vapor.js"), b"source").unwrap();
        fs::write(bundle.join("main.vue-vapor.pak"), b"resources").unwrap();
        let mut entry = json!({"id":"example/main", "source":"example", "package_root":root,
            "data":{"bundle":"screen-app", "icon":"icon.bin"}});
        assert!(contributed_app(&entry).unwrap_err().contains("icon"));
        fs::write(bundle.join("icon.bin"), b"ICO1\x01\x00\x01\x00\x00\xf8\xff").unwrap();
        let app = contributed_app(&entry).unwrap();
        assert!(app.icon.starts_with("app-icon:example/main:"));
        assert!(!encode(&[app], "en").contains("glyph"));
        entry["data"]["glyph"] = json!("E");
        assert!(contributed_app(&entry).unwrap_err().contains("glyph"));
        entry["data"].as_object_mut().unwrap().remove("glyph");
        entry["data"].as_object_mut().unwrap().remove("icon");
        assert!(contributed_app(&entry).unwrap_err().contains("icon"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn contributed_ids_are_namespaced_and_paths_stay_relative() {
        assert!(valid_app_id("wireguard/main"));
        assert!(valid_app_id("settings"));
        assert!(!valid_app_id("wireguard/../main"));
        assert!(safe_relative("screen-app"));
        assert!(!safe_relative("../screen-app"));
        assert!(!safe_relative("/tmp/screen-app"));
        assert!(!safe_relative("screen-app/../other"));
    }
}
