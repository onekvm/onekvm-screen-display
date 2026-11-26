use qrcodegen::{QrCode, QrCodeEcc};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU16, AtomicU32, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::hid::Hub as Stick;
use crate::media::Hub as Video;

const HINT_MS: u64 = 2000;

enum SetupJob {
    WifiScan,
    WifiApRefresh,
    WifiApApply(String),
    WifiConnect {
        ssid: String,
        password: String,
    },
    NetApply(String),
    Auth {
        username: String,
        password: String,
        language: String,
        timezone: String,
    },
}

struct ExtensionRpc {
    next_id: u64,
    response: String,
    busy: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct AppScrollTransition {
    pub direction: i32,
    pub distance: usize,
    pub y: usize,
    pub height: usize,
    pub capture: Option<crate::scroll_layer::ScrollCapture>,
}

#[derive(Clone, Copy, Debug)]
pub struct AppDrawerTransition {
    pub opening: bool,
    pub y: usize,
}

pub struct Shared {
    pub wake: crate::wake::Wake,
    pub frame_timer: crate::frame_timer::FrameTimer,
    pub remote: crate::remote::Remote,
    pub devtools: Arc<crate::devtools::Hub>,
    pub system_actions: crate::system_actions::SystemActions,
    pub diagnostics: crate::diagnostics::Diagnostics,
    pub adb_debug: crate::adb_debug::AdbDebug,
    pub startup: crate::startup::Health,
    pub app_lock: crate::app_lock::AppLock,
    brightness: AtomicI32,
    rotate: AtomicU16,
    rotation_profile: crate::rotation::RotationProfile,
    app_view: Mutex<String>,
    layout_json: Mutex<String>,
    home_color: Mutex<(String, u16)>,
    background_image: Mutex<Option<Arc<crate::background::BackgroundImage>>>,
    media_assets: Mutex<Option<Arc<crate::widget_media::MediaLibrary>>>,
    hot: AtomicBool,
    launch: Mutex<String>,
    shell_page: AtomicU8,
    shell_capture_page: AtomicI32,
    pager: AtomicBool,
    app_page_transition: AtomicI32,
    app_scroll_transition: Mutex<Option<AppScrollTransition>>,
    app_scroll_position: Mutex<Option<(i32, usize)>>,
    app_drawer_transition: Mutex<Option<AppDrawerTransition>>,
    hint: Mutex<String>,
    hint_until: Mutex<Option<Instant>>,
    chrome_wake: AtomicU32,
    home_pill_until: Mutex<Option<Instant>>,
    back: AtomicBool,
    catalog_gen: AtomicU32,
    app_state_gen: AtomicU32,
    pages_stale: AtomicBool,
    pub catalog_event: crate::events::Notify,
    settings_page: Mutex<String>,
    system_json: Mutex<Arc<str>>,
    system_resources: Mutex<Option<serde_json::Value>>,
    wifi_setup_json: Mutex<String>,
    wifi_ap_json: Mutex<String>,
    knob_steps: AtomicI32,
    knob_clicks: AtomicU32,
    knob_holds: AtomicU32,
    knob_step: AtomicI32,
    knob_click: AtomicBool,
    knob_hold: AtomicBool,
    knob_hold_n: AtomicU32,
    knob_seq: AtomicU32,
    knob_on: AtomicBool,
    knob_wake: AtomicBool,
    screen_w: AtomicU16,
    screen_h: AtomicU16,
    touch_on: AtomicBool,
    setup_done: AtomicBool,
    last_input: Mutex<Instant>,
    blank_seconds: AtomicU32,
    blanked: AtomicBool,
    setup_error: Mutex<String>,
    extension_rpc: Mutex<ExtensionRpc>,
    extension_rpc_busy: AtomicBool,
    wifi_json: Mutex<String>,
    job: Mutex<Option<SetupJob>>,
    job_busy: AtomicBool,
    nfs: bool,
    pub video: Arc<Video>,
    pub carplay: Arc<crate::app_video::Plane>,
    pub stick: Arc<Stick>,
    pub data_dir: PathBuf,
}

pub fn extension_data_dir() -> PathBuf {
    PathBuf::from(
        std::env::var("ONEKVM_EXTENSION_DATA")
            .unwrap_or_else(|_| "/data/onekvm/app-data/screen-display".into()),
    )
}

pub fn setup_complete() -> bool {
    if std::env::var("ONEKVM_FORCE_INIT").ok().as_deref() == Some("1") {
        return false;
    }
    fs::read_to_string(extension_data_dir().join("setup-complete"))
        .map(|text| text.trim() == "ok")
        .unwrap_or(false)
}

pub fn write_setup_complete(dir: &Path) -> bool {
    let _ = fs::create_dir_all(dir);
    let tmp = dir.join(".setup-complete.tmp");
    let path = dir.join("setup-complete");
    let mut file = match File::create(&tmp) {
        Ok(file) => file,
        Err(err) => {
            log::error!("setup marker: {err}");
            return false;
        }
    };
    if file.write_all(b"ok\n").is_err() || file.sync_all().is_err() {
        return false;
    }
    if fs::rename(&tmp, &path).is_err() {
        return false;
    }
    if let Ok(dir_file) = File::open(dir) {
        let _ = dir_file.sync_all();
    }
    true
}

impl Shared {
    pub fn load() -> Self {
        Self::open(true)
    }

    /// Init process: persist brightness and language, do not scan apps.
    pub fn load_bare() -> Self {
        Self::open(false)
    }

    fn open(catalog: bool) -> Self {
        let data_dir = extension_data_dir();
        let _ = fs::create_dir_all(&data_dir);
        let brightness = fs::read_to_string(data_dir.join("brightness"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(100)
            .clamp(5, 100);
        let rotation_profile = crate::rotation::RotationProfile::load();
        let default_rotation = default_rotate();
        let rotate = fs::read_to_string(data_dir.join("rotate"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .filter(|n| matches!(n, 0 | 90 | 180 | 270))
            .unwrap_or(default_rotation);
        let rotate = rotation_profile.restore(rotate, default_rotation);
        let app_view = fs::read_to_string(data_dir.join("app_view"))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| s == "list" || s == "icons")
            .unwrap_or_else(|| "list".into());
        let defaults = crate::default_layout::settings();
        let layout_json = fs::read_to_string(data_dir.join("layout.json"))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| s.starts_with('{') && s.len() <= 16384)
            .unwrap_or_else(|| {
                if let Some(layout) = defaults["layout_json"].as_str() { return layout.to_string(); }
                format!("{{\"face\":\"screen-display/dashboard\",\"complications\":[],\"apps\":[],\"app_view\":\"{app_view}\"}}")
            });
        let background_image = fs::read_to_string(data_dir.join("background-image.json"))
            .or_else(|error| {
                if error.kind() == std::io::ErrorKind::NotFound && !data_dir.join("layout.json").exists() {
                    Ok(defaults["background_image"].as_str().unwrap_or(include_str!("../../src/shared/default-background.json")).to_string())
                } else { Err(error) }
            })
            .ok()
            .and_then(
                |raw| match crate::background::BackgroundImage::parse(&raw) {
                    Ok(image) => image.map(|mut image| {
                        image.map_metadata(&data_dir.join("background-image.json"));
                        Arc::new(image)
                    }),
                    Err(err) => {
                        log::warn!("ignored invalid background image: {err}");
                        None
                    }
                },
            );
        let media_assets = fs::read_to_string(data_dir.join("media-assets.json"))
            .or_else(|error| {
                if error.kind() == std::io::ErrorKind::NotFound && !data_dir.join("layout.json").exists() {
                    defaults["media_assets"].as_str().map(str::to_string).ok_or(error)
                } else { Err(error) }
            })
            .ok()
            .and_then(|raw| match crate::media_migration::load(&raw, &data_dir) {
                Ok(library) => library.map(Arc::new),
                Err(err) => {
                    log::warn!("ignored invalid widget media: {err}");
                    None
                }
            });
        let stick_speed = fs::read_to_string(data_dir.join("stick_speed"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(40)
            .clamp(10, 100);
        let blank_seconds = fs::read_to_string(data_dir.join("blank-seconds"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0u32);
        let this = Self {
            wake: crate::wake::Wake::default(),
            devtools: Arc::new(crate::devtools::Hub::default()),
            frame_timer: crate::frame_timer::FrameTimer::default(),
            system_actions: crate::system_actions::SystemActions::default(),
            diagnostics: crate::diagnostics::Diagnostics::default(),
            adb_debug: crate::adb_debug::AdbDebug::default(),
            startup: crate::startup::Health::default(),
            app_lock: crate::app_lock::AppLock::load(&data_dir),
            brightness: AtomicI32::new(brightness),
            rotate: AtomicU16::new(rotate),
            rotation_profile,
            app_view: Mutex::new(app_view),
            layout_json: Mutex::new(layout_json),
            home_color: Mutex::new((String::new(), 0)),
            background_image: Mutex::new(background_image),
            media_assets: Mutex::new(media_assets),
            hot: AtomicBool::new(false),
            launch: Mutex::new(String::new()),
            shell_page: AtomicU8::new(0),
            shell_capture_page: AtomicI32::new(-1),
            pager: AtomicBool::new(false),
            app_page_transition: AtomicI32::new(0),
            app_scroll_transition: Mutex::new(None),
            app_scroll_position: Mutex::new(None),
            app_drawer_transition: Mutex::new(None),
            hint: Mutex::new(String::new()),
            hint_until: Mutex::new(None),
            chrome_wake: AtomicU32::new(0),
            home_pill_until: Mutex::new(None),
            back: AtomicBool::new(false),
            catalog_gen: AtomicU32::new(1),
            app_state_gen: AtomicU32::new(1),
            pages_stale: AtomicBool::new(false),
            catalog_event: crate::events::Notify::default(),
            settings_page: Mutex::new(String::new()),
            system_json: Mutex::new(Arc::from("")),
            system_resources: Mutex::new(None),
            wifi_setup_json: Mutex::new(String::new()),
            wifi_ap_json: Mutex::new(String::new()),
            knob_steps: AtomicI32::new(0),
            knob_clicks: AtomicU32::new(0),
            knob_holds: AtomicU32::new(0),
            knob_step: AtomicI32::new(0),
            knob_click: AtomicBool::new(false),
            knob_hold: AtomicBool::new(false),
            knob_hold_n: AtomicU32::new(0),
            knob_seq: AtomicU32::new(0),
            knob_on: AtomicBool::new(false),
            knob_wake: AtomicBool::new(false),
            screen_w: AtomicU16::new(240),
            screen_h: AtomicU16::new(240),
            touch_on: AtomicBool::new(false),
            remote: crate::remote::Remote::default(),
            setup_done: AtomicBool::new(false),
            last_input: Mutex::new(Instant::now()),
            blank_seconds: AtomicU32::new(blank_seconds),
            blanked: AtomicBool::new(false),
            setup_error: Mutex::new(String::new()),
            extension_rpc: Mutex::new(ExtensionRpc {
                next_id: 0,
                response: r#"{"id":0,"busy":false,"ok":true,"response":null}"#.into(),
                busy: false,
            }),
            extension_rpc_busy: AtomicBool::new(false),
            wifi_json: Mutex::new("[]".into()),
            job: Mutex::new(None),
            job_busy: AtomicBool::new(false),
            nfs: crate::setup::nfs_root(),
            video: Arc::new(Video::new()),
            carplay: Arc::new(crate::app_video::Plane::new()),
            stick: Arc::new(Stick::new()),
            data_dir,
        };
        this.stick.set_speed(stick_speed);
        crate::locale::sync_process_timezone();
        crate::locale::accept_language(&fs::read_to_string(this.data_dir.join("language")).unwrap_or_default());
        if catalog {
            crate::launcher::reload();
            crate::contributions::refresh();
            crate::apps::refresh();
        }
        this
    }

    pub fn setup_finished(&self) -> bool {
        self.setup_done.load(Ordering::Relaxed)
    }

    /// Leave init after either the panel or another client finishes setup.
    /// The marker makes the next process start the shell instead of init.
    pub fn finish_setup(&self) {
        if self.setup_finished() {
            return;
        }
        if std::env::var("ONEKVM_FORCE_INIT").ok().as_deref() == Some("1") {
            log::info!("setup finished ignored while ONEKVM_FORCE_INIT=1");
            return;
        }
        if !write_setup_complete(&self.data_dir) {
            log::error!("setup finished but the marker was not written");
            return;
        }
        self.setup_done.store(true, Ordering::Relaxed);
        self.wake.notify();
        log::info!("setup finished");
    }

    pub fn catalog_gen(&self) -> u32 {
        self.catalog_gen.load(Ordering::Relaxed)
    }

    pub fn bump_catalog(&self) {
        self.catalog_gen.fetch_add(1, Ordering::Relaxed);
        self.pages_stale.store(true, Ordering::Relaxed);
        self.set_hot(true);
    }

    pub fn take_pages_stale(&self) -> bool {
        self.pages_stale.swap(false, Ordering::Relaxed)
    }

    pub fn request_catalog_refresh(&self) { self.catalog_event.notify(); }

    pub fn invalidate_app_state(&self) {
        self.app_state_gen.fetch_add(1, Ordering::Relaxed);
        self.set_hot(true);
    }

    pub fn refresh_catalog(&self) {
        self.invalidate_app_state();
        if crate::mode::is_init() { return; }
        let before = crate::apps::signature();
        let launcher = crate::launcher::json();
        crate::launcher::reload();
        let contributions_changed = crate::contributions::refresh();
        let widgets_changed = crate::contributions::refresh_widgets();
        crate::apps::refresh();
        if before != crate::apps::signature() { crate::services::invalidate(); }
        if contributions_changed || widgets_changed || before != crate::apps::signature() || launcher != crate::launcher::json() { self.bump_catalog(); }
    }

    pub fn stick_speed(&self) -> i32 {
        self.stick.speed()
    }

    pub fn set_stick_speed(&self, n: i32) {
        let n = n.clamp(10, 100);
        if self.stick.speed() != n {
            self.stick.set_speed(n);
            let _ = fs::write(self.data_dir.join("stick_speed"), format!("{n}\n"));
        }
    }

    pub fn brightness(&self) -> i32 {
        self.brightness.load(Ordering::Relaxed)
    }

    pub fn set_brightness(&self, n: i32) {
        let n = n.clamp(5, 100);
        if self.brightness.swap(n, Ordering::Relaxed) != n {
            let _ = fs::write(self.data_dir.join("brightness"), format!("{n}\n"));
            self.wake.notify();
        }
    }

    /// Physical framebuffer angle, also used to transform touch coordinates.
    pub fn rotate(&self) -> u16 {
        self.rotate.load(Ordering::Relaxed)
    }

    /// User-facing angle relative to the machine's upright panel position.
    pub fn logical_rotate(&self) -> u16 {
        self.rotation_profile.logical(self.rotate())
    }

    pub fn rotation_angles(&self) -> &[u16] {
        &self.rotation_profile.angles
    }

    pub fn set_rotate(&self, logical: u16) -> bool {
        let Some(deg) = self.rotation_profile.physical(logical) else {
            return false;
        };
        if self.rotate.swap(deg, Ordering::Relaxed) != deg {
            let _ = fs::write(self.data_dir.join("rotate"), format!("{deg}\n"));
            self.wake.notify();
        }
        true
    }

    pub fn app_view(&self) -> String {
        self.app_view.lock().unwrap().clone()
    }

    pub fn language(&self) -> String {
        crate::locale::read_language()
    }

    pub fn set_app_view(&self, value: &str) {
        let next = if value == "list" { "list" } else { "icons" };
        *self.app_view.lock().unwrap() = next.to_string();
        let _ = fs::write(self.data_dir.join("app_view"), format!("{next}\n"));
        let mut layout = self.layout_json.lock().unwrap();
        if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&layout) {
            if let Some(obj) = value.as_object_mut() {
                obj.insert(
                    "app_view".into(),
                    serde_json::Value::String(next.to_string()),
                );
                if let Ok(encoded) = serde_json::to_string(&value) {
                    *layout = encoded.clone();
                    drop(layout);
                    let _ = fs::write(self.data_dir.join("layout.json"), encoded);
                }
            }
        }
        self.bump_catalog();
    }

    pub fn layout_json(&self) -> String {
        self.layout_json.lock().unwrap().clone()
    }

    pub fn set_layout_json(&self, raw: &str) {
        let trimmed = raw.trim();
        if trimmed.len() > 16384 || !trimmed.starts_with('{') {
            return;
        }
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            return;
        };
        let encoded = serde_json::to_string(&parsed).unwrap_or_else(|_| trimmed.to_string());
        if let Some(view) = parsed.get("app_view").and_then(|v| v.as_str()) {
            let next = if view == "list" { "list" } else { "icons" };
            *self.app_view.lock().unwrap() = next.to_string();
            let _ = fs::write(self.data_dir.join("app_view"), format!("{next}\n"));
        }
        *self.layout_json.lock().unwrap() = encoded.clone();
        let _ = fs::write(self.data_dir.join("layout.json"), encoded);
        self.bump_catalog();
    }

    pub fn background_image_json(&self) -> String {
        self.background_image
            .lock()
            .unwrap()
            .as_ref()
            .map(|image| image.encoded_owned())
            .unwrap_or_default()
    }

    pub fn has_background_image(&self) -> bool {
        self.background_image.lock().unwrap().is_some()
    }

    pub fn paint_background(&self, pixels: &mut [u16], width: usize, height: usize) -> bool {
        let image = self.background_image.lock().unwrap().clone();
        image
            .as_ref()
            .map(|image| image.render_cover(pixels, width, height))
            .unwrap_or(false)
    }

    pub fn set_background_image(&self, raw: &str) -> Result<(), String> {
        let mut image = crate::background::BackgroundImage::parse(raw)?;
        let path = self.data_dir.join("background-image.json");
        let temporary = self.data_dir.join(".background-image.json.tmp");
        let mut file = File::create(&temporary)
            .map_err(|err| format!("create background image: {err}"))?;
        file.write_all(image.as_ref().map(|image| image.encoded()).unwrap_or("").as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|err| format!("write background image: {err}"))?;
        fs::rename(&temporary, &path)
            .map_err(|err| format!("install background image: {err}"))?;
        if let Some(image) = image.as_mut() { image.map_metadata(&path); }
        *self.background_image.lock().unwrap() = image.map(Arc::new);
        self.bump_catalog();
        Ok(())
    }

    pub fn media_assets_json(&self) -> String {
        self.media_assets
            .lock()
            .unwrap()
            .as_ref()
            .map(|library| library.encoded_owned())
            .unwrap_or_default()
    }

    pub fn media_directory(&self) -> PathBuf {
        self.data_dir.join("media")
    }

    pub fn set_media_assets(&self, raw: &str) -> Result<(), String> {
        let migrated = crate::media_migration::prepare(raw, &self.media_directory())
            .map_err(|err| format!("migrate media assets: {err:#}"))?;
        let raw = migrated.as_deref().unwrap_or(raw);
        let mut library = crate::widget_media::MediaLibrary::parse(raw)?;
        let path = self.data_dir.join("media-assets.json");
        if let Some(library) = library.as_ref() {
            let temporary = self.data_dir.join(".media-assets.json.tmp");
            let mut file =
                File::create(&temporary).map_err(|err| format!("create media assets: {err}"))?;
            file.write_all(library.encoded().as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|err| format!("write media assets: {err}"))?;
            fs::rename(&temporary, &path).map_err(|err| format!("install media assets: {err}"))?;
            File::open(&self.data_dir).and_then(|file| file.sync_all())
                .map_err(|err| format!("sync media assets: {err}"))?;
        } else if let Err(err) = fs::remove_file(&path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("clear media assets: {err}"));
            }
        }
        if let Some(library) = library.as_mut() { library.map_metadata(&path); }
        let library = library.map(Arc::new);
        let mut current = self.media_assets.lock().unwrap();
        let old_files = current.as_ref().map(|media| media.files().clone()).unwrap_or_default();
        let new_files = library.as_ref().map(|media| media.files().clone()).unwrap_or_default();
        *current = library;
        drop(current);
        crate::media_store::prune(&self.media_directory(), &new_files, &old_files);
        self.bump_catalog();
        Ok(())
    }

    pub fn media_frame_delay_ms(&self) -> Option<u64> {
        // Core state is a D-Bus round trip: never wait for it while holding
        // settings locks needed by concurrent extension requests.
        let status = self.cached_system_state();
        let layout = self.layout_json.lock().unwrap();
        self.media_assets
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|library| library.animation_delay_ms(&layout, &status))
    }

    pub fn has_media_widgets(&self) -> bool {
        let layout = self.layout_json.lock().unwrap();
        self.media_assets
            .lock()
            .unwrap()
            .as_ref()
            .map(|library| library.has_visible(&layout))
            .unwrap_or(false)
    }

    pub fn home_background_rgb565(&self) -> u16 {
        let raw = self.layout_json.lock().unwrap();
        let mut cache = self.home_color.lock().unwrap();
        if cache.0 == *raw { return cache.1; }
        let color = serde_json::from_str::<serde_json::Value>(&raw)
            .ok()
            .and_then(|value| {
                value
                    .get("background")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "#000000".into());
        if color.len() != 7 || !color.starts_with('#') {
            return 0;
        }
        let Ok(rgb) = u32::from_str_radix(&color[1..], 16) else {
            return 0;
        };
        let red = (rgb >> 16) as u16;
        let green = (rgb >> 8) as u16;
        let blue = rgb as u16;
        let rgb565 = ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);
        cache.0.clear();
        cache.0.push_str(&raw);
        cache.1 = rgb565;
        rgb565
    }

    pub fn paint_home_scene(&self, ui: &impl pocketjs_core::resources::RenderResources, words: &[u32], pixels: &mut [u16], mut paint_surface: impl FnMut(crate::home_compositor::Surface, &mut [u16]) -> bool) {
        let status = self.cached_system_state();
        let layout = self.layout_json.lock().unwrap();
        let library = self.media_assets.lock().unwrap().clone();
        if let Some(library) = library {
            library.paint_scene_with_surfaces(&layout, &status, ui, words, pixels, paint_surface);
        } else {
            crate::home_compositor::render(ui, words, pixels, &mut Default::default(), |surface, pixels| { paint_surface(surface, pixels); });
        }
    }

    pub fn hot(&self) -> bool {
        self.hot.load(Ordering::Relaxed)
    }

    pub fn set_hot(&self, on: bool) {
        let old = self.hot.swap(on, Ordering::Relaxed);
        if old != on && on {
            self.wake.notify();
        }
    }

    pub fn pager(&self) -> bool {
        self.pager.load(Ordering::Relaxed)
    }

    pub fn set_pager(&self, on: bool) {
        self.pager.store(on, Ordering::Relaxed);
    }

    pub fn shell_page(&self) -> u8 {
        self.shell_page.load(Ordering::Relaxed)
    }

    pub fn set_shell_page(&self, page: u8) {
        self.shell_page
            .store(if page == 0 { 0 } else { 1 }, Ordering::Relaxed);
    }

    pub fn set_shell_capture_page(&self, page: Option<u8>) {
        self.shell_capture_page.store(page.map_or(-1, |page| i32::from(page.min(1))), Ordering::Relaxed);
    }

    pub fn shell_render_page(&self) -> u8 {
        match self.shell_capture_page.load(Ordering::Relaxed) {
            0 => 0,
            1 => 1,
            _ => self.shell_page(),
        }
    }

    /// User navigation, with the launcher entrance authorization check.
    pub fn request_shell_page(&self, page: u8) -> bool {
        if page > 0 && !self.app_lock.authorized() {
            self.app_lock.route("launcher");
            self.set_launch("settings");
            return false;
        }
        if page == 0 {
            self.app_lock.route("shell");
        }
        self.set_shell_page(page);
        true
    }

    pub fn request_app_page_transition(&self, direction: i32) {
        self.app_page_transition
            .store(if direction < 0 { -1 } else { 1 }, Ordering::Relaxed);
        self.wake.notify();
    }

    pub fn take_app_page_transition(&self) -> Option<i32> {
        match self.app_page_transition.swap(0, Ordering::Relaxed) {
            0 => None,
            direction => Some(direction),
        }
    }

    pub fn request_app_scroll_transition(
        &self,
        direction: i32,
        distance: usize,
        y: usize,
        height: usize,
        capture: Option<crate::scroll_layer::ScrollCapture>,
    ) {
        if height == 0 {
            return;
        }
        *self.app_scroll_transition.lock().unwrap() = Some(AppScrollTransition {
            direction: if direction < 0 { -1 } else { 1 },
            distance,
            y,
            height,
            capture,
        });
        self.set_hot(true);
        self.wake.notify();
    }

    pub fn take_app_scroll_transition(&self) -> Option<AppScrollTransition> {
        self.app_scroll_transition.lock().unwrap().take()
    }

    pub fn pending_scroll_capture(
        &self,
    ) -> Option<(crate::scroll_layer::ScrollCapture, (usize, usize))> {
        self.app_scroll_transition
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|request| {
                request
                    .capture
                    .map(|capture| (capture, (request.y, request.height)))
            })
    }

    pub fn request_app_drawer_transition(&self, opening: bool, y: usize) {
        *self.app_drawer_transition.lock().unwrap() = Some(AppDrawerTransition { opening, y });
        self.set_hot(true);
        self.wake.notify();
    }

    pub fn take_app_drawer_transition(&self) -> Option<AppDrawerTransition> {
        self.app_drawer_transition.lock().unwrap().take()
    }

    pub fn set_launch(&self, value: &str) {
        if value == "launcher" || crate::apps::can_launch(value) {
            self.system_actions.prepare("");
            *self.launch.lock().unwrap() = value.to_string();
            self.wake.notify();
        }
    }

    pub fn has_launch(&self) -> bool {
        !self.launch.lock().unwrap().is_empty()
    }

    pub fn take_launch(&self) -> Option<String> {
        let mut launch = self.launch.lock().unwrap();
        if launch.is_empty() {
            return None;
        }
        Some(std::mem::take(&mut *launch))
    }

    pub fn hint_text(&self) -> String {
        let until = *self.hint_until.lock().unwrap();
        if let Some(until) = until {
            if Instant::now() >= until {
                self.hint.lock().unwrap().clear();
                *self.hint_until.lock().unwrap() = None;
                return String::new();
            }
        }
        self.hint.lock().unwrap().clone()
    }

    pub fn set_touch(&self, on: bool) {
        self.touch_on.store(on, Ordering::Relaxed);
    }

    pub fn touch_on(&self) -> bool {
        self.touch_on.load(Ordering::Relaxed)
    }

    pub fn set_screen(&self, w: u16, h: u16) {
        self.screen_w.store(w.max(1), Ordering::Relaxed);
        self.screen_h.store(h.max(1), Ordering::Relaxed);
    }

    pub fn screen_w(&self) -> u16 {
        self.screen_w.load(Ordering::Relaxed).max(1)
    }

    pub fn screen_h(&self) -> u16 {
        self.screen_h.load(Ordering::Relaxed).max(1)
    }

    pub fn mark_knob_present(&self) {
        if !self.knob_on.swap(true, Ordering::Relaxed) {
            self.knob_wake.store(true, Ordering::Relaxed);
            self.wake.notify();
        }
    }

    pub fn take_knob_wake(&self) -> bool {
        self.knob_wake.swap(false, Ordering::Relaxed)
    }

    pub fn note_input(&self) {
        // Check the old idle interval before a wake event resets it. Knob and
        // remote input can arrive between the main loop's maintenance ticks.
        self.expire_app_lock();
        *self.last_input.lock().unwrap() = Instant::now();
        let mut blanked = self.blanked.load(Ordering::Relaxed);
        crate::blank::apply_input(
            &crate::blank::PanelNodes::live(),
            &mut blanked,
            self.brightness(),
        );
        self.blanked.store(blanked, Ordering::Relaxed);
        self.wake.notify();
    }

    pub fn is_blanked(&self) -> bool { self.blanked.load(Ordering::Relaxed) }

    pub fn input_idle(&self) -> Duration { self.last_input.lock().unwrap().elapsed() }

    pub fn expire_app_lock(&self) {
        if self.app_lock.expire(self.input_idle()) {
            self.set_launch("shell");
        }
    }

    pub fn tick_blank(&self) {
        let last = *self.last_input.lock().unwrap();
        let mut blanked = self.blanked.load(Ordering::Relaxed);
        let previous = blanked;
        crate::blank::apply_idle(
            &crate::blank::PanelNodes::live(),
            self.blank_seconds.load(Ordering::Relaxed),
            last.elapsed(),
            &mut blanked,
            self.brightness(),
        );
        self.blanked.store(blanked, Ordering::Relaxed);
        if blanked != previous { self.wake.notify(); }
    }

    pub fn blank_delay(&self) -> Option<Duration> {
        let seconds = self.blank_seconds.load(Ordering::Relaxed);
        if seconds == 0 || self.blanked.load(Ordering::Relaxed) {
            return None;
        }
        Some(
            Duration::from_secs(u64::from(seconds))
                .saturating_sub(self.last_input.lock().unwrap().elapsed()),
        )
    }

    pub fn check_startup(self: &Arc<Self>) {
        if self.setup_busy() || !self.startup.begin() { return; }
        let this = self.clone();
        std::thread::spawn(move || {
            this.startup.finish(crate::startup::inspect());
            this.wake.notify();
        });
    }

    pub fn setup_busy(&self) -> bool {
        self.job_busy.load(Ordering::Acquire) || self.job.lock().unwrap().is_some()
    }

    pub fn drive_jobs(self: &Arc<Self>) {
        if self.job_busy.swap(true, Ordering::AcqRel) {
            return;
        }
        let job = self.job.lock().unwrap().take();
        let Some(job) = job else {
            self.job_busy.store(false, Ordering::Release);
            return;
        };
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            this.run_job(job);
            this.refresh_wifi_setup();
            this.set_hot(true);
            this.job_busy.store(false, Ordering::Release);
            this.wake.notify();
        });
    }

    fn enqueue(&self, job: SetupJob) {
        *self.job.lock().unwrap() = Some(job);
        self.wake.notify();
    }

    fn set_setup_error(&self, text: &str) {
        log::warn!("screen setup: {text}");
        *self.setup_error.lock().unwrap() = text.to_string();
    }

    fn clear_setup_error(&self) {
        self.setup_error.lock().unwrap().clear();
    }

    fn run_job(&self, job: SetupJob) {
        match job {
            SetupJob::WifiApRefresh => self.refresh_wifi_ap(),
            SetupJob::WifiApApply(raw) => {
                let result: Result<(), String> = (|| {
                    let spec: serde_json::Value = serde_json::from_str(&raw)
                        .map_err(|_| "invalid hotspot request".to_string())?;
                    let action = spec["action"].as_str().unwrap_or("");
                    if !matches!(action, "ap" | "ap-config") {
                        return Err("invalid hotspot action".into());
                    }
                    let status = crate::setup::hotspot_command(action, &spec["request"].to_string())?;
                    self.update_wifi_ap(status);
                    Ok(())
                })();
                match result {
                    Ok(()) => self.clear_setup_error(),
                    Err(error) => self.set_setup_error(&error),
                }
            }
            SetupJob::WifiScan => {
                let body = crate::setup::wifi_scan();
                if let Some(err) = crate::setup::scan_failure(&body) {
                    self.set_setup_error(&err);
                    *self.wifi_json.lock().unwrap() = "[]".into();
                } else {
                    self.clear_setup_error();
                    *self.wifi_json.lock().unwrap() = body;
                }
            }
            SetupJob::WifiConnect { ssid, password } => {
                match crate::setup::wifi_connect(&ssid, &password) {
                    Ok(()) => self.clear_setup_error(),
                    Err(err) => self.set_setup_error(&err),
                }
            }
            SetupJob::NetApply(raw) => {
                let spec = match serde_json::from_str(&raw) {
                    Ok(spec) => spec,
                    Err(err) => {
                        self.set_setup_error(&err.to_string());
                        return;
                    }
                };
                match crate::setup::apply_network(&spec) {
                    Ok(()) => self.clear_setup_error(),
                    Err(err) => self.set_setup_error(&err),
                }
            }
            SetupJob::Auth {
                username,
                password,
                language,
                timezone,
            } => {
                let health = crate::startup::inspect();
                if !health.code.is_empty() {
                    self.set_setup_error(&format!("startup:{}", health.code));
                    self.startup.invalidate();
                    return;
                }
                let http = if (8..=128).contains(&password.chars().count()) {
                    crate::setup::auth_setup(&username, &password, &language, &timezone)
                } else {
                    Err("short".into())
                };
                match crate::setup::commit_auth(&self.data_dir, &password, http) {
                    Ok(()) => {
                        self.finish_setup();
                        self.clear_setup_error();
                    }
                    Err(err) => self.set_setup_error(&err),
                }
            }
        }
    }

    fn queue_step(&self, delta: i32) {
        if delta == 0 {
            return;
        }
        let _ = self
            .knob_steps
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |cur| {
                Some(cur.saturating_add(delta).clamp(-24, 24))
            });
    }

    pub fn push_knob(&self, delta: i32) {
        if delta == 0 {
            return;
        }
        self.note_input();
        self.queue_step(delta);
        self.wake.notify();
    }

    pub fn push_knob_click(&self) {
        self.note_input();
        self.knob_clicks.fetch_add(1, Ordering::Relaxed);
        self.wake.notify();
    }

    pub fn push_knob_hold(&self) {
        self.note_input();
        self.knob_holds.fetch_add(1, Ordering::Relaxed);
        self.wake.notify();
    }

    pub fn knob_queued(&self) -> bool {
        self.knob_steps.load(Ordering::Relaxed) != 0
            || self.knob_clicks.load(Ordering::Relaxed) != 0
            || self.knob_holds.load(Ordering::Relaxed) != 0
            || self.remote.rotary_queued()
    }

    pub fn latched_hold(&self) -> bool {
        self.knob_hold.load(Ordering::Relaxed)
    }

    /// Deliver all pending detents together so a slow display frame cannot
    /// leave a long queue of stale navigation events.
    pub fn latch_knob(&self) {
        let mut step = self.knob_steps.swap(0, Ordering::Relaxed);
        let mut click = self.knob_clicks.swap(0, Ordering::Relaxed) > 0;
        let mut holds = self.knob_holds.swap(0, Ordering::Relaxed);
        // Physical detents may coalesce, but separate remote button actions
        // must reach separate guest frames: Hold + Step in one latch loses
        // the Step in the shell and Apps. Prioritize pending physical input.
        if step == 0 && !click && holds == 0 {
            match self.remote.take_rotary() {
                Some(crate::remote::Rotary::Step(delta)) => step = delta,
                Some(crate::remote::Rotary::Press) => click = true,
                Some(crate::remote::Rotary::Hold) => holds = 1,
                None => {}
            }
        }
        self.knob_step.store(step, Ordering::Relaxed);
        self.knob_click.store(click, Ordering::Relaxed);
        self.knob_hold.store(holds > 0, Ordering::Relaxed);
        self.knob_hold_n.store(holds, Ordering::Relaxed);
        if step != 0 || click || holds > 0 {
            self.knob_seq.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Guest did not run. Put the latch back so the next tick can show it.
    pub fn unlatch_knob(&self) {
        let step = self.knob_step.swap(0, Ordering::Relaxed);
        let click = self.knob_click.swap(false, Ordering::Relaxed);
        let holds = self.knob_hold_n.swap(0, Ordering::Relaxed);
        self.knob_hold.store(false, Ordering::Relaxed);
        if step == 0 && !click && holds == 0 {
            return;
        }
        if step != 0 {
            self.queue_step(step);
        }
        if click {
            self.knob_clicks.fetch_add(1, Ordering::Relaxed);
        }
        if holds > 0 {
            self.knob_holds.fetch_add(holds, Ordering::Relaxed);
        }
        self.knob_seq.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn clear_knob(&self) {
        self.knob_steps.store(0, Ordering::Relaxed);
        self.knob_clicks.store(0, Ordering::Relaxed);
        self.knob_holds.store(0, Ordering::Relaxed);
        self.knob_step.store(0, Ordering::Relaxed);
        self.knob_click.store(false, Ordering::Relaxed);
        self.knob_hold.store(false, Ordering::Relaxed);
        self.knob_hold_n.store(0, Ordering::Relaxed);
    }

    pub fn request_back(&self) {
        self.back.store(true, Ordering::Relaxed);
        self.wake.notify();
    }

    pub fn take_back(&self) -> bool {
        self.back.swap(false, Ordering::Relaxed)
    }

    pub fn back_pending(&self) -> bool {
        self.back.load(Ordering::Relaxed)
    }

    pub fn bump_chrome_wake(&self) {
        self.show_home_pill_for(Duration::from_millis(1500));
        self.chrome_wake.fetch_add(1, Ordering::Relaxed);
        self.wake.notify();
    }

    pub fn show_home_pill_for(&self, duration: Duration) {
        *self.home_pill_until.lock().unwrap() = Some(Instant::now() + duration);
        self.wake.notify();
    }

    pub fn home_pill_visible(&self) -> bool {
        self.home_pill_until.lock().unwrap().is_some_and(|until| Instant::now() < until)
    }

    pub fn chrome_wake(&self) -> u32 {
        self.chrome_wake.load(Ordering::Relaxed)
    }

    pub fn set_hint(&self, text: &str) {
        self.set_hint_for(text, Duration::from_millis(HINT_MS));
    }

    pub fn set_hint_for(&self, text: &str, duration: Duration) {
        if text.is_empty() {
            self.hint.lock().unwrap().clear();
            *self.hint_until.lock().unwrap() = None;
            self.wake.notify();
            return;
        }
        *self.hint.lock().unwrap() = text.to_string();
        *self.hint_until.lock().unwrap() = Some(Instant::now() + duration);
        self.wake.notify();
    }

    pub fn start_diagnostics(self: &Arc<Self>) {
        if !self.diagnostics.begin() { return; }
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            this.diagnostics.start_boot_export();
            this.wake.notify();
        });
    }

    pub fn adb_debug_action(self: &Arc<Self>, enabled: Option<bool>) {
        // The in-process bridge checks the trusted guest before dispatching.
        if !self.adb_debug.begin() { return; }
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            this.adb_debug.run(enabled);
            this.wake.notify();
        });
    }

    fn start_extension_rpc(self: &Arc<Self>, value: &str) {
        if value.len() > 8192 || self.extension_rpc_busy.swap(true, Ordering::AcqRel) {
            return;
        }
        let Ok(request) = crate::app_rpc::Request::parse(value) else {
            self.extension_rpc_busy.store(false, Ordering::Release);
            return;
        };
        let id = {
            let mut rpc = self.extension_rpc.lock().unwrap();
            rpc.next_id = rpc.next_id.wrapping_add(1).max(1);
            rpc.busy = true;
            rpc.response = serde_json::json!({"id": rpc.next_id, "busy": true}).to_string();
            rpc.next_id
        };
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            let result = request.run();
            let response = match result {
                Ok(value) => serde_json::json!({"id": id, "busy": false, "ok": true, "response": value}),
                Err(error) => serde_json::json!({"id": id, "busy": false, "ok": false, "error": error}),
            };
            if let Ok(mut rpc) = this.extension_rpc.lock() {
                rpc.busy = false;
                rpc.response = response.to_string();
            }
            this.extension_rpc_busy.store(false, Ordering::Release);
            this.set_hot(true);
            this.wake.notify();
        });
    }

    pub fn extension_rpc_response(&self) -> String {
        self.extension_rpc.lock().unwrap().response.clone()
    }

    pub fn launch_id(&self) -> String {
        self.launch.lock().unwrap().clone()
    }

    /// Transient last-presented position supplied while touch takes over a
    /// cached list. It is not a saved setting or a guest-writable request.
    pub fn set_app_scroll_position(&self, position: Option<(i32, usize)>) {
        *self.app_scroll_position.lock().unwrap() = position;
    }

    pub fn get_key(&self, key: &str) -> String {
        match key {
            "appListAuthorized" => return if self.app_lock.authorized() { "1" } else { "0" }.into(),
            "appLockState" => return self.app_lock.json(),
            "systemCapabilities" => return self.system_actions.capabilities(),
            "systemStatus" => return self.system_actions.status(),
            "diagnosticsStatus" => return self.diagnostics.snapshot(),
            "adbDebugStatus" => return self.adb_debug.snapshot(),
            "systemReady" => return if self.system_actions.ready() { "1" } else { "0" }.into(),
            "systemHoldReady" => return if self.system_actions.hold_ready() { "1" } else { "0" }.into(),
            "knobPressed" => return if self.system_actions.pressed() { "1" } else { "0" }.into(),
            _ => {}
        }
        if crate::mode::is_init() {
            match key {
                "apps" | "faces" | "widgets" => return "[]".into(),
                "launcher" => return "{}".into(),
                "launch" => return String::new(),
                "setupDone" => {
                    return if self.setup_finished() {
                        "1".into()
                    } else {
                        "0".into()
                    };
                }
                "ip" => return crate::primary_ipv4(),
                "iface" => return crate::default_iface(),
                _ => {}
            }
        }
        match key {
            "appScrollPosition" => self
                .app_scroll_position
                .lock()
                .unwrap()
                .map(|(node, offset)| format!("{node}:{offset}"))
                .unwrap_or_default(),
            "brightness" => self.brightness().to_string(),
            "rotate" => self.logical_rotate().to_string(),
            "rotations" => serde_json::to_string(self.rotation_angles()).unwrap_or_default(),
            "appView" => self.app_view(),
            "language" => self.language(),
            "appStateGeneration" => self.app_state_gen.load(Ordering::Relaxed).to_string(),
            "securityGeneration" => crate::security::generation().to_string(),
            "servicesGeneration" => crate::services::generation().to_string(),
            "timezone" => crate::locale::read_timezone(),
            "layout" => self.layout_json(),
            "backgroundImage" => {
                if self.has_background_image() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "widgetMedia" => {
                if self.has_media_widgets() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "apps" => crate::apps::apps_json(),
            "faces" => crate::contributions::list("screen-display.face"),
            "widgets" => crate::contributions::list("screen-display.widget"),
            "appsGen" => self.catalog_gen().to_string(),
            "appResponse" => self.extension_rpc_response(),
            "settingsPage" => self.settings_page.lock().unwrap().clone(),
            "launcher" => crate::launcher::json(),
            "hot" => {
                if self.hot() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "pager" => {
                if self.pager() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "shellCapturePage" => self.shell_capture_page.load(Ordering::Relaxed).to_string(),
            "shellPage" => {
                if self.shell_page() == 1 {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "launch" => self.launch_id(),
            "hint" => self.hint_text(),
            "chromeWake" => self.chrome_wake().to_string(),
            "homePill" => if self.home_pill_visible() { "1" } else { "0" }.into(),
            "back" => {
                if self.back_pending() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "knob" => self.knob_step.load(Ordering::Relaxed).to_string(),
            "knobClick" => {
                if self.knob_click.load(Ordering::Relaxed) {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "knobHold" => {
                if self.knob_hold.load(Ordering::Relaxed) {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "knobHoldN" => self.knob_hold_n.load(Ordering::Relaxed).to_string(),
            "knobSeq" => self.knob_seq.load(Ordering::Relaxed).to_string(),
            "knobOn" => {
                if self.knob_on.load(Ordering::Relaxed) {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "controls" => {
                let mut modes = Vec::new();
                if self.touch_on() {
                    modes.push("touch");
                }
                if self.knob_on.load(Ordering::Relaxed) {
                    modes.push("rotary");
                }
                serde_json::to_string(&modes).unwrap_or_else(|_| "[]".into())
            }
            "screenW" => self.screen_w().to_string(),
            "screenH" => self.screen_h().to_string(),
            "touchOn" => {
                if self.touch_on() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "system" => self.system_state(),
            "wifiSetup" => {
                if crate::mode::is_init() {
                    self.wifi_setup()
                } else {
                    String::new()
                }
            }
            "ip" => json_string(&self.system_state(), &["network", "ip"])
                .filter(|s| !s.is_empty())
                .unwrap_or_else(crate::primary_ipv4),
            "iface" => crate::default_iface(),
            "wifiSsid" => crate::setup::wifi_link().0,
            "wifiIp" => crate::setup::wifi_link().1,
            "stream" => {
                if self.video.ready() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "zoom" => self.video.zoom().to_string(),
            "panX" => self.video.pan_x().to_string(),
            "panY" => self.video.pan_y().to_string(),
            "hid" => {
                if self.stick.ready() {
                    "1".into()
                } else if self.stick.failed() {
                    "0".into()
                } else {
                    String::new()
                }
            }
            "stickX" => self.stick.axis_x().to_string(),
            "stickY" => self.stick.axis_y().to_string(),
            "stickSpeed" => self.stick_speed().to_string(),
            "blankSeconds" => self.blank_seconds.load(Ordering::Relaxed).to_string(),
            "ipv6" => crate::setup::global_ipv6(),
            "wifi" => {
                if crate::setup::wifi_present() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "links" => crate::setup::net_links(),
            "wifiAp" => self.wifi_ap_json.lock().unwrap().clone(),
            // Core's event-refreshed cache is also used by the Web UI. Never
            // infer device capability from nearby hotspots or probe on read.
            "wifiGeneration" => json_string(&self.wifi_ap_json.lock().unwrap(), &["radio_generation"])
                .unwrap_or_default(),
            "wifiScan" => self.wifi_json.lock().unwrap().clone(),
            "startupHealth" => self.startup.snapshot(),
            "setupError" => self.setup_error.lock().unwrap().clone(),
            "setupBusy" => {
                if self.setup_busy() {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            "nfs" => {
                if self.nfs {
                    "1".into()
                } else {
                    "0".into()
                }
            }
            _ => String::new(),
        }
    }

    pub fn set_key(self: &Arc<Self>, key: &str, value: &str) {
        match key {
            "brightness" => {
                if let Ok(n) = value.parse::<i32>() {
                    self.set_brightness(n);
                }
            }
            "rotate" => {
                if let Ok(n) = value.parse::<u16>() {
                    self.set_rotate(n);
                }
            }
            "appView" => self.set_app_view(value),
            "language" => {
                let _ = crate::locale::write_language(value);
                if !crate::mode::is_init() {
                    self.bump_catalog();
                }
            }
            "setupDone" => {
                if (value == "1" || value == "true") && write_setup_complete(&self.data_dir) {
                    self.setup_done.store(true, Ordering::Relaxed);
                }
            }
            "launch" if crate::mode::is_init() => {}
            "refresh" => {
                if value == "1" || value == "true" {
                    self.request_catalog_refresh();
                }
            }
            "appRequest" => {
                self.start_extension_rpc(value);
            }
            "powerAction" => {
                if matches!(value, "on" | "off" | "reset") {
                    if self.extension_rpc_busy.swap(true, Ordering::AcqRel) {
                        return;
                    }
                    let action = value.to_string();
                    let id = {
                        let mut rpc = self.extension_rpc.lock().unwrap();
                        rpc.next_id = rpc.next_id.wrapping_add(1).max(1);
                        rpc.busy = true;
                        rpc.response = serde_json::json!({"id": rpc.next_id, "busy": true}).to_string();
                        rpc.next_id
                    };
                    let this = Arc::clone(self);
                    std::thread::spawn(move || {
                        let response = match crate::bus::core_power(&action) {
                            Ok(()) => serde_json::json!({"id": id, "busy": false, "ok": true, "response": {"action": action}}),
                            Err(error) => serde_json::json!({"id": id, "busy": false, "ok": false, "error": error}),
                        };
                        if let Ok(mut rpc) = this.extension_rpc.lock() {
                            rpc.busy = false;
                            rpc.response = response.to_string();
                        }
                        this.extension_rpc_busy.store(false, Ordering::Release);
                        this.set_hot(true);
                        this.wake.notify();
                    });
                }
            }
            "settingsPage" => {
                *self.settings_page.lock().unwrap() = value.trim().to_string();
                self.set_hot(true);
            }
            "timezone" => {
                let _ = crate::locale::write_timezone(value);
            }
            "layout" => self.set_layout_json(value),
            "hot" => self.set_hot(value == "1" || value == "true"),
            "frameAfter" => {
                if let Ok(ms) = value.parse::<u64>() {
                    if ms == 0 { self.frame_timer.clear(); }
                    else { self.frame_timer.schedule(Duration::from_millis(ms.min(60_000))); }
                    self.wake.notify();
                }
            }
            "pager" => self.set_pager(value == "1" || value == "true"),
            "shellPage" => { self.request_shell_page(if value == "1" { 1 } else { 0 }); },
            "appPageTransition" => {
                self.request_app_page_transition(value.parse::<i32>().unwrap_or(1))
            }
            "appScrollTransition" => {
                let mut fields = value.split(':');
                let direction = fields.next().and_then(|v| v.parse::<i32>().ok());
                let distance = fields.next().and_then(|v| v.parse::<usize>().ok());
                let y = fields.next().and_then(|v| v.parse::<usize>().ok());
                let height = fields.next().and_then(|v| v.parse::<usize>().ok());
                if let (Some(direction), Some(distance), Some(y), Some(height)) =
                    (direction, distance, y, height)
                {
                    let capture = (|| {
                        Some(crate::scroll_layer::ScrollCapture {
                            node: fields.next()?.parse().ok()?,
                            parent: fields.next()?.parse().ok()?,
                            offset: fields.next()?.parse().ok()?,
                            height: fields.next()?.parse().ok()?,
                        })
                    })();
                    self.request_app_scroll_transition(direction, distance, y, height, capture);
                }
            }
            "appDrawerTransition" => {
                let mut fields = value.split(':');
                let opening = fields.next().map(|v| v == "1" || v == "true");
                let y = fields.next().and_then(|v| v.parse::<usize>().ok());
                if let (Some(opening), Some(y)) = (opening, y) {
                    self.request_app_drawer_transition(opening, y);
                }
            }
            "hint" => self.set_hint(value),
            "back" => {
                if value == "1" || value == "true" {
                    self.request_back();
                } else {
                    let _ = self.take_back();
                }
            }
            "launch" => self.set_launch(value),
            "zoom" => {
                if let Ok(n) = value.parse::<u8>() {
                    self.video.set_zoom(n);
                }
            }
            "panX" => {
                if let Ok(n) = value.parse::<i32>() {
                    self.video.set_pan(n, self.video.pan_y());
                }
            }
            "panY" => {
                if let Ok(n) = value.parse::<i32>() {
                    self.video.set_pan(self.video.pan_x(), n);
                }
            }
            "stickX" => {
                if let Ok(n) = value.parse::<i32>() {
                    self.stick.set_axis(n, self.stick.axis_y());
                }
            }
            "stickY" => {
                if let Ok(n) = value.parse::<i32>() {
                    self.stick.set_axis(self.stick.axis_x(), n);
                }
            }
            "btn" => {
                if let Ok(n) = value.parse::<u8>() {
                    self.stick.set_buttons(n);
                }
            }
            "click" => {
                if let Ok(n) = value.parse::<u8>() {
                    self.stick.pulse_click(n);
                }
            }
            "stickSpeed" => {
                if let Ok(n) = value.parse::<i32>() {
                    self.set_stick_speed(n);
                }
            }
            "blankSeconds" => {
                if let Ok(n) = value.trim().parse::<u32>() {
                    let n = n.min(24 * 3600);
                    self.blank_seconds.store(n, Ordering::Relaxed);
                    let _ = fs::write(self.data_dir.join("blank-seconds"), format!("{n}\n"));
                    *self.last_input.lock().unwrap() = Instant::now();
                    self.wake.notify();
                    if n == 0 && self.blanked.swap(false, Ordering::Relaxed) {
                        crate::blank::wake_panel(self.brightness());
                    }
                }
            }
            "wifiScan" => self.enqueue(SetupJob::WifiScan),
            "wifiApRefresh" => self.enqueue(SetupJob::WifiApRefresh),
            "wifiApApply" => {
                self.clear_setup_error();
                self.enqueue(SetupJob::WifiApApply(value.to_string()));
            }
            "wifiConnect" => {
                let parsed: serde_json::Value =
                    serde_json::from_str(value).unwrap_or(serde_json::Value::Null);
                let ssid = parsed
                    .get("ssid")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let password = parsed
                    .get("password")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if ssid.is_empty() {
                    self.set_setup_error("ssid");
                } else {
                    self.clear_setup_error();
                    self.enqueue(SetupJob::WifiConnect { ssid, password });
                }
            }
            "netApply" => {
                self.clear_setup_error();
                self.enqueue(SetupJob::NetApply(value.to_string()));
            }
            "startupCheck" if crate::mode::is_init() => {
                self.clear_setup_error();
                self.startup.invalidate();
                self.wake.notify();
            }
            "authSetup" => {
                let parsed: serde_json::Value =
                    serde_json::from_str(value).unwrap_or(serde_json::Value::Null);
                let username = parsed
                    .get("username")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let password = parsed
                    .get("password")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let n = password.chars().count();
                if username.is_empty() || username.len() > 64 {
                    self.set_setup_error("username");
                } else if !(8..=128).contains(&n) {
                    self.set_setup_error("short");
                } else {
                    let language = parsed
                        .get("language")
                        .and_then(|v| v.as_str())
                        .unwrap_or("en")
                        .to_string();
                    let timezone = parsed
                        .get("timezone")
                        .and_then(|v| v.as_str())
                        .unwrap_or("UTC")
                        .to_string();
                    self.clear_setup_error();
                    self.enqueue(SetupJob::Auth {
                        username,
                        password,
                        language,
                        timezone,
                    });
                }
            }
            _ => {}
        }
    }

    fn system_state(&self) -> String {
        self.cached_system_state().to_string()
    }

    fn cached_system_state(&self) -> Arc<str> {
        self.system_json.lock().unwrap().clone()
    }

    pub fn update_system_state(&self, raw: &str) {
        if serde_json::from_str::<serde_json::Value>(raw).is_err() { return; }
        let resources = self.system_resources.lock().unwrap();
        let json: Arc<str> = crate::storage::overlay_system_json(raw, resources.as_ref()).into();
        let mut cache = self.system_json.lock().unwrap();
        if *cache != json {
            *cache = json;
            drop(cache);
            self.set_hot(true);
        }
    }

    pub fn update_resources(&self, raw: &str) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else { return; };
        if !value.is_object() { return; }
        let mut resources = self.system_resources.lock().unwrap();
        let mut cache = self.system_json.lock().unwrap();
        let state = serde_json::from_str::<serde_json::Value>(&cache);
        let mut changed = false;
        if let Ok(mut state) = state {
            if crate::storage::merge_resources(&mut state, &value) {
                *cache = state.to_string().into();
                changed = true;
            }
        }
        *resources = Some(value);
        drop(cache);
        drop(resources);
        if changed && self.shell_page() == 0 && !self.is_blanked() {
            self.set_hot(true);
        }
    }

    pub fn update_fps(&self, fps: i32) {
        let mut cache = self.system_json.lock().unwrap();
        let Ok(mut state) = serde_json::from_str::<serde_json::Value>(&cache) else { return; };
        state["video"]["actual_fps"] = serde_json::json!(fps);
        *cache = state.to_string().into();
        drop(cache);
        self.set_hot(true);
    }

    pub fn invalidate_system_state(&self) {
        let mut resources = self.system_resources.lock().unwrap();
        *resources = None;
        *self.system_json.lock().unwrap() = Arc::from("");
        self.set_hot(true);
    }

    fn wifi_setup(&self) -> String {
        self.wifi_setup_json.lock().unwrap().clone()
    }

    pub fn refresh_wifi_ap(&self) {
        if crate::setup::wifi_present() {
            if let Ok(status) = crate::setup::hotspot_command("ap-status", "{}") {
                self.update_wifi_ap(status);
            }
        }
    }

    fn update_wifi_ap(&self, raw: String) {
        let mut cache = self.wifi_ap_json.lock().unwrap();
        if *cache != raw {
            *cache = raw;
            drop(cache);
            self.set_hot(true);
        }
    }

    pub fn refresh_wifi_setup(&self) {
        let json = if crate::setup::init_ap_on_air() {
            let password = crate::setup::init_ap_password();
            if password.is_empty() {
                String::new()
            } else {
                let ssid = crate::setup::init_ap_ssid();
                let payload = format!(
                    "WIFI:T:WPA;S:{};P:{};;",
                    wifi_qr_escape(&ssid),
                    wifi_qr_escape(&password)
                );
                QrCode::encode_text(&payload, QrCodeEcc::Medium)
                    .ok()
                    .map(|qr| {
                        let size = qr.size();
                        let mut runs = Vec::<[i32; 3]>::new();
                        for y in 0..size {
                            let mut x = 0;
                            while x < size {
                                if !qr.get_module(x, y) {
                                    x += 1;
                                    continue;
                                }
                                let start = x;
                                while x < size && qr.get_module(x, y) {
                                    x += 1;
                                }
                                runs.push([start, y, x - start]);
                            }
                        }
                        serde_json::json!({
                            "ssid": ssid, "password": password,
                            "size": size, "runs": runs,
                        })
                        .to_string()
                    })
                    .unwrap_or_default()
            }
        } else {
            String::new()
        };
        let mut cache = self.wifi_setup_json.lock().unwrap();
        if *cache != json {
            *cache = json;
            drop(cache);
            self.set_hot(true);
        }
    }
}

fn wifi_qr_escape(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        if matches!(ch, '\\' | ';' | ',' | ':' | '"') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn default_rotate() -> u16 {
    if let Some(deg) = rotate_from_machine_json() {
        return deg;
    }
    // Pro panel's native scan is sideways. 270° is upright.
    let compat = fs::read("/proc/device-tree/compatible").unwrap_or_default();
    let text = String::from_utf8_lossy(&compat);
    if text.contains("nanokvm-pro") || text.contains("ax630") {
        return 270;
    }
    0
}

fn rotate_from_machine_json() -> Option<u16> {
    let raw = fs::read("/usr/share/onekvm/machine.json").ok()?;
    let value: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let deg = value.get("screen_display")?.get("rotate")?.as_u64()?;
    match deg {
        0 | 90 | 180 | 270 => Some(deg as u16),
        _ => None,
    }
}

fn json_string(raw: &str, path: &[&str]) -> Option<String> {
    let mut value = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    for key in path {
        value = value.get(*key)?.clone();
    }
    value.as_str().map(|s| s.to_string())
}
