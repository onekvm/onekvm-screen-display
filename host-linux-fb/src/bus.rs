use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use zbus::blocking::{Connection, Proxy};
use zbus::interface;

use crate::shared::Shared;

pub const BUS_NAME: &str = "org.onekvm.ScreenDisplay";
pub const BUS_PATH: &str = "/org/onekvm/ScreenDisplay";

struct ScreenDisplay(Arc<Shared>);

#[interface(name = "org.onekvm.ScreenDisplay")]
impl ScreenDisplay {
    fn get(&self, key: &str) -> String {
        self.0.get_key(key)
    }

    fn set(&self, key: &str, value: &str) {
        self.0.set_key(key, value);
    }

    fn get_settings(&self) -> String {
        let (width, height) = (self.0.screen_w(), self.0.screen_h());
        serde_json::json!({
            "app_registration_errors": crate::apps::validation_errors(),
            "catalog_errors": crate::contributions::errors(),
            "app_icons_json": crate::apps::icons_json(),
            "app_errors": crate::apps::failures(),
            "bridge_version": 2,
            "brightness": self.0.brightness(),
            "rotate": self.0.logical_rotate(),
            "app_view": self.0.app_view(),
            "layout_json": self.0.layout_json(),
            "homes_json": if crate::mode::is_init() { "[]".into() } else { crate::apps::surfaces_json("home") },
            "default_settings_json": crate::default_layout::settings().to_string(),
            "background_image": self.0.background_image_json(),
            "media_assets": self.0.media_assets_json(),
            "apps_json": if crate::mode::is_init() {
                "[]".to_string()
            } else {
                crate::apps::apps_json()
            },
            "faces_json": if crate::mode::is_init() {
                "[]".to_string()
            } else {
                crate::contributions::list("screen-display.face")
            },
            "widgets_json": if crate::mode::is_init() {
                "[]".to_string()
            } else {
                crate::contributions::list("screen-display.widget")
            },
            "panel_json": serde_json::json!({
                "width": width, "height": height, "bpp": 16,
                "shape": if width == height { "round" } else { "rect" },
                "device": "/dev/fb0",
                "rotations": self.0.rotation_angles(),
            }).to_string(),
            "launcher_json": if crate::mode::is_init() {
                "{}".to_string()
            } else {
                crate::launcher::json()
            },
        })
        .to_string()
    }

    fn remote_frame(&self, payload: &str) -> zbus::fdo::Result<String> {
        let request: serde_json::Value = serde_json::from_str(payload)
            .map_err(|err| zbus::fdo::Error::InvalidArgs(err.to_string()))?;
        let mut response = self.0.remote.frame(request.get("sequence").and_then(|v| v.as_u64()).unwrap_or(0));
        response["controls"] = serde_json::from_str(&self.0.get_key("controls")).unwrap_or(serde_json::json!([]));
        response["blanked"] = serde_json::json!(self.0.is_blanked());
        self.0.wake.notify();
        Ok(response.to_string())
    }

    fn remote_input(&self, payload: &str) -> zbus::fdo::Result<String> {
        let request: serde_json::Value = serde_json::from_str(payload)
            .map_err(|err| zbus::fdo::Error::InvalidArgs(err.to_string()))?;
        match request.get("action").and_then(|v| v.as_str()).unwrap_or("") {
            "gesture" => self.0.remote.gesture(&request, self.0.screen_w(), self.0.screen_h())
                .map_err(zbus::fdo::Error::InvalidArgs)?,
            "rotate" => {
                let steps = request.get("steps").and_then(|v| v.as_i64())
                    .filter(|steps| (-12..=12).contains(steps)).ok_or_else(|| zbus::fdo::Error::InvalidArgs("invalid rotary step".into()))?;
                self.0.remote.queue_rotary(crate::remote::Rotary::Step(steps as i32))
                    .map_err(zbus::fdo::Error::LimitsExceeded)?;
            }
            "press" => self.0.remote.queue_rotary(crate::remote::Rotary::Press)
                .map_err(zbus::fdo::Error::LimitsExceeded)?,
            "hold" => self.0.remote.queue_rotary(crate::remote::Rotary::Hold)
                .map_err(zbus::fdo::Error::LimitsExceeded)?,
            _ => return Err(zbus::fdo::Error::InvalidArgs("unsupported screen input".into())),
        }
        self.0.note_input();
        Ok(serde_json::json!({"ok":true}).to_string())
    }

    fn refresh(&self) {
        self.0.request_catalog_refresh();
    }

    fn update_settings(&self, payload: &str) -> zbus::fdo::Result<()> {
        let value: serde_json::Value = serde_json::from_str(payload)
            .map_err(|err| zbus::fdo::Error::InvalidArgs(err.to_string()))?;
        if let Some(n) = value.get("brightness").and_then(|v| v.as_i64()) {
            self.0.set_brightness(n as i32);
        }
        if let Some(n) = value.get("rotate").and_then(|v| v.as_u64()) {
            if n > u64::from(u16::MAX) || !self.0.set_rotate(n as u16) {
                return Err(zbus::fdo::Error::InvalidArgs("unsupported screen rotation".into()));
            }
        }
        if let Some(background) = value.get("background_image") {
            let raw = background.as_str().ok_or_else(|| {
                zbus::fdo::Error::InvalidArgs("background_image must be a string".into())
            })?;
            self.0
                .set_background_image(raw)
                .map_err(zbus::fdo::Error::InvalidArgs)?;
        }
        if let Some(media) = value.get("media_assets") {
            let raw = media.as_str().ok_or_else(|| {
                zbus::fdo::Error::InvalidArgs("media_assets must be a string".into())
            })?;
            self.0
                .set_media_assets(raw)
                .map_err(zbus::fdo::Error::InvalidArgs)?;
        }
        if let Some(view) = value.get("app_view").and_then(|v| v.as_str()) {
            self.0.set_app_view(view);
        }
        if let Some(layout) = value.get("layout_json").and_then(|v| v.as_str()) {
            self.0.set_layout_json(layout);
        }
        Ok(())
    }
}

/// Leave init when auth is already stored, when that file is replaced, or
/// when core emits SetupFinished. None of these is a status poll.
pub fn watch_auth_configured(shared: Arc<Shared>) {
    std::thread::spawn(move || {
        if crate::setup::auth_configured_now() {
            log::info!("auth already configured; leaving init");
            shared.finish_setup();
            return;
        }
        if let Err(err) = watch_auth_config_file(&shared) {
            log::warn!("auth config watch: {err:#}");
        }
    });
}

fn watch_auth_config_file(shared: &Shared) -> Result<()> {
    let fd = unsafe { libc::inotify_init1(libc::IN_CLOEXEC) };
    if fd < 0 {
        anyhow::bail!("inotify_init1: {}", std::io::Error::last_os_error());
    }
    let dir = std::ffi::CString::new("/etc/onekvm").expect("path");
    let wd = unsafe {
        libc::inotify_add_watch(fd, dir.as_ptr(), libc::IN_MOVED_TO | libc::IN_CLOSE_WRITE)
    };
    if wd < 0 {
        unsafe { libc::close(fd) };
        anyhow::bail!("inotify_add_watch: {}", std::io::Error::last_os_error());
    }
    log::info!("watching /etc/onekvm/config.json for completed setup");
    let mut buf = vec![0u8; 4096];
    loop {
        if shared.setup_finished() {
            break;
        }
        let n = unsafe { libc::read(fd, buf.as_mut_ptr().cast(), buf.len()) };
        if n <= 0 {
            break;
        }
        if crate::setup::auth_configured_now() {
            log::info!("auth config saved; leaving init");
            shared.finish_setup();
            break;
        }
    }
    unsafe { libc::close(fd) };
    Ok(())
}

/// Subscribe before taking the initial snapshot. Only startup, owner changes
/// and configuration signals make method calls; getters use Shared's cache.
pub fn watch_core(shared: Arc<Shared>) {
    std::thread::spawn(move || loop {
        if let Err(err) = listen_core(&shared) {
            log::warn!("Core event connection lost: {err:#}; reconnecting");
        }
        shared.invalidate_system_state();
        // Transport failure backoff, never a periodic reconciliation timer.
        std::thread::sleep(Duration::from_secs(1));
    });
}

fn listen_core(shared: &Shared) -> Result<()> {
    let conn = zbus::blocking::connection::Builder::system()?
        .method_timeout(Duration::from_secs(10)).build()?;
    let mut messages = zbus::blocking::MessageIterator::from(&conn);
    let daemon = Proxy::new(&conn, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus")?;
    for rule in [
        "type='signal',sender='org.onekvm.Core1',interface='org.onekvm.Core1.Status',path='/org/onekvm/Core1/Status'",
        "type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.onekvm.Core1'",
        "type='signal',sender='org.freedesktop.systemd1',interface='org.freedesktop.DBus.Properties',path_namespace='/org/freedesktop/systemd1/unit'",
        "type='signal',sender='org.freedesktop.systemd1',interface='org.freedesktop.systemd1.Manager',member='UnitFilesChanged'",
    ] {
        daemon.call::<_, _, ()>("AddMatch", &(rule,))?;
    }
    let systemd = Proxy::new(&conn, "org.freedesktop.systemd1", "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager")?;
    let _ = systemd.call::<_, _, ()>("Subscribe", &());
    let status = Proxy::new(&conn, "org.onekvm.Core1", "/org/onekvm/Core1/Status", "org.onekvm.Core1.Status")?;
    let management = Proxy::new(&conn, "org.onekvm.Core1", "/org/onekvm/Core1/Management", "org.onekvm.Core1.Management")?;
    let mut owner: String = daemon.call("GetNameOwner", &("org.onekvm.Core1",)).unwrap_or_default();
    let mut state_position = None;
    let mut config_position = None;
    let mut resource_position = None;
    let snapshot = |state_position: &mut _, config_position: &mut _, resource_position: &mut _| {
        match status.call_method("GetState", &()) {
            Ok(reply) => {
                *state_position = Some(reply.recv_position());
                if let Ok(raw) = reply.body().deserialize::<String>() { shared.update_system_state(&raw); }
            }
            Err(err) => log::debug!("initial Core state: {err}"),
        }
        *resource_position = None;
        match status.call_method("GetResources", &()) {
            Ok(reply) => {
                *resource_position = Some(reply.recv_position());
                if let Ok(raw) = reply.body().deserialize::<String>() { shared.update_resources(&raw); }
            }
            // Older Core versions do not expose resource notifications.
            Err(err) => log::debug!("initial Core resources: {err}"),
        }
        match management.call_method("GetConfigValue", &("system.language",)) {
            Ok(reply) => {
                *config_position = Some(reply.recv_position());
                if let Ok(raw) = reply.body().deserialize::<String>() {
                    if crate::locale::accept_language(&raw) { shared.bump_catalog(); }
                }
            }
            Err(err) => log::warn!("Core language snapshot: {err}"),
        }
        shared.refresh_wifi_setup();
        shared.refresh_wifi_ap();
    };
    snapshot(&mut state_position, &mut config_position, &mut resource_position);
    shared.request_catalog_refresh();
    log::info!("subscribed to Core state/configuration and service events");
    for message in &mut messages {
        let message = message?;
        let header = message.header();
        let member = header.member().map(|s| s.as_str()).unwrap_or_default();
        let iface = header.interface().map(|s| s.as_str()).unwrap_or_default();
        if iface == "org.freedesktop.DBus" && member == "NameOwnerChanged" {
            let (name, _, next): (String, String, String) = message.body().deserialize()?;
            if name != "org.onekvm.Core1" { continue; }
            owner = next;
            shared.startup.invalidate();
            shared.wake.notify();
            crate::security::invalidate();
            shared.invalidate_system_state();
            shared.invalidate_app_state();
            crate::services::invalidate();
            if !owner.is_empty() { snapshot(&mut state_position, &mut config_position, &mut resource_position); }
            continue;
        }
        if iface == "org.freedesktop.DBus.Properties" {
            let path = header.path().map(|s| s.as_str()).unwrap_or_default();
            if let Ok((_, changed, invalidated)) = message.body().deserialize::<(String, std::collections::HashMap<String, zbus::zvariant::OwnedValue>, Vec<String>)>() {
                let lifecycle = ["ActiveState", "SubState"].iter()
                    .any(|key| changed.contains_key(*key) || invalidated.iter().any(|v| v == key));
                if lifecycle && (path.ends_with("/onekvm_2eservice") || path.ends_with("/onekvm_2dpersistence_2eservice")) {
                    shared.startup.invalidate();
                    shared.wake.notify();
                }
                if lifecycle && (path.contains("onekvm_2dextension") || path.contains("hostapd")) {
                    shared.request_catalog_refresh();
                    if path.contains("hostapd") { shared.refresh_wifi_ap(); }
                }
                let active = changed.get("ActiveState").and_then(|value| <&str>::try_from(value).ok());
                if crate::services::observe(path, active, invalidated.iter().any(|key| key == "ActiveState")) {
                    crate::services::invalidate();
                    shared.invalidate_app_state();
                }
            }
            continue;
        }
        if iface == "org.freedesktop.systemd1.Manager" && member == "UnitFilesChanged" {
            crate::services::invalidate();
            shared.invalidate_app_state();
            continue;
        }
        if iface != "org.onekvm.Core1.Status" || header.sender().map(|s| s.as_str()) != Some(owner.as_str()) { continue; }
        match member {
            "ResourcesChanged" if resource_position.is_none_or(|pos| message.recv_position() > pos) => {
                let raw: String = message.body().deserialize()?;
                shared.update_resources(&raw);
            }
            "StateChanged" if state_position.is_none_or(|pos| message.recv_position() > pos) => {
                let raw: String = message.body().deserialize()?;
                shared.update_system_state(&raw);
                shared.refresh_wifi_setup();
            }
            "FPSChanged" if state_position.is_none_or(|pos| message.recv_position() > pos) => {
                shared.update_fps(message.body().deserialize::<i32>()?);
            }
            "ConfigChanged" if config_position.is_none_or(|pos| message.recv_position() > pos) => {
                crate::security::invalidate();
                shared.invalidate_app_state();
                // Configuration values are intentionally absent from signals.
                if let Ok(reply) = management.call_method("GetConfigValue", &("system.language",)) {
                    config_position = Some(reply.recv_position());
                    if let Ok(raw) = reply.body().deserialize::<String>() {
                        if crate::locale::accept_language(&raw) { shared.bump_catalog(); }
                    }
                }
                crate::locale::sync_process_timezone();
                shared.refresh_wifi_setup();
                shared.refresh_wifi_ap();
            }
            "SetupFinished" => shared.finish_setup(),
            _ => {}
        }
    }
    anyhow::bail!("system bus closed")
}

pub fn serve(shared: Arc<Shared>) -> Result<()> {
    let conn = Connection::system().context("system bus")?;
    conn.object_server()
        .at(BUS_PATH, ScreenDisplay(shared))
        .context("export ScreenDisplay")?;
    conn.request_name(BUS_NAME)
        .context("own org.onekvm.ScreenDisplay")?;
    log::info!("dbus {BUS_NAME} on {BUS_PATH}");
    loop {
        std::thread::sleep(Duration::from_secs(3600));
    }
}

pub fn core_set_config_value(key: &str, value: &str) -> bool {
    match with_core(
        "org.onekvm.Core1.Management",
        "/org/onekvm/Core1/Management",
        |proxy| {
            proxy
                .call::<_, _, ()>("SetConfigValue", &(key, value))
                .map_err(Into::into)
        },
    ) {
        Ok(()) => true,
        Err(err) => {
            log::warn!("screen-display Core1 SetConfigValue({key}): {err:#}");
            false
        }
    }
}

pub fn core_power(action: &str) -> Result<(), String> {
    if !matches!(action, "on" | "off" | "reset") {
        return Err("invalid power action".into());
    }
    with_core(
        "org.onekvm.Core1.Management",
        "/org/onekvm/Core1/Management",
        |proxy| {
            proxy
                .call::<_, _, ()>("Power", &(action,))
                .map_err(Into::into)
        },
    )
    .map_err(|err| err.to_string())
}

pub(crate) fn with_core<T>(iface: &str, path: &str, f: impl FnOnce(&Proxy<'_>) -> Result<T>) -> Result<T> {
    let conn = Connection::system().context("system bus")?;
    let proxy = Proxy::new(&conn, "org.onekvm.Core1", path, iface)?;
    f(&proxy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::{AtomicUsize, Ordering}, Mutex};

    struct FakeStatus(Arc<AtomicUsize>, Arc<AtomicUsize>);
    #[interface(name = "org.onekvm.Core1.Status")]
    impl FakeStatus {
        fn get_state(&self) -> String {
            self.0.fetch_add(1, Ordering::SeqCst);
            r#"{"video":{"actual_fps":1},"atx":{"power":false},"system":{}}"#.into()
        }
        fn get_resources(&self) -> String {
            self.1.fetch_add(1, Ordering::SeqCst);
            r#"{"cpu_percent":12.5,"memory_total_bytes":100,"memory_used_bytes":25}"#.into()
        }
    }
    struct FakeConfig(Arc<AtomicUsize>, Arc<Mutex<String>>);
    #[interface(name = "org.onekvm.Core1.Management")]
    impl FakeConfig {
        fn get_config_value(&self, _key: &str) -> String {
            self.0.fetch_add(1, Ordering::SeqCst);
            self.1.lock().unwrap().clone()
        }
    }

    fn until(mut check: impl FnMut() -> bool) {
        let limit = std::time::Instant::now() + Duration::from_secs(3);
        while !check() {
            assert!(std::time::Instant::now() < limit, "event was not delivered");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    // Run on an isolated bus with DBUS_SYSTEM_BUS_ADDRESS set to its address.
    #[test]
    #[ignore = "requires a private dbus-daemon"]
    fn core_events_update_cached_getters_without_idle_requests_and_recover_owner() {
        let data = std::env::temp_dir().join(format!("screen-bus-test-{}", std::process::id()));
        std::env::set_var("ONEKVM_EXTENSION_DATA", &data);
        let states = Arc::new(AtomicUsize::new(0));
        let resources = Arc::new(AtomicUsize::new(0));
        let configs = Arc::new(AtomicUsize::new(0));
        let language = Arc::new(Mutex::new("en".to_string()));
        let fake = Connection::system().unwrap();
        fake.object_server().at("/org/onekvm/Core1/Status", FakeStatus(states.clone(), resources.clone())).unwrap();
        fake.object_server().at("/org/onekvm/Core1/Management", FakeConfig(configs.clone(), language.clone())).unwrap();
        fake.request_name("org.onekvm.Core1").unwrap();
        let shared = Arc::new(Shared::load_bare());
        watch_core(shared.clone());
        until(|| states.load(Ordering::SeqCst) == 1 && configs.load(Ordering::SeqCst) == 1);
        for _ in 0..20 { assert!(shared.get_key("system").contains("actual_fps")); }
        until(|| shared.get_key("system").contains("12.5"));
        fake.emit_signal(None::<&str>, "/org/onekvm/Core1/Status", "org.onekvm.Core1.Status", "ResourcesChanged", &(r#"{"cpu_percent":80.0,"memory_total_bytes":100,"memory_used_bytes":50}"#,)).unwrap();
        until(|| shared.get_key("system").contains("80.0"));
        fake.emit_signal(None::<&str>, "/org/onekvm/Core1/Status", "org.onekvm.Core1.Status", "StateChanged", &(r#"{"video":{"actual_fps":2},"atx":{"power":true},"system":{}}"#,)).unwrap();
        until(|| shared.get_key("system").contains("true"));
        assert!(shared.get_key("system").contains("80.0"));
        fake.emit_signal(None::<&str>, "/org/onekvm/Core1/Status", "org.onekvm.Core1.Status", "FPSChanged", &(42i32,)).unwrap();
        until(|| shared.get_key("system").contains("42"));
        *language.lock().unwrap() = "zh".into();
        fake.emit_signal(None::<&str>, "/org/onekvm/Core1/Status", "org.onekvm.Core1.Status", "ConfigChanged", &()).unwrap();
        until(|| shared.language() == "zh");
        assert_eq!(configs.load(Ordering::SeqCst), 2);
        std::thread::sleep(Duration::from_secs(6));
        assert_eq!(states.load(Ordering::SeqCst), 1);
        assert_eq!(resources.load(Ordering::SeqCst), 1);
        assert_eq!(configs.load(Ordering::SeqCst), 2);
        fake.release_name("org.onekvm.Core1").unwrap();
        until(|| shared.get_key("system").is_empty());
        fake.request_name("org.onekvm.Core1").unwrap();
        until(|| states.load(Ordering::SeqCst) == 2 && configs.load(Ordering::SeqCst) == 3);
        until(|| shared.get_key("system").contains("false"));
        until(|| shared.get_key("system").contains("12.5"));
        assert_eq!(resources.load(Ordering::SeqCst), 2);
        std::fs::remove_dir_all(data).unwrap();
    }
}
