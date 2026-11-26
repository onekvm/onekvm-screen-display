//! PocketJS guest on Linux fbdev: Vue Vapor bundle → RGB565 `/dev/fb0` + evdev.

mod apps;
mod app_video;
mod app_lock;
mod app_rpc;
mod command;
mod auth;
mod background;
mod blank;
mod bus;
mod bytecode;
mod bundle_cache;
mod file_blob;
mod events;
mod chrome;
mod contributions;
mod damage;
mod default_layout;
mod diagnostics;
mod devtools;
mod adb_debug;
mod dynamic_fonts;
mod hid;
mod guest;
mod frame_timer;
mod home_compositor;
mod h264_codec;
mod knob;
mod input_ready;
mod launcher;
mod launcher_fonts;
mod locale;
mod media;
mod media_store;
mod media_migration;
#[cfg(test)]
mod memory_profile;
mod heap;
mod mode;
mod page_transition;
mod qr;
mod scroll_layer;
mod screen_views;
mod setup;
mod startup;
mod network_config;
mod shared;
mod services;
mod local_control;
mod security;
mod rotation;
mod remote;
mod remote_video;
mod retained_frame;
mod storage;
mod system_actions;
mod touch_navigation;
mod video_decode;
mod wake;
mod widget_media;
#[cfg(test)]
mod shell_lifecycle_tests;

use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::chrome::{draw_host_spinner, draw_load_plate, AppChrome, LoadIcon};
use crate::file_blob::FileBlob;
use crate::bundle_cache::BundleCache;
use crate::page_transition::{blit_slide, PageTransition};
use crate::shared::{AppDrawerTransition, AppScrollTransition, Shared};
use pocket_mod::{compile_script, Guest};

use anyhow::{bail, Context, Result};
use evdev::{AbsoluteAxisCode, Device as Evdev, EventSummary, EventType, KeyCode};
use memmap2::{MmapMut, MmapOptions};
use pocket_mod::qjs::Function;
use pocket_ui_surface::UiSurface;
use pocketjs_core::raster;
use pocketjs_core::spec::ANALOG_CENTER;
use std::os::unix::process::CommandExt;

fn oriented_size(panel_w: usize, panel_h: usize, rot: u16) -> (usize, usize) {
    match rot {
        90 | 270 => (panel_h.max(1), panel_w.max(1)),
        _ => (panel_w.max(1), panel_h.max(1)),
    }
}
const TICK_MS: u64 = 16;
const SCROLL_TARGET_CREDIT_MS: u64 = 8;
const STREAM_MS: u64 = 66;
const IDLE_MS: u64 = 1000;
const TOUCH_IDLE_MS: u64 = 32;
const LOAD_PLATE_FADE: f32 = 0.16;
const ENTER_FADE: f32 = 0.22;
const PAGER_SLOP: i32 = 12;
const PAN_COMMIT: i32 = 28;
const FLICK_VX: f32 = 380.0;
// Keep the host-cached home/launcher pager in step with the PocketJS pager.
const SNAP_MS: f32 = 0.28;
const ROT_MS: f32 = 0.28;
const FBIO_WAITFORVSYNC: libc::Ioctl = 0x4004_4620u32 as libc::Ioctl;
const KDSETMODE: libc::Ioctl = 0x4B3A as libc::Ioctl;
const KD_GRAPHICS: libc::c_int = 1;

enum EnterFade {
    Cross {
        from: Vec<u16>,
        to: Vec<u16>,
        t0: Instant,
    },
}

struct RotSpin {
    from: u16,
    delta: f32,
    to: u16,
    t0: Instant,
    frame: Vec<u16>,
}

#[derive(Clone, Copy)]
enum PagerMotion {
    Idle,
    Armed {
        x0: i32,
        y0: i32,
    },
    GuestLock,
    Drag {
        x0: i32,
        slide0: i32,
        last_x: i32,
        last_t: Instant,
    },
    Snap {
        from: i32,
        to: i32,
        t0: Instant,
    },
}

enum AppTransitionRequest {
    Page(i32),
    ShellPage(i32),
    Scroll(AppScrollTransition),
    Drawer(AppDrawerTransition),
}

fn app_transition_started(request: &AppTransitionRequest, target_started: Instant) -> Instant {
    let now = Instant::now();
    if !matches!(request, AppTransitionRequest::Scroll(_)) {
        return now;
    }
    // Credit a bounded part of target-frame rendering to rotary motion. This
    // keeps the response short while still leaving enough compositor time for
    // visible intermediate frames on the Pro framebuffer.
    let credit = target_started
        .elapsed()
        .min(Duration::from_millis(SCROLL_TARGET_CREDIT_MS));
    now.checked_sub(credit).unwrap_or(now)
}

fn make_app_transition(
    request: AppTransitionRequest,
    previous: Vec<u16>,
    target: Vec<u16>,
    panel_width: usize,
    panel_height: usize,
    started: Instant,
    layer: Option<scroll_layer::ScrollLayer>,
    visible_scroll: Option<(i32, usize)>,
) -> PageTransition {
    match request {
        AppTransitionRequest::Page(direction) => {
            PageTransition::new(previous, target, direction, started)
        }
        AppTransitionRequest::ShellPage(direction) => {
            PageTransition::new_shell(previous, target, direction, started)
        }
        AppTransitionRequest::Scroll(request) => {
            let region = (0, request.y, panel_width, request.height);
            if let Some(layer) = layer {
                let from_offset = visible_scroll
                    .filter(|(node, _)| *node == layer.node)
                    .map(|(_, offset)| offset)
                    .unwrap_or_else(|| {
                        if request.direction >= 0 {
                            layer.offset.saturating_sub(request.distance)
                        } else {
                            layer.offset.saturating_add(request.distance)
                        }
                    });
                PageTransition::new_list(previous, target, layer, from_offset, region, started)
            } else {
                PageTransition::new_vertical(
                    previous,
                    target,
                    request.direction,
                    request.distance,
                    region,
                    started,
                )
            }
        }
        AppTransitionRequest::Drawer(request) => PageTransition::new_drawer(
            previous,
            target,
            request.opening,
            request.y.min(panel_height),
            started,
        ),
    }
}

fn take_app_transition_request(
    shared: &Shared,
    in_app: bool,
    shell_live: bool,
) -> Option<AppTransitionRequest> {
    let drawer = shared.take_app_drawer_transition();
    let scroll = shared.take_app_scroll_transition();
    let page = shared.take_app_page_transition();
    if in_app {
        drawer
            .map(AppTransitionRequest::Drawer)
            .or_else(|| scroll.map(AppTransitionRequest::Scroll))
            .or_else(|| page.map(AppTransitionRequest::Page))
    } else if shell_live {
        scroll.map(AppTransitionRequest::Scroll)
            .or_else(|| page.map(AppTransitionRequest::ShellPage))
    } else {
        None
    }
}

struct Session {
    guest: guest::HostedGuest,
    debug: Option<devtools::Connection>,
    debug_touches: Vec<u32>,
    surface: UiSurface,
    id: String,
    shared: Arc<Shared>,
    scroll_layer: Option<scroll_layer::ScrollLayer>,
    /// Strip retained across retargets. `scroll_layer` is only the capture
    /// for the transition about to start.
    list_cache: Option<scroll_layer::ScrollLayer>,
    capture_scroll: bool,
    /// Cancel words for a contact the host pager took away from the guest.
    /// Delivered on the next shell frame. An empty touch list after the
    /// slide would otherwise release that contact as a tap.
    pager_cancel: Option<Vec<u32>>,
    home_frame: retained_frame::RetainedFrame,
    icon_gen: u32,
    revision: Option<u64>,
    rpc: app_rpc::Channel,
    icon_textures: std::collections::BTreeMap<String, i32>,
    views: Option<Box<screen_views::Views>>,
    rendered_shell_page: Option<u8>,
    shell_collected: Instant,
}

impl Drop for Session {
    fn drop(&mut self) { self.rpc.close(); }
}

impl Session {
    fn poll_devtools(&mut self, deadline: Instant) -> bool {
        let mut changed = false;
        if let Some(debug) = self.debug.as_ref().filter(|debug| debug.pending()) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                self.shared.frame_timer.schedule_earlier(Duration::from_millis(16));
            } else {
                self.guest.arm(remaining.min(Duration::from_millis(50)));
                // Polling must not turn a held touch into a synthetic release/click.
                if let Err(error) = self.guest.frame_with_touches(0, ANALOG_CENTER, &self.debug_touches) { debug.error(&format!("{error:#}")); }
                self.surface.tick();
                changed = true;
            }
        }
        if let Some(views) = self.views.as_mut() { changed |= views.poll_devtools(deadline); }
        changed
    }
}

fn upload_launcher_icons(id: &str, surface: &UiSurface, guest: &Guest, handles: &mut std::collections::BTreeMap<String, i32>) -> Result<()> {
    if let Ok(bundle) = load_bundle(id) {
        launcher_fonts::refresh(surface, &bundle.pak);
        bundle.pak.release_pages();
    }
    let mut textures = serde_json::Map::new();
    for (key, path) in apps::launcher_icons() {
        if let Some(&handle) = handles.get(&key) {
            textures.insert(key, handle.into());
            continue;
        }
        let Some(icon) = LoadIcon::from_path(&path) else { continue; };
        let (width, height, pixels) = icon.texture();
        let handle = surface.with_ui(|ui| ui.upload_texture(&pixels, width, height, pocketjs_core::spec::psm::PSM_8888));
        if handle >= 0 { textures.insert(key.clone(), handle.into()); handles.insert(key, handle); }
    }
    handles.retain(|key, handle| {
        if textures.contains_key(key) { true } else { surface.with_ui(|ui| ui.free_texture(*handle)); false }
    });
    guest.eval("launcher-icons", &format!("for (const key in ui.__textures) if (key.startsWith('app-icon:')) delete ui.__textures[key]; Object.assign(ui.__textures, {});", serde_json::Value::Object(textures)))?;
    Ok(())
}

fn refresh_launcher_icons(session: &mut Session) -> Result<()> {
    if !matches!(session.id.as_str(), "shell" | "settings") { return Ok(()); }
    let generation = session.shared.catalog_gen();
    if generation == session.icon_gen { return Ok(()); }
    upload_launcher_icons(&session.id, &session.surface, &session.guest, &mut session.icon_textures)?;
    session.icon_gen = generation;
    Ok(())
}

struct Parked {
    session: Session,
    words: Vec<u32>,
    cache: [Option<Vec<u16>>; 2],
}

struct Panel {
    file: File,
    map: MmapMut,
    width: usize,
    height: usize,
    stride: usize,
    logical_w: usize,
    logical_h: usize,
    rotate: u16,
    remote_frame: remote::PresentedFrame,
    vsync_ok: bool,
}

struct Touch {
    device: Evdev,
    ready: Option<input_ready::InputReady>,
    max_x: i32,
    max_y: i32,
    x: i32,
    y: i32,
    lx: i32,
    ly: i32,
    down: bool,
}

fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        None => enter(),
        Some("main") => run(),
        Some("init") => run_init(),
        Some("info") | Some("--info") => cmd_info(),
        Some("compile") => {
            let src = args
                .next()
                .ok_or_else(|| anyhow::anyhow!("compile <js> <jsc>"))?;
            let dst = args
                .next()
                .ok_or_else(|| anyhow::anyhow!("compile <js> <jsc>"))?;
            cmd_compile(&src, &dst)
        }
        Some("--health") => {
            println!("{{\"ok\":true}}");
            Ok(())
        }
        Some("-h") | Some("--help") => {
            eprintln!("onekvm-screen-display [main|init|info|compile <js> <jsc>|--health]");
            Ok(())
        }
        Some(other) => bail!("unknown command {other}"),
    }
}

fn cmd_compile(src: &str, dst: &str) -> Result<()> {
    let js = fs::read_to_string(src).with_context(|| format!("read {src}"))?;
    let t0 = Instant::now();
    let bytecode = compile_script(src, &js)?;
    fs::write(dst, &bytecode).with_context(|| format!("write {dst}"))?;
    fs::write(format!("{dst}.abi"),bytecode_abi())?;
    let pak = fs::read(std::path::Path::new(src).with_extension("pak"))?;
    fs::write(format!("{dst}.meta"), bytecode::metadata(js.as_bytes(), &pak, &bytecode, &bytecode_abi()))?;
    eprintln!(
        "compiled {} -> {} ({} bytes, {}ms)",
        src,
        dst,
        bytecode.len(),
        t0.elapsed().as_millis()
    );
    Ok(())
}

/// No arguments: this process is only the entry. It execs init or main
/// and does not draw. Init has no app catalog; main is the shell.
fn enter() -> Result<()> {
    let mode = if shared::setup_complete() {
        "main"
    } else {
        "init"
    };
    log::info!("screen-display entry exec {mode}");
    let exe = std::env::current_exe().context("current exe")?;
    let err = std::process::Command::new(exe).arg(mode).exec();
    Err(err).context("exec screen mode")
}

fn run_init() -> Result<()> {
    mode::set_init(true);
    hide_fbcon();
    let mut panel = Panel::open()?;
    let shared = Arc::new(Shared::load_bare());
    shared.check_startup();
    crate::remote_video::spawn(shared.clone());
    std::thread::spawn({
        let shared = shared.clone();
        move || {
            if let Err(err) = bus::serve(shared) {
                log::error!("screen-display init dbus: {err:#}");
            }
        }
    });
    bus::watch_core(shared.clone());
    events::spawn(shared.clone());
    bus::watch_auth_configured(shared.clone());
    panel.apply_rotate(shared.rotate());
    shared.set_screen(panel.logical_w as u16, panel.logical_h as u16);
    let mut touch = match Touch::open(&panel, &shared) {
        Ok(touch) => Some(touch),
        Err(err) => {
            log::info!("panel has no touch input: {err:#}");
            None
        }
    };
    shared.set_touch(touch.is_some());
    wake_backlight();
    apply_brightness(shared.brightness());
    crate::knob::spawn(shared.clone());
    crate::blank::spawn(shared.clone());
    std::thread::spawn(|| {
        if let Err(err) = crate::setup::ensure_init_ap() {
            log::warn!("init access point: {err}");
        }
    });
    let mut session = boot_session("init", &shared)?;
    let mut pixels = vec![0u16; panel.face_len()];
    let mut last_words = Vec::new();
    let mut last_brightness = shared.brightness();
    let mut last = Instant::now();
    let mut transition: Option<PageTransition> = None;
    let mut settle = 0u8;
    let mut was_touching = false;
    let mut was_blanked = false;
    loop {
        let wake_generation = shared.wake.generation();
        panel.publish_remote(&shared.remote);
        if shared.setup_finished() {
            log::info!("setup complete; init process exit");
            return Ok(());
        }
        let touches = shared.remote.touches(touch.as_mut().map(|t| t.poll(&panel)).unwrap_or_default());
        let touching = !touches.is_empty();
        // An empty release frame is input too: never hold it behind cached
        // motion, or taps and gesture completion can disappear.
        let touch_input = touching || was_touching;
        was_touching = touching;
        if touch_input {
            shared.note_input();
        }
        if shared.is_blanked() {
            was_blanked = true;
            shared.unlatch_knob();
            shared.wake.wait(wake_generation, touch.as_ref().filter(|t| t.needs_poll()).map(|_| Duration::from_millis(TOUCH_IDLE_MS)));
            last = Instant::now();
            continue;
        }
        if was_blanked {
            was_blanked = false;
            if let Some(mut motion) = transition.take() {
                park_scroll_layer(&mut session, &mut motion);
            }
            last_words.clear();
            settle = 3;
        }
        let queued_input = shared.knob_queued();
        if queued_input || touch_input {
            settle = 3;
        }
        shared.latch_knob();
        let was_animating = transition.is_some();
        // Init is a separate process, but uses the same complete-list capture
        // and pixel compositor as the main host. Do not rerun the guest while
        // showing cached motion; setup work and real input can interrupt it.
        if transition.is_none() || queued_input || touch_input || shared.setup_busy() {
            let visible_scroll = transition
                .as_ref()
                .and_then(PageTransition::scroll_position);
            if let Some(motion) = transition.as_mut() {
                park_scroll_layer(&mut session, motion);
            }
            let previous = pixels.clone();
            let target_started = Instant::now();
            shared.set_app_scroll_position(visible_scroll);
            let result = paint_guest(
                &mut session,
                &touches,
                &mut last_words,
                &mut pixels,
                !was_animating,
            );
            shared.set_app_scroll_position(None);
            let dirty = match result {
                Ok(dirty) => dirty,
                Err(err) => {
                    shared.unlatch_knob();
                    return Err(err);
                }
            };
            // A step/subpage change wins over a list reveal emitted in the
            // same guest frame. Drain every request so none leaks to a later
            // page with a different node mirror.
            let page = shared.take_app_page_transition();
            let other = take_app_transition_request(&shared, true, false);
            let request = page.map(AppTransitionRequest::Page).or(other);
            transition = request
                .filter(|_| !touching && !shared.setup_busy())
                .map(|request| {
                    let started = app_transition_started(&request, target_started);
                    make_app_transition(
                        request,
                        previous,
                        pixels.clone(),
                        panel.logical_w,
                        panel.logical_h,
                        started,
                        session.scroll_layer.take(),
                        visible_scroll,
                    )
                });
            if transition.is_some() {
                shared.set_hot(false);
                settle = 0;
            } else if dirty {
                panel.present(&pixels);
            }
            settle = settle.saturating_sub(1);
        } else {
            shared.unlatch_knob();
        }
        let mut finished = false;
        if let Some(motion) = transition.as_mut() {
            let done = motion.paint(
                &mut pixels,
                panel.logical_w,
                panel.logical_h,
                Instant::now(),
            );
            panel.present(&pixels);
            if done {
                park_scroll_layer(&mut session, motion);
                finished = true;
                // Flush deferred Vue node mirrors and apply a drawer choice
                // once its close animation has actually been presented.
                settle = 2;
            }
        }
        if finished {
            transition = None;
        }
        retain_scroll_layer(&mut session);
        let bri = shared.brightness();
        if bri != last_brightness {
            last_brightness = bri;
            apply_brightness(bri);
        }
        let now = Instant::now();
        let fast = touch_input
            || shared.knob_queued()
            || shared.setup_busy()
            || shared.hot()
            || transition.is_some()
            || was_animating
            || settle > 0;
        let idle_ms = if touch.as_ref().is_some_and(Touch::needs_poll) {
            TOUCH_IDLE_MS
        } else {
            IDLE_MS
        };
        let deadline = last + Duration::from_millis(if fast { TICK_MS } else { idle_ms });
        if now < deadline {
            if deadline.duration_since(last) <= Duration::from_millis(TICK_MS) {
                std::thread::sleep(deadline - now);
            } else {
                shared.wake.wait(wake_generation, Some(deadline - now));
            }
        }
        last = Instant::now();
    }
}

fn cmd_info() -> Result<()> {
    let (w, h, bpp) = fb_sys_geom().unwrap_or((240, 240, 16));
    let round = panel_round(w as i32, h as i32);
    println!(
        "{{\"ok\":true,\"width\":{w},\"height\":{h},\"bpp\":{bpp},\"shape\":\"{}\",\"device\":\"/dev/fb0\",\"runtime\":\"pocketjs-vue-vapor\"}}",
        if round { "round" } else { "rect" }
    );
    Ok(())
}

fn run() -> Result<()> {
    hide_fbcon();
    let mut panel = Panel::open()?;
    let shared = Arc::new(Shared::load());
    crate::remote_video::spawn(shared.clone());
    events::spawn(shared.clone());
    bus::watch_core(shared.clone());
    crate::media::spawn(shared.video.clone(), shared.data_dir.clone());
    crate::app_video::spawn(shared.carplay.clone());
    crate::hid::spawn(shared.stick.clone(), shared.data_dir.clone());
    crate::knob::spawn(shared.clone());
    crate::blank::spawn(shared.clone());
    std::thread::spawn({
        let shared = shared.clone();
        move || {
            if let Err(err) = bus::serve(shared) {
                log::error!("screen-display dbus: {err:#}");
            }
        }
    });
    apply_brightness(shared.brightness());
    panel.apply_rotate(shared.rotate());
    shared.set_screen(panel.logical_w as u16, panel.logical_h as u16);
    let mut touch = match Touch::open(&panel, &shared) {
        Ok(touch) => Some(touch),
        Err(err) => {
            log::info!("panel has no touch input: {err:#}");
            None
        }
    };
    shared.set_touch(touch.is_some());
    wake_backlight();
    let mut live = Some(boot_session("shell", &shared)?);
    let mut pixels = vec![0u16; panel.face_len()];
    let mut empty = vec![0u16; panel.face_len()];
    let mut cache: [Option<Vec<u16>>; 2] = [None, None];
    let mut last_words: Vec<u32> = Vec::new();
    warmup_shell(
        live.as_mut().unwrap(),
        &shared,
        &mut last_words,
        &mut pixels,
        &mut cache,
    )?;
    present_home(&mut panel, &cache, &empty, &mut pixels);
    let mut chrome = AppChrome::new(shared.clone())?;
    let mut chrome_words: Vec<u32> = Vec::new();
    {
        let mut scratch = vec![0u16; panel.face_len()];
        overlay_chrome(&mut chrome, &mut chrome_words, &mut scratch)?;
    }
    let mut last_brightness = i32::MIN;
    let mut last = Instant::now();
    let mut last_touch = Instant::now() - Duration::from_secs(8);
    let mut was_touching = false;
    let mut touch_position = (0, 0);
    let mut motion = PagerMotion::Idle;
    let mut last_slide = i32::MIN;
    let mut settle = 0u8;
    let mut last_hm = {
        let (h, m, _) = wall_hms();
        h * 60 + m
    };
    let mut last_second = -1i32;
    let mut enter: Option<EnterFade> = None;
    let mut app_home = touch_navigation::Navigation::default();
    let mut app_pixels = vec![0u16; panel.face_len()];

    let mut app_page_transition: Option<PageTransition> = None;
    let mut last_hint_on = false;
    let mut last_pill_on = false;
    let mut last_stream_seq = u32::MAX;
    let mut rot_spin: Option<RotSpin> = None;
    let mut parked_shell: Option<Parked> = None;
    let mut was_blanked = false;

    heap::release_cold_code_pages();
    loop {
        let wake_generation = shared.wake.generation();
        let debug_deadline = Instant::now() + Duration::from_millis(100);
        let debug_changed = live.as_mut().is_some_and(|session| session.poll_devtools(debug_deadline))
            | parked_shell.as_mut().is_some_and(|parked| parked.session.poll_devtools(debug_deadline));
        if debug_changed { settle = 3; }
        shared.expire_app_lock();
        panel.publish_remote(&shared.remote);
        let touches = shared.remote.touches(touch.as_mut().map(|t| t.poll(&panel)).unwrap_or_default());
        let touching = !touches.is_empty();
        if touching {
            last_touch = Instant::now();
            shared.note_input();
        }
        if shared.is_blanked() {
            // Backlight off means no local renderer or preview consumer.
            // Physical/remote input still wakes through the same paths.
            if !was_blanked {
                if let Some(views) = live.as_mut().and_then(|session| session.views.as_mut()) { views.pause(); }
            }
            was_blanked = true;
            shared.video.set_wanted(false);
            shared.stick.set_wanted(false);
            shared.unlatch_knob();
            shared.wake.wait(wake_generation, Some(Duration::from_millis(
                if touch.as_ref().is_some_and(Touch::needs_poll) { TOUCH_IDLE_MS } else { IDLE_MS },
            )));
            last = Instant::now();
            continue;
        }
        if was_blanked {
            was_blanked = false;
            enter = None;
            if let Some(mut transition) = app_page_transition.take() {
                park_scroll_layer(live.as_mut().unwrap(), &mut transition);
            }
            rot_spin = None;
            motion = PagerMotion::Idle;
            app_home = touch_navigation::Navigation::default();
            last_words.clear();
            settle = 3;
        }
        let guest_frame_due = shared.frame_timer.take_due();

        if live
            .as_ref()
            .is_some_and(|session| session.id != "shell" && (!crate::apps::can_launch(&session.id) || session.revision != crate::apps::revision(&session.id)))
        {
            // A disabled or removed contributor must not leave its current
            // guest running after the catalog has disappeared.
            shared.set_launch("shell");
        }
        let want_rot = shared.rotate();
        let (nw, nh) = oriented_size(panel.width, panel.height, want_rot);
        if nw != panel.logical_w || nh != panel.logical_h {
            panel.rotate = want_rot;
            panel.logical_w = nw;
            panel.logical_h = nh;
            rot_spin = None;
            shared.set_screen(nw as u16, nh as u16);
            let n = panel.face_len();
            pixels.resize(n, 0);
            empty.resize(n, 0);
            empty.fill(0);
            app_pixels.resize(n, 0);
            app_page_transition = None;
            cache = [None, None];
            last_words.clear();
            parked_shell = None;
            motion = PagerMotion::Idle;
            live = Some(boot_session("shell", &shared)?);
            chrome = AppChrome::new(shared.clone())?;
            chrome_words.clear();
            warmup_shell(
                live.as_mut().unwrap(),
                &shared,
                &mut last_words,
                &mut pixels,
                &mut cache,
            )?;
            present_home(&mut panel, &cache, &empty, &mut pixels);
            continue;
        }
        if rot_spin.is_none() && want_rot != panel.rotate {
            if panel.logical_w == panel.width && panel.logical_h == panel.height {
                rot_spin = Some(RotSpin {
                    from: panel.rotate,
                    delta: rot_delta(panel.rotate, want_rot),
                    to: want_rot,
                    t0: Instant::now(),
                    frame: pixels.clone(),
                });
            } else {
                panel.rotate = want_rot;
                settle = 2;
            }
        }
        if let Some(spin) = rot_spin.as_ref() {
            let t = spin.t0.elapsed().as_secs_f32() / ROT_MS;
            if t >= 1.0 {
                panel.rotate = spin.to;
                rot_spin = None;
                settle = 2;
            } else {
                let e = 1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(2);
                let angle = spin.from as f32 + spin.delta * e;
                panel.present_angle(&spin.frame, angle);
                let bri = shared.brightness();
                if bri != last_brightness {
                    last_brightness = bri;
                    apply_brightness(bri);
                }
                let now = Instant::now();
                let deadline = last + Duration::from_millis(TICK_MS);
                if now < deadline {
                    std::thread::sleep(deadline - now);
                }
                last = Instant::now();
                continue;
            }
        }
        let fading = enter.is_some() || app_page_transition.is_some();
        let hint_on = !shared.hint_text().is_empty();
        let linger = live.as_ref().unwrap().id != "shell"
            && last_touch.elapsed() < Duration::from_millis(280);
        let foreground = live.as_ref().unwrap().id.as_str();
        let streaming = foreground == "stream";
        let carplay = foreground == "carplay/main";
        let sticking = foreground == "stick";
        shared.video.set_wanted(streaming);
        shared.carplay.set_wanted(carplay);
        shared.stick.set_wanted(sticking);
        let stream_view = (streaming || carplay) && enter.is_none();
        let stick_view = sticking && enter.is_none();
        let media_delay = if live.as_ref().unwrap().id == "shell" && shared.shell_page() == 0 {
            shared.media_frame_delay_ms()
        } else { None };
        let media_view = media_delay == Some(0);
        let deadline = last
            + Duration::from_millis(
                if fading
                    || shared.hot()
                    || settle > 0
                    || touching
                    || linger
                    || hint_on
                    || chrome.animating()
                    || stick_view
                    || shared.knob_queued()
                {
                    TICK_MS
                } else if let Some(delay) = media_delay {
                    delay.max(1).min(IDLE_MS)
                } else if stream_view {
                    STREAM_MS
                } else if touch.as_ref().is_some_and(Touch::needs_poll) {
                    TOUCH_IDLE_MS
                } else {
                    IDLE_MS
                },
            );
        let deadline = shared.frame_timer.deadline().map_or(deadline, |at| deadline.min(at));
        let released = was_touching && !touching;
        // Host paging and edge gestures must use the same merged contact as
        // the guest, including remote input. Keep the last point for release.
        if let Some(word) = touches.first() {
            touch_position = ((word & 0x1ff) as i32, ((word >> 9) & 0x1ff) as i32);
        }
        let (lx, ly) = touch_position;
        was_touching = touching;
        let queued_input = shared.knob_queued();
        if queued_input || shared.take_knob_wake() {
            settle = 3;
        }
        shared.latch_knob();
        let mut framed = false;
        let in_app = live.as_ref().unwrap().id != "shell" && enter.is_none();
        let shell_live = live.as_ref().unwrap().id == "shell" && enter.is_none();
        let (guest_touches, mut chrome_dirty, go_shell) = step_app_home(
            &mut app_home,
            in_app,
            touching,
            lx,
            ly,
            &touches,
            &shared,
            last_hint_on,
            hint_on,
        );
        last_hint_on = hint_on;
        // Expiring the entry/confirmation cue must redraw the overlay even
        // when the App itself is completely idle and produces no new pixels.
        let pill_on = in_app && shared.home_pill_visible();
        chrome_dirty |= pill_on != last_pill_on;
        chrome_dirty |= chrome.animating();
        last_pill_on = pill_on;
        let (hh, mm, ss) = wall_hms();
        let hm = hh * 60 + mm;

        if let Some(mut transition) = app_page_transition.take() {
            let transition_frames = transition.frame_count();
            let host_owned_transition = transition.is_host_owned();
            let mut transition_elapsed_ms = None;
            let mut done = false;
            if touching {
                // Give a direct grab the last displayed list position, not
                // the rotary target. Deliver DOWN now so a quick tap cannot
                // be lost behind the cached animation.
                let visible_scroll = transition.scroll_position();
                park_scroll_layer(live.as_mut().unwrap(), &mut transition);
                shared.set_app_scroll_position(visible_scroll);
                let result = if shell_live {
                    paint_shell_guest(
                        live.as_mut().unwrap(), &guest_touches, &mut last_words,
                        &mut pixels, &shared, false,
                    )
                } else {
                    paint_guest(
                        live.as_mut().unwrap(), &guest_touches, &mut last_words,
                        &mut pixels, false,
                    )
                };
                shared.set_app_scroll_position(None);
                result?;
                framed = true;
                if in_app {
                    app_pixels.copy_from_slice(&pixels);
                }
                done = true;
                transition_elapsed_ms = Some(transition.elapsed_ms(Instant::now()));
            } else if (queued_input || shared.back_pending())
                && (in_app || shell_live)
                && !shared.has_launch()
            {
                // A fast rotary turn can arrive while the previous motion is
                // still on screen. Consume it now and retarget from the
                // currently visible guest frame. Previously this path merely
                // finished the old transition and re-queued the detent, which
                // made the cursor trail one or more pages behind the list.
                // Keep the last actually presented frame and its content
                // coordinate. Advancing an unpresented frame here introduces
                // a jump, and using the old target drops in-flight distance.
                let visible_scroll = transition.scroll_position();
                park_scroll_layer(live.as_mut().unwrap(), &mut transition);
                let previous = pixels.clone();
                let target_started = Instant::now();
                if shell_live {
                    paint_shell_guest(
                        live.as_mut().unwrap(),
                        &guest_touches,
                        &mut last_words,
                        &mut pixels,
                        &shared,
                        false,
                    )?;
                } else {
                    paint_guest(
                        live.as_mut().unwrap(),
                        &guest_touches,
                        &mut last_words,
                        &mut pixels,
                        false,
                    )?;
                }
                framed = true;
                let request = take_app_transition_request(&shared, in_app, shell_live);
                if let Some(request) = request {
                    let transition_started = app_transition_started(&request, target_started);
                    let target = pixels.clone();
                    if in_app {
                        app_pixels.copy_from_slice(&target);
                    } else {
                        let page = shared.shell_page() as usize;
                        if page < cache.len() {
                            cache[page] = Some(target.clone());
                        }
                    }
                    let mut next = make_app_transition(
                        request,
                        previous,
                        target,
                        panel.logical_w,
                        panel.logical_h,
                        transition_started,
                        live.as_mut().unwrap().scroll_layer.take(),
                        visible_scroll,
                    );
                    let host_owned_request = next.is_host_owned();
                    next.paint(
                        &mut pixels,
                        panel.logical_w,
                        panel.logical_h,
                        Instant::now(),
                    );
                    app_page_transition = Some(next);
                    if host_owned_request {
                        // The cached compositor owns the rest of this motion;
                        // do not leave the guest's expensive hot loop running
                        // while the transition is being presented.
                        shared.set_hot(false);
                    }
                } else {
                    // The input only changed the highlighted row (or hit an
                    // edge). Show that target immediately; keeping the old
                    // transition alive would make the highlight lag again.
                    if in_app {
                        app_pixels.copy_from_slice(&pixels);
                    }
                    done = true;
                    settle = 2;
                    transition_elapsed_ms = Some(transition.elapsed_ms(Instant::now()));
                }
            } else {
                done = transition.paint(
                    &mut pixels,
                    panel.logical_w,
                    panel.logical_h,
                    Instant::now(),
                );
                if !done {
                    app_page_transition = Some(transition);
                } else {
                    park_scroll_layer(live.as_mut().unwrap(), &mut transition);
                    transition_elapsed_ms = Some(transition.elapsed_ms(Instant::now()));
                }
            }
            if in_app {
                if touching {
                    overlay_chrome(&mut chrome, &mut chrome_words, &mut pixels)?;
                } else {
                    overlay_cached_chrome(&mut chrome, &chrome_words, &mut pixels);
                }
            }
            panel.present(&pixels);
            if done {
                log::debug!(
                    "app transition: {} frames in {}ms",
                    transition_frames,
                    transition_elapsed_ms.unwrap_or_default(),
                );
                // `take()` above already removed the completed transition.
                // Its strip was parked before this point.
                app_page_transition = None;
                if shell_live {
                    let page = shared.shell_page() as usize;
                    if page < cache.len() {
                        cache[page] = Some(pixels.clone());
                    }
                }
                if host_owned_transition {
                    // Cached scroll/drawer requests wake the host themselves.
                    // No guest frame is needed after their target is visible.
                    shared.set_hot(false);
                    settle = 0;
                } else {
                    settle = 2;
                }
            }
        } else if let Some(next) = step_enter(&mut enter, &empty, &mut pixels) {
            panel.present(&pixels);
            if matches!(next, EnterStep::Done) {
                settle = 2;
                if live.as_ref().unwrap().id != "shell" {
                    // Start the cue's full lifetime after the App is visible;
                    // cold boot and the loading plate may take longer.
                    shared.show_home_pill_for(Duration::from_millis(1500));
                    // The fade target already contains chrome. Cache only
                    // the guest underneath it, or hiding an idle overlay
                    // would restore its old pixels from this cache.
                    let stream = live.as_ref().unwrap().id == "stream";
                    if stream {
                        shared.video.blit(
                            &mut app_pixels,
                            panel.logical_w as u32,
                            panel.logical_h as u32,
                        );
                    }
                    live.as_mut().unwrap().surface.with_ui(|ui| {
                        if stream {
                            raster::render_scaled_rgb565_over(ui, &last_words, &mut app_pixels, 1);
                        } else {
                            raster::render_scaled_rgb565(ui, &last_words, &mut app_pixels, 1);
                        }
                    });
                    pixels.copy_from_slice(&app_pixels);
                    overlay_chrome(&mut chrome, &mut chrome_words, &mut pixels)?;
                    panel.present(&pixels);
                } else {
                    // The next App paints its own target before using this
                    // buffer. A fresh zero mapping keeps no old App pages
                    // resident while the Shell is foregrounded.
                    app_pixels = vec![0u16; panel.face_len()];
                }
            }
        } else {
            // Claim the pager before any shell paint. A cache refresh in
            // this same frame would otherwise release the row as a tap.
            let pager_ok = live.as_ref().unwrap().id == "shell" && shared.pager();
            let slide = if pager_ok {
                let claimed_before = pager_motion_claimed(motion);
                let (next, slide) =
                    step_pager(motion, touching, lx, ly, &shared, panel.logical_w as i32);
                if !claimed_before && pager_motion_claimed(next) {
                    note_pager_claim(&mut live.as_mut().unwrap().pager_cancel, &touches);
                }
                motion = next;
                slide
            } else {
                if pager_motion_claimed(motion) {
                    note_pager_claim(&mut live.as_mut().unwrap().pager_cancel, &touches);
                }
                motion = PagerMotion::Idle;
                last_slide = i32::MIN;
                None
            };
            if live.as_ref().unwrap().id == "shell" && shared.take_pages_stale() {
                // The guest applies appView on one frame and draws it on the
                // next. Cache only the second paint, or a list/icon change
                // made while Settings is open stays on the old app page.
                framed = true;
                repaint_shell_pages(
                    live.as_mut().unwrap(),
                    &shared,
                    &mut last_words,
                    &mut pixels,
                    &mut cache,
                )?;
                let page = shared.shell_page() as usize;
                pixels.copy_from_slice(page_pixels(&cache, page, &empty));
                panel.present(&pixels);
            }

            if let Some(slide) = slide {
                if cache[0].is_none() || cache[1].is_none() {
                    ensure_shell_pages(
                        live.as_mut().unwrap(),
                        &shared,
                        &mut last_words,
                        &mut pixels,
                        &mut cache,
                    )?;
                }
                if slide != last_slide {
                    blit_slide(
                        &mut pixels,
                        page_pixels(&cache, 0, &empty),
                        page_pixels(&cache, 1, &empty),
                        slide,
                        panel.logical_w,
                        panel.logical_h,
                    );
                    panel.present(&pixels);
                    last_slide = slide;
                }
                if matches!(motion, PagerMotion::Idle) {
                    settle = 2;
                }
            } else {
                let minute_changed = hm != last_hm;
                let second_changed = ss != last_second
                    && live.as_ref().unwrap().id == "shell"
                    && shared.shell_page() == 0;
                let hot = touching
                    || guest_frame_due
                    || released
                    || linger
                    || shared.hot()
                    || settle > 0
                    || minute_changed
                    || second_changed
                    || chrome_dirty
                    || hint_on
                    || stream_view
                    || media_view
                    || stick_view;
                if !stream_view {
                    last_stream_seq = u32::MAX;
                }
                if stream_view {
                    let seq = if carplay { shared.carplay.frame_seq() } else { shared.video.frame_seq() };
                    let need = seq != last_stream_seq
                        || guest_frame_due
                        || touching
                        || linger
                        || chrome_dirty
                        || hint_on
                        || settle > 0;
                    if need {
                        framed = true;
                        overlay_stream(
                            live.as_mut().unwrap(),
                            &mut chrome,
                            &mut chrome_words,
                            &guest_touches,
                            &mut last_words,
                            &shared,
                            &mut pixels,
                        )?;
                        panel.present(&pixels);
                        last_stream_seq = seq;
                    }
                    last_hm = hm;
                    last_second = ss;
                    settle = settle.saturating_sub(1);
                } else if stick_view {
                    framed = true;
                    paint_guest(
                        live.as_mut().unwrap(),
                        &guest_touches,
                        &mut last_words,
                        &mut pixels,
                        false,
                    )?;
                    app_pixels.copy_from_slice(&pixels);
                    overlay_chrome(&mut chrome, &mut chrome_words, &mut pixels)?;
                    panel.present(&pixels);
                    last_hm = hm;
                    last_second = ss;
                    settle = settle.saturating_sub(1);
                } else if hot {
                    framed = true;
                    // Count target-frame JS/layout/raster time inside the
                    // transition budget instead of adding it before motion.
                    let target_started = Instant::now();
                    let painted = if live.as_ref().unwrap().id == "shell" {
                        paint_shell_guest(
                            live.as_mut().unwrap(),
                            &guest_touches,
                            &mut last_words,
                            &mut pixels,
                            &shared,
                            true,
                        )?
                    } else {
                        paint_guest(
                            live.as_mut().unwrap(),
                            &guest_touches,
                            &mut last_words,
                            &mut pixels,
                            true,
                        )?
                    };
                    let transition_request =
                        take_app_transition_request(&shared, in_app, shell_live);
                    if let Some(request) = transition_request {
                        if !shared.has_launch() {
                            let transition_started =
                                app_transition_started(&request, target_started);
                            // The preceding guest paint already contains the
                            // settled target for this input. Rendering a
                            // second non-presented frame here doubled the
                            // expensive JS/raster pass before the first scroll
                            // frame could reach the panel.
                            let previous = if shell_live {
                                page_pixels(&cache, shared.shell_page() as usize, &empty).to_vec()
                            } else {
                                app_pixels.clone()
                            };
                            let target = pixels.clone();
                            if shell_live {
                                let page = shared.shell_page() as usize;
                                if page < cache.len() {
                                    cache[page] = Some(target.clone());
                                }
                            } else {
                                app_pixels.copy_from_slice(&target);
                            }
                            app_page_transition = Some(make_app_transition(
                                request,
                                previous,
                                target,
                                panel.logical_w,
                                panel.logical_h,
                                transition_started,
                                live.as_mut().unwrap().scroll_layer.take(),
                                None,
                            ));
                            let host_owned_request = app_page_transition
                                .as_ref()
                                .is_some_and(PageTransition::is_host_owned);
                            if let Some(transition) = app_page_transition.as_mut() {
                                transition.paint(
                                    &mut pixels,
                                    panel.logical_w,
                                    panel.logical_h,
                                    Instant::now(),
                                );
                            }
                            if host_owned_request {
                                // The host will keep ticking while cached
                                // scroll/drawer motion is active.
                                shared.set_hot(false);
                            }
                            if in_app {
                                overlay_cached_chrome(&mut chrome, &chrome_words, &mut pixels);
                            }
                            panel.present(&pixels);
                        }
                    } else if painted && !shared.has_launch() {
                        if live.as_ref().unwrap().id == "shell" {
                            let page = shared.shell_page() as usize;
                            cache[page] = Some(pixels.clone());
                        }
                        if in_app {
                            app_pixels.copy_from_slice(&pixels);
                            overlay_chrome(&mut chrome, &mut chrome_words, &mut pixels)?;
                        }
                        panel.present(&pixels);
                    } else if in_app && (chrome_dirty || shared.hot() || hint_on) {
                        pixels.copy_from_slice(&app_pixels);
                        overlay_chrome(&mut chrome, &mut chrome_words, &mut pixels)?;
                        panel.present(&pixels);
                    }
                    last_hm = hm;
                    last_second = ss;
                    settle = settle.saturating_sub(1);
                }
                last_slide = i32::MIN;
            }
        }

        if !framed {
            shared.unlatch_knob();
        } else if in_app && live.as_ref().unwrap().id != "settings" && shared.latched_hold() {
            shared.set_launch("shell");
        }
        // Give hierarchical apps one guest frame to consume Back. Leaf apps
        // without a back handler still need a working right-swipe exit.
        if framed && in_app && shared.take_back() {
            shared.set_launch("shell");
        }
        if enter.is_none() {
            if go_shell {
                shared.set_launch("shell");
            }
            if let Some(next_id) = shared.take_launch() {
                let next_id = shared.app_lock.route(&next_id);
                let next_id = if next_id == "launcher" {
                    shared.set_shell_page(1);
                    "shell".to_string()
                } else {
                    if next_id == "shell" { shared.set_shell_page(0); }
                    next_id
                };
                shared.clear_knob();
                shared.video.set_wanted(next_id == "stream");
                shared.carplay.set_wanted(next_id == "carplay/main");
                shared.stick.set_wanted(next_id == "stick");
                if next_id != live.as_ref().unwrap().id {
                    shared.frame_timer.clear();
                    let outgoing_frame = pixels.clone();
                    log::info!("switch {} -> {next_id}", live.as_ref().unwrap().id);
                    motion = PagerMotion::Idle;
                    if let Some(mut transition) = app_page_transition.take() {
                        park_scroll_layer(live.as_mut().unwrap(), &mut transition);
                    }
                    retain_scroll_layer(live.as_mut().unwrap());
                    last_slide = i32::MIN;
                    app_home = touch_navigation::Navigation::default();
                    shared.set_hint("");
                    shared.set_hot(false);
                    shared.bump_chrome_wake();
                    let _ = shared.take_back();
                    let outgoing = Parked {
                        session: live.take().unwrap(),
                        words: std::mem::take(&mut last_words),
                        cache: std::mem::replace(&mut cache, [None, None]),
                    };
                    let from_id = outgoing.session.id.clone();
                    let mut plate = vec![0u16; panel.face_len()];
                    let icon = LoadIcon::load(&next_id);
                    draw_load_plate(&mut plate, icon.as_ref(), panel.logical_w, panel.logical_h);
                    present_crossfade(
                        &mut panel,
                        &mut pixels,
                        &outgoing_frame,
                        &plate,
                        LOAD_PLATE_FADE,
                    );
                    if let Some(warm) = park_take(&next_id, &mut parked_shell) {
                        park_put(outgoing, &mut parked_shell);
                        live = Some(warm.session);
                        last_words = warm.words;
                        cache = warm.cache;
                        let t0 = Instant::now();
                        if let Err(err) = restore_parked(
                            live.as_mut().unwrap(),
                            &shared,
                            &mut last_words,
                            &mut pixels,
                            &mut cache,
                            &mut app_pixels,
                        ) {
                            log::error!("resume {next_id}: {err:#}");
                        } else {
                            if next_id == "stream" || next_id == "carplay/main" {
                                overlay_stream(
                                    live.as_mut().unwrap(),
                                    &mut chrome,
                                    &mut chrome_words,
                                    &[],
                                    &mut last_words,
                                    &shared,
                                    &mut pixels,
                                )?;
                            } else if next_id != "shell" {
                                overlay_chrome(&mut chrome, &mut chrome_words, &mut pixels)?;
                            }
                            log::info!("resume {next_id} in {}ms", t0.elapsed().as_millis());
                            enter = Some(EnterFade::Cross {
                                from: plate.clone(),
                                to: pixels.clone(),
                                t0: Instant::now(),
                            });
                        }
                    } else {
                        park_put(outgoing, &mut parked_shell);
                        match boot_app_with_spinner(
                            panel,
                            &plate,
                            &next_id,
                            &shared,
                            &mut last_words,
                            &mut pixels,
                        ) {
                            Ok((p, next, spinner)) => {
                                panel = p;
                                live = Some(next);
                                if next_id == "shell" {
                                    cache = [None, None];
                                    cache[shared.shell_page() as usize] = Some(pixels.clone());
                                } else {
                                    if next_id == "stream" || next_id == "carplay/main" {
                                        overlay_stream(
                                            live.as_mut().unwrap(),
                                            &mut chrome,
                                            &mut chrome_words,
                                            &[],
                                            &mut last_words,
                                            &shared,
                                            &mut pixels,
                                        )?;
                                    } else {
                                        overlay_chrome(
                                            &mut chrome,
                                            &mut chrome_words,
                                            &mut pixels,
                                        )?;
                                    }
                                }
                                enter = Some(EnterFade::Cross {
                                    from: spinner,
                                    to: pixels.clone(),
                                    t0: Instant::now(),
                                });
                            }
                            Err((p, err)) => {
                                panel = p;
                                log::error!("boot {next_id}: {err:#}");
                                apps::record_failure(&next_id, &format!("{err:#}"));
                                shared.set_hint("App error");
                                if let Some(warm) =
                                    park_take("shell", &mut parked_shell)
                                {
                                    live = Some(warm.session);
                                    last_words = warm.words;
                                    cache = warm.cache;
                                    let _ = restore_parked(
                                        live.as_mut().unwrap(),
                                        &shared,
                                        &mut last_words,
                                        &mut pixels,
                                        &mut cache,
                                        &mut app_pixels,
                                    );
                                    panel.present(&pixels);
                                } else if from_id != "shell" {
                                    match boot_app_with_spinner(
                                        panel,
                                        &plate,
                                        "shell",
                                        &shared,
                                        &mut last_words,
                                        &mut pixels,
                                    ) {
                                        Ok((p, next, spinner)) => {
                                            panel = p;
                                            live = Some(next);
                                            cache[0] = Some(pixels.clone());
                                            cache[1] = None;
                                            enter = Some(EnterFade::Cross {
                                                from: spinner,
                                                to: pixels.clone(),
                                                t0: Instant::now(),
                                            });
                                        }
                                        Err((p, shell_err)) => {
                                            panel = p;
                                            log::error!("boot shell: {shell_err:#}");
                                            if let Some(warm) = park_take(
                                                &from_id,
                                                &mut parked_shell,
                                            ) {
                                                live = Some(warm.session);
                                                last_words = warm.words;
                                                cache = warm.cache;
                                            } else {
                                                live = Some(boot_session("shell", &shared)?);
                                            }
                                        }
                                    }
                                } else if let Some(warm) =
                                    park_take(&from_id, &mut parked_shell)
                                {
                                    live = Some(warm.session);
                                    last_words = warm.words;
                                    cache = warm.cache;
                                } else {
                                    live = Some(boot_session("shell", &shared)?);
                                }
                            }
                        }
                    }
                }
            }
        }
        if let Some(session) = live.as_mut() {
            retain_scroll_layer(session);
        }
        let bri = shared.brightness();
        if bri != last_brightness {
            last_brightness = bri;
            apply_brightness(bri);
        }
        let now = Instant::now();
        if now < deadline {
            if deadline.duration_since(last) <= Duration::from_millis(TICK_MS) {
                std::thread::sleep(deadline - now);
            } else {
                shared.wake.wait(wake_generation, Some(deadline - now));
            }
        }
        last = Instant::now();
    }
}

// Only the home shell is retained; foreground Apps are created on demand.
fn park_put(mut parked: Parked, shell: &mut Option<Parked>) {
    if let Some(views) = parked.session.views.as_mut() { views.pause(); }
    if parked.session.id == "shell" { *shell = Some(parked); }
}

fn park_take(id: &str, shell: &mut Option<Parked>) -> Option<Parked> {
    if id == "shell" { shell.take() } else { None }
}

fn restore_parked(
    session: &mut Session,
    shared: &Shared,
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
    cache: &mut [Option<Vec<u16>>; 2],
    app_pixels: &mut [u16],
) -> Result<()> {
    if session.id == "shell" {
        let stale = shared.take_pages_stale();
        let page = shared.shell_page() as usize;
        shared.set_pager(true);
        shared.set_hot(false);
        if stale {
            repaint_shell_pages(session, shared, last_words, pixels, cache)?;
            if let Some(selected) = cache[page].clone() {
                pixels.copy_from_slice(&selected);
            }
        } else {
            cache[1] = None;
            if let Some(selected) = cache[page].clone() {
                pixels.copy_from_slice(&selected);
            } else {
                paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
                cache[page] = Some(pixels.to_vec());
            }
        }
    } else if session.id == "stream" || session.id == "carplay/main" {
        shared.set_pager(false);
        blit_foreground(shared, &session.id, pixels);
        paint_guest_over(session, &[], last_words, pixels)?;
        app_pixels.copy_from_slice(pixels);
    } else {
        shared.set_pager(false);
        paint_guest(session, &[], last_words, pixels, false)?;
        app_pixels.copy_from_slice(pixels);
    }
    Ok(())
}

fn boot_app_with_spinner(
    panel: Panel,
    plate: &[u16],
    id: &str,
    shared: &Arc<Shared>,
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
) -> std::result::Result<(Panel, Session, Vec<u16>), (Panel, anyhow::Error)> {
    let stop = AtomicBool::new(false);
    let last_spin = Mutex::new(plate.to_vec());
    let panel_mu = Mutex::new(panel);
    let boot = std::thread::scope(|s| {
        s.spawn(|| {
            let mut ang = 0i32;
            let lw = panel_mu.lock().unwrap().logical_w;
            let lh = panel_mu.lock().unwrap().logical_h;
            let mut frame = vec![0u16; lw.saturating_mul(lh).max(1)];
            while !stop.load(Ordering::Relaxed) {
                frame.copy_from_slice(plate);
                draw_host_spinner(&mut frame, ang, lw, lh);
                panel_mu.lock().unwrap().present(&frame);
                last_spin.lock().unwrap().clone_from(&frame);
                ang = (ang + 10) % 360;
                std::thread::sleep(Duration::from_millis(TICK_MS));
            }
        });
        let res = (|| -> Result<Session> {
            let mut sess = boot_session(id, shared)?;
            last_words.clear();
            if id == "shell" {
                paint_shell_guest(&mut sess, &[], last_words, pixels, shared, false)?;
            } else {
                paint_guest(&mut sess, &[], last_words, pixels, false)?;
            }
            Ok(sess)
        })();
        stop.store(true, Ordering::Relaxed);
        res
    });
    let panel = panel_mu.into_inner().unwrap();
    let spinner = last_spin.into_inner().unwrap();
    match boot {
        Ok(sess) => Ok((panel, sess, spinner)),
        Err(err) => Err((panel, err)),
    }
}

fn overlay_stream(
    session: &mut Session,
    chrome: &mut AppChrome,
    chrome_words: &mut Vec<u32>,
    touches: &[u32],
    last_words: &mut Vec<u32>,
    shared: &Shared,
    pixels: &mut [u16],
) -> Result<()> {
    blit_foreground(shared, &session.id, pixels);
    paint_guest_over(session, touches, last_words, pixels)?;
    overlay_chrome(chrome, chrome_words, pixels)?;
    Ok(())
}

fn blit_foreground(shared: &Shared, id: &str, pixels: &mut [u16]) {
    let width = shared.screen_w() as u32;
    let height = shared.screen_h() as u32;
    if id == "carplay/main" {
        shared.carplay.blit(pixels, width, height);
    } else {
        shared.video.blit(pixels, width, height);
    }
}

fn overlay_chrome(chrome: &mut AppChrome, words: &mut Vec<u32>, dest: &mut [u16]) -> Result<()> {
    chrome.frame();
    chrome.with_ui(|ui| {
        let dl = ui.draw();
        words.clone_from(&dl.words);
        raster::render_scaled_rgb565_over(ui, words, dest, 1);
    });
    Ok(())
}

fn overlay_cached_chrome(chrome: &mut AppChrome, words: &[u32], dest: &mut [u16]) {
    chrome.with_ui(|ui| {
        raster::render_scaled_rgb565_over(ui, words, dest, 1);
    });
}

fn recover_app_fault(session: &Session, error: &anyhow::Error) {
    log::error!("App {} failed: {error:#}", session.id);
    session.rpc.close();
    apps::record_failure(&session.id, &format!("{error:#}"));
    session.shared.set_launch("shell");
    session.shared.set_hint("App error");
    session.shared.set_hot(true);
}

fn paint_guest(
    session: &mut Session,
    touches: &[u32],
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
    skip_same: bool,
) -> Result<bool> {
    refresh_launcher_icons(session)?;
    session.guest.arm(Duration::from_millis(250));
    session.debug_touches.clear();
    session.debug_touches.extend_from_slice(touches);
    if let Err(error) = session.guest.frame_with_touches(0, ANALOG_CENTER, touches) {
        if matches!(session.id.as_str(), "shell" | "init" | "chrome") { return Err(error); }
        recover_app_fault(session, &error);
        return Ok(false);
    }
    session.surface.tick();
    capture_scroll_layer(session);
    let mut dirty = false;
    session.surface.with_ui(|ui| {
        let dl = ui.draw();
        if skip_same && dl.words == *last_words && session.scroll_layer.is_none() {
            return;
        }
        last_words.clone_from(&dl.words);
        if let Some(layer) = &session.scroll_layer {
            layer.paint_target(ui, last_words, pixels);
        } else {
            raster::render_scaled_rgb565(ui, last_words, pixels, 1);
        }
        dirty = true;
    });
    Ok(dirty)
}

fn paint_shell_guest(
    session: &mut Session,
    touches: &[u32],
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
    shared: &Shared,
    skip_same: bool,
) -> Result<bool> {
    refresh_launcher_icons(session)?;
    let started = Instant::now();
    let delivered = shell_touches_after_pager_claim(touches, &mut session.pager_cancel);
    let home = shared.shell_render_page() == 0;
    if let Some(views) = session.views.as_mut() {
        views.prepare(&session.shared, home, shared.get_key("shellCapturePage") == "-1", &delivered);
    }
    session
        .guest
        .frame_with_touches(0, ANALOG_CENTER, &delivered)?;
    let page = shared.shell_render_page();
    if session.rendered_shell_page != Some(page) || session.shell_collected.elapsed() >= Duration::from_secs(1) {
        // Native page snapshots keep transitions smooth after the old page's
        // Vue scope is disposed. Reclaim its cycles at this ownership boundary.
        session.guest.collect();
        session.rendered_shell_page = Some(page);
        session.shell_collected = Instant::now();
    }
    session.surface.release_unused_images();
    let guest_done = Instant::now();
    session.surface.tick();
    capture_scroll_layer(session);
    let layout_done = Instant::now();
    let mut dirty = false;
    session.surface.with_ui(|ui| {
        let dl = ui.draw();
        let home = shared.shell_render_page() == 0;
        let dynamic_underlay = home && (shared.has_background_image() || shared.has_media_widgets()
            || session.views.as_ref().is_some_and(|views| views.has_views()));
        if skip_same
            && dl.words == *last_words
            && !dynamic_underlay
            && session.scroll_layer.is_none()
        {
            return;
        }
        last_words.clone_from(&dl.words);
        if let Some(layer) = &session.scroll_layer {
            layer.paint_target(ui, last_words, pixels);
        } else if home && !dynamic_underlay {
            session.home_frame.render(ui, last_words, pixels, shared.home_background_rgb565());
        } else if home {
            pixels.fill(shared.home_background_rgb565());
            shared.paint_background(
                pixels,
                shared.screen_w() as usize,
                shared.screen_h() as usize,
            );
            shared.paint_home_scene(ui, last_words, pixels, |surface, target| {
                session.views.as_mut().is_some_and(|views| views.paint(surface, target, shared.screen_w() as usize, shared.screen_h() as usize))
            });
        } else {
            raster::render_scaled_rgb565(ui, last_words, pixels, 1);
        }
        dirty = true;
    });
    if let Some(views) = session.views.as_ref() { views.schedule(&session.shared); }
    log::debug!(target: "onekvm_screen_display::profile",
        "shell frame guest_us={} layout_us={} raster_us={} dirty={}",
        guest_done.duration_since(started).as_micros(),
        layout_done.duration_since(guest_done).as_micros(),
        layout_done.elapsed().as_micros(), dirty);
    Ok(dirty)
}

fn park_scroll_layer(session: &mut Session, transition: &mut PageTransition) {
    if let Some(layer) = transition.take_scroll_layer() {
        session.list_cache = Some(layer);
    }
}

fn retain_scroll_layer(session: &mut Session) {
    if let Some(layer) = session.scroll_layer.take() {
        session.list_cache = Some(layer);
    }
}

fn capture_scroll_layer(session: &mut Session) {
    if !session.capture_scroll {
        retain_scroll_layer(session);
        return;
    }
    let Some((request, viewport)) = session.shared.pending_scroll_capture() else {
        // A disposed page's strip cannot be reused by a new generation of nodes.
        retain_scroll_layer(session);
        if session.list_cache.as_ref().is_some_and(|layer| {
            session.surface.with_ui(|ui| ui.layout_of(layer.node).is_none())
        }) {
            session.list_cache = None;
        }
        return;
    };
    // A capture left on the session is newer than the parked strip.
    let previous = session
        .scroll_layer
        .take()
        .or_else(|| session.list_cache.take());
    session.scroll_layer = session
        .surface
        .with_ui(|ui| scroll_layer::capture(ui, request, viewport, previous));
}

fn paint_guest_over(
    session: &mut Session,
    touches: &[u32],
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
) -> Result<()> {
    session.guest.arm(Duration::from_millis(250));
    session.debug_touches.clear();
    session.debug_touches.extend_from_slice(touches);
    if let Err(error) = session.guest.frame_with_touches(0, ANALOG_CENTER, touches) {
        recover_app_fault(session, &error);
        return Ok(());
    }
    session.surface.tick();
    session.surface.with_ui(|ui| {
        let dl = ui.draw();
        last_words.clone_from(&dl.words);
        raster::render_scaled_rgb565_over(ui, last_words, pixels, 1);
    });
    Ok(())
}

fn capture_shell_page(
    session: &mut Session,
    shared: &Shared,
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
    cache: &mut [Option<Vec<u16>>; 2],
    page: u8,
) -> Result<()> {
    shared.set_shell_capture_page(Some(page));
    let result = (|| -> Result<()> {
        paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
        paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
        Ok(())
    })();
    // Clear even on guest failure; a capture must never change navigation.
    shared.set_shell_capture_page(None);
    result?;
    cache[page as usize] = Some(pixels.to_vec());
    Ok(())
}

fn repaint_shell_pages(
    session: &mut Session,
    shared: &Shared,
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
    cache: &mut [Option<Vec<u16>>; 2],
) -> Result<()> {
    cache[0] = None;
    cache[1] = None;
    let cur = shared.shell_page();
    paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
    paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
    for page in [0u8, 1] {
        capture_shell_page(session, shared, last_words, pixels, cache, page)?;
    }
    paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
    paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
    if (cur as usize) < cache.len() {
        cache[cur as usize] = Some(pixels.to_vec());
    }
    Ok(())
}

fn ensure_shell_pages(
    session: &mut Session,
    shared: &Shared,
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
    cache: &mut [Option<Vec<u16>>; 2],
) -> Result<()> {
    let mut captured = false;
    for page in [0u8, 1] {
        if cache[page as usize].is_none() {
            capture_shell_page(session, shared, last_words, pixels, cache, page)?;
            captured = true;
        }
    }
    if captured {
        paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
        paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
    }
    Ok(())
}

fn warmup_shell(
    session: &mut Session,
    shared: &Shared,
    last_words: &mut Vec<u32>,
    pixels: &mut [u16],
    cache: &mut [Option<Vec<u16>>; 2],
) -> Result<()> {
    cache[0] = None;
    cache[1] = None;
    capture_shell_page(session, shared, last_words, pixels, cache, 0)?;
    capture_shell_page(session, shared, last_words, pixels, cache, 1)?;
    shared.set_shell_page(0);
    paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
    paint_shell_guest(session, &[], last_words, pixels, shared, false)?;
    cache[0] = Some(pixels.to_vec());
    Ok(())
}

fn page_pixels<'a>(cache: &'a [Option<Vec<u16>>; 2], i: usize, empty: &'a [u16]) -> &'a [u16] {
    cache[i].as_deref().unwrap_or(empty)
}

enum EnterStep {
    Frame,
    Done,
}

fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t) * (1.0 - t)
}

fn wall_hms() -> (i32, i32, i32) {
    let mut t: libc::time_t = 0;
    unsafe {
        libc::time(&mut t);
        let tm = libc::localtime(&t);
        if tm.is_null() {
            return (0, 0, 0);
        }
        ((*tm).tm_hour, (*tm).tm_min, (*tm).tm_sec)
    }
}

fn present_home(
    panel: &mut Panel,
    cache: &[Option<Vec<u16>>; 2],
    empty: &[u16],
    pixels: &mut [u16],
) {
    pixels.copy_from_slice(page_pixels(cache, 0, empty));
    panel.present(pixels);
}

fn blend_rgb565(out: &mut [u16], a: &[u16], b: &[u16], t: f32) {
    let w = (t.clamp(0.0, 1.0) * 256.0) as u32;
    let iw = 256 - w;
    for i in 0..out.len() {
        let pa = a[i] as u32;
        let pb = b[i] as u32;
        let r = ((((pa >> 11) & 31) * iw) + (((pb >> 11) & 31) * w)) >> 8;
        let g = ((((pa >> 5) & 63) * iw) + (((pb >> 5) & 63) * w)) >> 8;
        let bl = (((pa & 31) * iw) + ((pb & 31) * w)) >> 8;
        out[i] = ((r << 11) | (g << 5) | bl) as u16;
    }
}

fn present_crossfade(panel: &mut Panel, out: &mut [u16], from: &[u16], to: &[u16], duration: f32) {
    let started = Instant::now();
    loop {
        let t = started.elapsed().as_secs_f32() / duration.max(0.001);
        blend_rgb565(out, from, to, ease_out(t));
        panel.present(out);
        if t >= 1.0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(TICK_MS));
    }
}

fn step_enter(
    enter: &mut Option<EnterFade>,
    _black: &[u16],
    pixels: &mut [u16],
) -> Option<EnterStep> {
    let cur = enter.take()?;
    match cur {
        EnterFade::Cross { from, to, t0 } => {
            let t = t0.elapsed().as_secs_f32() / ENTER_FADE;
            if t >= 1.0 {
                pixels.copy_from_slice(&to);
                Some(EnterStep::Done)
            } else {
                blend_rgb565(pixels, &from, &to, ease_out(t));
                *enter = Some(EnterFade::Cross { from, to, t0 });
                Some(EnterStep::Frame)
            }
        }
    }
}

fn snap_target(slide0: i32, dx: i32, vx: f32, face: i32) -> i32 {
    let mut to = if slide0 < face / 2 { 0 } else { face };
    if dx < -PAN_COMMIT || vx < -FLICK_VX {
        to = face;
    }
    if dx > PAN_COMMIT || vx > FLICK_VX {
        to = 0;
    }
    to
}

/// PocketJS touch word bit 30. The contact is removed without a tap.
const TOUCH_CANCEL: u32 = 0x4000_0000;

fn touch_word_id(word: u32) -> u32 {
    let shift = if word & 0x8000_0000 != 0 { 20 } else { 18 };
    (word >> shift) & 0xff
}

fn cancel_touch_words(words: &[u32]) -> Vec<u32> {
    words
        .iter()
        .filter(|word| *word & TOUCH_CANCEL == 0)
        .map(|word| word | TOUCH_CANCEL)
        .collect()
}

fn pager_motion_claimed(motion: PagerMotion) -> bool {
    matches!(motion, PagerMotion::Drag { .. } | PagerMotion::Snap { .. })
}

/// Remember the contacts the host just took. A later empty sample must not
/// replace this; the finger has often already lifted by the next guest frame.
fn note_pager_claim(pending: &mut Option<Vec<u32>>, touches: &[u32]) {
    let words = cancel_touch_words(touches);
    if !words.is_empty() {
        *pending = Some(words);
    }
}

/// One shell frame carries the cancellation and omits those ids from the
/// active set. The same id in both lists would end the track and begin again.
fn shell_touches_after_pager_claim<'a>(
    live: &'a [u32],
    pending: &mut Option<Vec<u32>>,
) -> std::borrow::Cow<'a, [u32]> {
    let Some(cancel) = pending.take() else {
        return std::borrow::Cow::Borrowed(live);
    };
    if cancel.is_empty() {
        return std::borrow::Cow::Borrowed(live);
    }
    let mut out = cancel;
    for word in live {
        if word & TOUCH_CANCEL != 0 {
            out.push(*word);
            continue;
        }
        let id = touch_word_id(*word);
        if out.iter().any(|cancelled| touch_word_id(*cancelled) == id) {
            continue;
        }
        out.push(*word);
    }
    std::borrow::Cow::Owned(out)
}

fn step_pager(
    motion: PagerMotion,
    touching: bool,
    lx: i32,
    ly: i32,
    shared: &Shared,
    face: i32,
) -> (PagerMotion, Option<i32>) {
    let now = Instant::now();
    match motion {
        PagerMotion::Idle => {
            if touching {
                (PagerMotion::Armed { x0: lx, y0: ly }, None)
            } else {
                (PagerMotion::Idle, None)
            }
        }
        PagerMotion::Armed { x0, y0 } => {
            if !touching {
                return (PagerMotion::Idle, None);
            }
            let dx = lx - x0;
            let dy = ly - y0;
            if dx.abs() >= PAGER_SLOP && dx.abs() >= dy.abs() {
                if dx < 0 && shared.shell_page() == 0 && !shared.app_lock.authorized() {
                    shared.request_shell_page(1);
                    // Do not expose even a partial cached launcher before PIN.
                    return (PagerMotion::GuestLock, None);
                }
                let slide0 = i32::from(shared.shell_page()) * face;
                let slide = (slide0 - dx).clamp(0, face);
                (
                    PagerMotion::Drag {
                        x0,
                        slide0,
                        last_x: lx,
                        last_t: now,
                    },
                    Some(slide),
                )
            } else if dy.abs() >= PAGER_SLOP && dy.abs() > dx.abs() {
                (PagerMotion::GuestLock, None)
            } else {
                (PagerMotion::Armed { x0, y0 }, None)
            }
        }
        PagerMotion::GuestLock => {
            if touching {
                (PagerMotion::GuestLock, None)
            } else {
                (PagerMotion::Idle, None)
            }
        }
        PagerMotion::Drag {
            x0,
            slide0,
            last_x,
            last_t,
        } => {
            let dt = last_t.elapsed().as_secs_f32().max(1.0 / 240.0);
            let vx = (lx - last_x) as f32 / dt;
            let slide = (slide0 - (lx - x0)).clamp(0, face);
            if touching {
                (
                    PagerMotion::Drag {
                        x0,
                        slide0,
                        last_x: lx,
                        last_t: now,
                    },
                    Some(slide),
                )
            } else {
                let to = snap_target(slide0, lx - x0, vx, face);
                (
                    PagerMotion::Snap {
                        from: slide,
                        to,
                        t0: now,
                    },
                    Some(slide),
                )
            }
        }
        PagerMotion::Snap { from, to, t0 } => {
            let t = t0.elapsed().as_secs_f32() / SNAP_MS;
            if t >= 1.0 {
                if !shared.request_shell_page(if to >= face / 2 { 1 } else { 0 }) {
                    return (PagerMotion::Idle, Some(0));
                }
                (PagerMotion::Idle, Some(to))
            } else {
                let e = 1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(2);
                let slide = from + ((to - from) as f32 * e).round() as i32;
                (PagerMotion::Snap { from, to, t0 }, Some(slide))
            }
        }
    }
}

fn step_app_home(
    home: &mut touch_navigation::Navigation,
    in_app: bool,
    touching: bool,
    lx: i32,
    ly: i32,
    touches: &[u32],
    shared: &Shared,
    last_hint_on: bool,
    hint_on: bool,
) -> (Vec<u32>, bool, bool) {
    if !in_app {
        *home = touch_navigation::Navigation::default();
        return (touches.to_vec(), false, false);
    }
    let (captured, action) = home.step(touching.then_some((lx, ly)), shared.screen_h() as i32);
    if action == Some(touch_navigation::Action::Back) {
        shared.request_back();
    }
    let go_home = action == Some(touch_navigation::Action::Home)
        && home.confirm_home(Instant::now());
    if action == Some(touch_navigation::Action::Home) {
        if go_home {
            shared.set_hint("");
        } else {
            shared.show_home_pill_for(touch_navigation::HOME_CONFIRM_WINDOW);
            shared.set_hint_for(
                crate::locale::home_hint(&shared.language()),
                touch_navigation::HOME_CONFIRM_WINDOW,
            );
        }
    }
    (
        if captured {
            // Explicit terminal cancellation prevents an edge swipe from
            // pressing the row beneath the original down contact.
            cancel_touch_words(touches)
        } else {
            touches.to_vec()
        },
        last_hint_on != hint_on || action == Some(touch_navigation::Action::Home),
        go_home,
    )
}

fn mount_onekvm(guest: &Guest, shared: Arc<Shared>, id: &str, rpc: Arc<app_rpc::Session>, fonts: Option<dynamic_fonts::NetworkFonts>, view: Option<Arc<screen_views::Bridge>>) -> Result<()> {
    let system_controls = id == "settings";
    let contributed = id.contains('/');
    let local_recovery = crate::mode::local_recovery_guest(id, crate::mode::is_init());
    let power = id == "power";
    let qr_code = Arc::new(Mutex::new(String::new()));
    let shell = id == "shell";
    guest.mount("onekvm", move |ctx, ns| {
        let get_state = shared.clone();
        let get_rpc = rpc.clone();
        let get_qr = qr_code.clone();
        let get_view = view.clone();
        let fonts = std::cell::RefCell::new(fonts);
        ns.set(
            "get",
            Function::new(ctx.clone(), move |key: String| -> String {
                if let Some(view) = &get_view {
                    if let Some(value) = view.get(&key) { return value; }
                }
                if shell && key == "surfaceHome" { return screen_views::selected_home(&get_state).unwrap_or_default(); }
                if shell && key == "surfaceWidgets" { return screen_views::widgets_json(&get_state); }
                if shell && key == "surfaceFocus" { return screen_views::focus(); }
                if contributed && key == "screenState" { return screen_views::device_state(&get_state); }
                if contributed && key == "pluginId" { return get_rpc.policy.owner.clone(); }
                if key == "appResponse" {
                    let value = get_rpc.response();
                    if let Some(fonts) = fonts.borrow_mut().as_mut() {
                        if let Ok(reply) = serde_json::from_str::<serde_json::Value>(&value) {
                            if reply["ok"] == true {
                                let key = if reply["response"].get("entries").is_some() { "mediaBrowseNames" } else { "mediaNames" };
                                fonts.update(key, &reply["response"].to_string(), get_state.catalog_gen());
                            }
                        }
                    }
                    return value;
                }
                if key == "bridgeVersion" { return "2".into(); }
                if key == "localRecoveryAvailable" { return if local_recovery { "1" } else { "0" }.into(); }
                if key == "qrCode" { return get_qr.lock().unwrap().clone(); }
                if contributed && !matches!(key.as_str(), "back" | "appResponse" | "appStateGeneration" | "screenW" | "screenH" | "controls" | "language" | "knobSeq" | "knob" | "knobClick" | "knobHold") { return String::new(); }
                if key == "back" {
                    return if get_state.take_back() {
                        "1".into()
                    } else {
                        "0".into()
                    };
                }
                // Every guest runs in this host process. Dispatch to the same
                // backend as the public D-Bus API without a synchronous
                // loopback round trip for every frame/input property.
                let value = get_state.get_key(&key);
                if let Some(fonts) = fonts.borrow_mut().as_mut() {
                    fonts.update(&key, &value, get_state.catalog_gen());
                }
                value
            }),
        )?;
        let set_state = shared.clone();
        ns.set(
            "set",
            Function::new(ctx.clone(), move |key: String, value: String| {
                if shell && key == "surfaceFocus" {
                    if screen_views::set_focus(&value) { set_state.set_hot(true); }
                    return;
                }
                if let Some(view) = &view {
                    if view.set(&key, &value, &set_state) { return; }
                }
                if key == "qrCode" {
                    *qr_code.lock().unwrap() = qr::encode(&value);
                    return;
                }
                if key == "appRequest" { rpc.submit(&value); return; }
                // Only built-in initialization and Settings may use local recovery.
                // Public D-Bus Set and contributed Apps cannot trigger it.
                if key == "diagnosticsStart" {
                    if local_recovery && (crate::mode::is_init() || set_state.app_lock.authorized()) {
                        set_state.start_diagnostics();
                    }
                    return;
                }
                if key == "adbDebugRefresh" || key == "adbDebugSet" {
                    if local_recovery && (crate::mode::is_init() || set_state.app_lock.authorized()) {
                        if key == "adbDebugRefresh" { set_state.adb_debug_action(None); }
                        else if matches!(value.as_str(), "0" | "1") {
                            set_state.adb_debug_action(Some(value == "1"));
                        }
                    }
                    return;
                }
                if key == "powerAction" && power {
                    rpc.submit(&serde_json::json!({"extension":"power","operation":"power","request":{"action":value}}).to_string());
                    return;
                }
                if contributed && (!matches!(key.as_str(), "hot" | "hint" | "back" | "launch" | "appPageTransition" | "appScrollTransition" | "appDrawerTransition") || (key == "launch" && !matches!(value.as_str(), "shell" | "launcher"))) { return; }
                if matches!(key.as_str(), "appUnlock" | "appLockConfigure") {
                    if system_controls && value.len() <= 1024 && set_state.app_lock.begin() {
                        let state = set_state.clone();
                        std::thread::spawn(move || {
                            if key == "appUnlock" {
                                if let Some(target) = state.app_lock.unlock(&value) {
                                    state.note_input();
                                    state.set_launch(&target);
                                }
                            } else { state.app_lock.configure(&value); }
                            state.app_lock.finish();
                            state.set_hot(true);
                            state.wake.notify();
                        });
                    }
                    return;
                }
                // Private to packaged Settings, not public D-Bus Set or Apps.
                if matches!(key.as_str(), "systemPrepare" | "systemHold" | "systemExecute") {
                    if system_controls && set_state.app_lock.authorized() {
                        match key.as_str() {
                            "systemPrepare" => set_state.system_actions.prepare(&value),
                            "systemHold" => set_state.system_actions.hold(value == "1"),
                            _ => {
                                let Some(action) = set_state.system_actions.confirm(&value) else { return; };
                                let state = set_state.clone();
                                std::thread::spawn(move || {
                                    state.system_actions.execute(action);
                                    state.set_hot(true);
                                    state.wake.notify();
                                });
                            }
                        }
                    }
                    return;
                }
                set_state.set_key(&key, &value);
            }),
        )?;
        Ok(())
    })
}

impl Panel {
    fn open() -> Result<Self> {
        let (width, height, _bpp) = fb_sys_geom().context("fb0 geometry")?;
        let stride = fs::read_to_string("/sys/class/graphics/fb0/stride")
            .ok()
            .and_then(|s| s.trim().parse::<usize>().ok())
            .map(|bytes| bytes / 2)
            .unwrap_or(width);
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open("/dev/fb0")
            .context("/dev/fb0")?;
        let len = fs::metadata("/dev/fb0")
            .map(|m| m.len() as usize)
            .unwrap_or(0);
        let map_len = stride.saturating_mul(height).saturating_mul(2).max(len);
        let map = unsafe { MmapOptions::new().len(map_len).map_mut(&file) }.context("mmap fb0")?;
        let remote_frame = remote::PresentedFrame::new(&map, width, height, stride.max(width));
        log::info!("fb0 {width}x{height} stride={stride}");
        Ok(Self {
            file,
            map,
            width,
            height,
            stride: stride.max(width),
            logical_w: width,
            logical_h: height,
            rotate: 0,
            remote_frame,
            vsync_ok: true,
        })
    }

    fn face_len(&self) -> usize {
        self.logical_w.saturating_mul(self.logical_h).max(1)
    }

    fn apply_rotate(&mut self, rot: u16) {
        let (lw, lh) = oriented_size(self.width, self.height, rot);
        self.rotate = rot;
        self.logical_w = lw;
        self.logical_h = lh;
        log::info!(
            "fb {}x{} logical {lw}x{lh} rotate {rot}",
            self.width,
            self.height
        );
    }

    fn square(&self) -> bool {
        self.rotate == 0
            && self.logical_w == self.width
            && self.logical_h == self.height
            && self.stride == self.width
    }

    fn blit_scratch(&mut self) -> bool {
        let changed = damage::copy_changed_rows(
            self.map.as_mut(),
            self.remote_frame.pixels(),
            self.width,
            self.height,
            self.stride,
        );
        if changed {
            self.remote_frame.changed();
        }
        changed
    }

    fn blit_words(&mut self, src: &[u16]) -> bool {
        let changed = damage::copy_changed_rows(self.map.as_mut(), src, self.width, self.height, self.stride);
        if changed {
            self.remote_frame.update(src);
        }
        changed
    }

    fn publish_remote(&mut self, remote: &crate::remote::Remote) {
        if !remote.take_snapshot_request() { return; }
        let (lw, lh) = (self.logical_w, self.logical_h);
        if let Some(pixels) = self.remote_frame.snapshot(self.width, self.height, self.rotate, lw, lh) {
            remote.publish(lw, lh, pixels);
        }
    }

    fn present(&mut self, src: &[u16]) {
        let rot = self.rotate;
        let lw = self.logical_w;
        let lh = self.logical_h;
        let changed = if self.square() {
            self.blit_words(src)
        } else {
            let (w, h) = (self.width, self.height);
            let scratch = self.remote_frame.pixels_mut();
            // Pro is 172×320 physical, 320×172 logical, rotated 270. The
            // general per-pixel match was most of the CPU before the SPI wait.
            if rot == 270 && h == lw && w == lh && lw > 0 {
                let last = lw - 1;
                for y in 0..h {
                    let src_x = last - y;
                    let row = y * w;
                    for x in 0..w {
                        scratch[row + x] = src[x * lw + src_x];
                    }
                }
            } else {
                let stride = lw.max(1);
                for y in 0..h {
                    for x in 0..w {
                        let (lx, ly) = unrotate_px(x, y, rot, lw, lh);
                        scratch[y * w + x] = if lx < lw && ly < lh {
                            src[ly * stride + lx]
                        } else {
                            0
                        };
                    }
                }
            }
            self.blit_scratch()
        };
        if changed {
            self.wait_vsync();
        }
    }

    fn present_angle(&mut self, src: &[u16], deg: f32) {
        let (w, h) = (self.width, self.height);
        let lw = self.logical_w.max(1);
        let lh = self.logical_h.max(1);
        let scratch = self.remote_frame.pixels_mut();
        let rad = deg * core::f32::consts::PI / 180.0;
        let (sin, cos) = (rad.sin(), rad.cos());
        let cx = (lw as f32 - 1.0) * 0.5;
        let cy = (lh as f32 - 1.0) * 0.5;
        let max_x = lw as i32 - 1;
        let max_y = lh as i32 - 1;
        for y in 0..h {
            for x in 0..w {
                let (vx, vy) = unrotate_px(x, y, 0, w, h);
                let dx = vx as f32 - (w.saturating_sub(1) as f32) * 0.5;
                let dy = vy as f32 - (h.saturating_sub(1) as f32) * 0.5;
                let sx = (dx * cos + dy * sin + cx).round() as i32;
                let sy = (-dx * sin + dy * cos + cy).round() as i32;
                scratch[y * w + x] = if sx < 0 || sy < 0 || sx > max_x || sy > max_y {
                    0
                } else {
                    src[sy as usize * lw + sx as usize]
                };
            }
        }
        if self.blit_scratch() {
            self.wait_vsync();
        }
    }

    fn wait_vsync(&mut self) {
        if self.vsync_ok {
            let mut crt: u32 = 0;
            let rc = unsafe { libc::ioctl(self.file.as_raw_fd(), FBIO_WAITFORVSYNC, &mut crt) };
            if rc == 0 {
                return;
            }
            self.vsync_ok = false;
            log::info!("fb0 has no WAITFORVSYNC; present waits with fsync");
        }
        let _ = self.file.sync_all();
    }
}

impl Touch {
    fn open(panel: &Panel, shared: &Arc<Shared>) -> Result<Self> {
        let dir = fs::read_dir("/dev/input").context("/dev/input")?;
        for ent in dir.flatten() {
            let name = ent.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("event") {
                continue;
            }
            let Ok(device) = Evdev::open(ent.path()) else {
                continue;
            };
            if !device.supported_events().contains(EventType::ABSOLUTE) {
                continue;
            }
            let max_x =
                abs_max(&device, AbsoluteAxisCode::ABS_X).unwrap_or((panel.width as i32) - 1);
            let max_y =
                abs_max(&device, AbsoluteAxisCode::ABS_Y).unwrap_or((panel.height as i32) - 1);
            let _ = device.set_nonblocking(true);
            log::info!("evdev {} abs_max={max_x}", ent.path().display());
            let ready = if std::env::var_os("ONEKVM_SCREEN_TOUCH_POLL").is_some() {
                None
            } else {
                let shared = Arc::downgrade(shared);
                input_ready::InputReady::new(device.as_raw_fd(), move || {
                    if let Some(shared) = shared.upgrade() { shared.wake.notify(); }
                }).map_err(|error| log::warn!("touch readiness unavailable; using polling: {error}")).ok()
            };
            return Ok(Self {
                device,
                ready,
                max_x: max_x.max(1),
                max_y: max_y.max(1),
                x: 0,
                y: 0,
                lx: 0,
                ly: 0,
                down: false,
            });
        }
        bail!("no abs evdev");
    }

    fn needs_poll(&self) -> bool {
        self.ready.as_ref().is_none_or(input_ready::InputReady::failed)
    }

    fn poll(&mut self, panel: &Panel) -> Vec<u32> {
        let events = self.device.fetch_events();
        if let Ok(iter) = events {
            for ev in iter {
                match ev.destructure() {
                    EventSummary::AbsoluteAxis(_, AbsoluteAxisCode::ABS_X, value) => self.x = value,
                    EventSummary::AbsoluteAxis(_, AbsoluteAxisCode::ABS_Y, value) => self.y = value,
                    EventSummary::Key(_, KeyCode::BTN_TOUCH, value) => self.down = value != 0,
                    _ => {}
                }
            }
        }
        if let Some(ready) = &self.ready { ready.rearm(); }
        if !self.down {
            return Vec::new();
        }
        let px = self.x * (panel.width as i32 - 1) / self.max_x;
        let py = self.y * (panel.height as i32 - 1) / self.max_y;
        let px = px.clamp(0, panel.width as i32 - 1) as usize;
        let py = py.clamp(0, panel.height as i32 - 1) as usize;
        let (lx, ly) = unrotate_px(px, py, panel.rotate, panel.logical_w, panel.logical_h);
        self.lx = lx as i32;
        self.ly = ly as i32;
        vec![pack_touch(0, self.lx as u32, self.ly as u32)]
    }
}

fn abs_max(device: &Evdev, axis: AbsoluteAxisCode) -> Option<i32> {
    device.get_absinfo().ok().and_then(|mut it| {
        it.find(|(code, _)| *code == axis)
            .map(|(_, info)| info.maximum())
    })
}

fn pack_touch(id: u32, x: u32, y: u32) -> u32 {
    (id << 18) | (y << 9) | x
}

fn panel_round(w: i32, h: i32) -> bool {
    let a = w.min(h);
    let d = (w - h).abs();
    a > 0 && d * 8 <= a
}

fn fb_sys_geom() -> Option<(usize, usize, u32)> {
    let size = fs::read_to_string("/sys/class/graphics/fb0/virtual_size").ok()?;
    let mut it = size.trim().split(',');
    let w = it.next()?.parse().ok()?;
    let h = it.next()?.parse().ok()?;
    let bpp = fs::read_to_string("/sys/class/graphics/fb0/bits_per_pixel")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(16);
    Some((w, h, bpp))
}

pub(crate) fn dist_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = std::env::var("POCKETJS_DIST") {
        roots.push(PathBuf::from(dir));
    }
    roots.extend([
        PathBuf::from("/usr/local/share/onekvm/screen-display"),
        PathBuf::from("/usr/share/onekvm/screen-display"),
        PathBuf::from("dist"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("../share/onekvm/screen-display")))
            .unwrap_or_else(|| PathBuf::from(".")),
    ]);
    roots
}

fn bundle_dir(id: &str) -> Result<PathBuf> {
    if let Some(path) = crate::apps::bundle_dir(id) {
        return Ok(path);
    }
    for root in dist_roots() {
        let dir = if id == "shell" {
            root.clone()
        } else if id == "init" {
            root.join("init")
        } else if id == "chrome" {
            root.join("chrome")
        } else {
            root.join("apps").join(id)
        };
        let js = dir.join("main.vue-vapor.js");
        let pak = dir.join("main.vue-vapor.pak");
        if js.is_file() && pak.is_file() {
            return Ok(dir);
        }
    }
    bail!("PocketJS bundle not found for {id} (set POCKETJS_DIST)")
}

fn bytecode_abi() -> String { format!("pocketjs/qjs-0.12.2/{}-{}",usize::BITS,if cfg!(target_endian="little") {"le"} else {"be"}) }

fn bytecode_cache_path(id: &str, source_digest: &str) -> PathBuf {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source_digest.hash(&mut hasher);
    bytecode_abi().hash(&mut hasher);
    let safe_id = cache_id(id);
    shared::extension_data_dir()
        .join("app-cache")
        .join(format!("{safe_id}-{:016x}.jsc", hasher.finish()))
}

fn persist_bytecode_cache(id: &str, source_digest: &str, bytecode: &[u8]) {
    let path = bytecode_cache_path(id, source_digest);
    let Some(parent) = path.parent() else { return };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let prefix = cache_id(id);
    if let Ok(entries) = fs::read_dir(parent) {
        for entry in entries.flatten() {
            let candidate = entry.path();
            if candidate != path
                && candidate
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.strip_prefix(&format!("{prefix}-")).is_some_and(|suffix|
                        suffix.len() == 20 && suffix.ends_with(".jsc") && suffix[..16].bytes().all(|byte| byte.is_ascii_hexdigit())))
            {
                let _ = fs::remove_file(candidate);
            }
        }
    }
    let tmp = path.with_extension("jsc.tmp");
    if fs::write(&tmp, bytecode).is_ok() {
        let _ = fs::rename(tmp, path);
    }
}

struct Bundle {
    revision: u64,
    dir: PathBuf,
    bytecode: Arc<FileBlob>,
    pak: FileBlob,
}

static BUNDLE_CACHE: std::sync::OnceLock<Mutex<BundleCache<Bundle>>> = std::sync::OnceLock::new();

pub(crate) fn release_idle_bundle_pages() {
    if let Some(cache) = BUNDLE_CACHE.get() {
        for bundle in cache.lock().unwrap().values() {
            bundle.pak.release_pages();
            // ROM_DATA remains pinned by every runtime that evaluated it.
            if Arc::strong_count(&bundle.bytecode) == 1 { bundle.bytecode.release_pages(); }
        }
    }
}

pub(crate) fn prune_app_caches(ids: &[String]) {
    let all = ids.iter().map(String::as_str).chain(["shell", "init", "chrome"]);
    let mut revisions = std::collections::HashMap::new();
    let mut files = std::collections::HashSet::new();
    for id in all {
        let Ok(dir) = bundle_dir(id) else { continue; };
        revisions.insert(id.to_string(), apps::bundle_revision(&dir));
        if let Ok(digest) = bytecode::source_digest(&dir.join("main.vue-vapor.js")) {
            if let Some(name) = bytecode_cache_path(id,&digest).file_name() { files.insert(name.to_os_string()); }
        }
    }
    if let Some(cache) = BUNDLE_CACHE.get() {
        cache.lock().unwrap().retain(|key, bundle| revisions.get(key.split('\0').next().unwrap_or_default()) == Some(&bundle.revision));
    }
    let directory = shared::extension_data_dir().join("app-cache");
    let Ok(entries) = fs::read_dir(directory) else { return; };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().ends_with(".jsc") && !files.contains(&name) { let _ = fs::remove_file(entry.path()); }
    }
}

fn cache_id(id: &str) -> String {
    // ! is forbidden in App IDs, so this stays injective and below NAME_MAX.
    id.replace('/', "!")
}

fn load_bundle(id: &str) -> Result<Arc<Bundle>> {
    let cache = BUNDLE_CACHE.get_or_init(|| Mutex::new(BundleCache::new(2, 2 * 1024 * 1024)));
    let dir = bundle_dir(id)?;
    let revision = apps::bundle_revision(&dir);
    let cache_key = format!("{id}\0{}\0{revision:016x}", dir.display());
    if let Some(hit) = cache.lock().unwrap().get(&cache_key) {
        return Ok(hit);
    }
    let source_path = dir.join("main.vue-vapor.js");
    let digest = bytecode::source_digest(&source_path)
        .with_context(|| format!("hash {}", source_path.display()))?;
    let pak = FileBlob::open(&dir.join("main.vue-vapor.pak"))
        .with_context(|| format!("read {}/main.vue-vapor.pak", dir.display()))?;
    let packaged = bytecode::packaged(&dir, &digest, &pak, &bytecode_abi());
    if packaged.is_none() && dir.join("main.vue-vapor.jsc").exists() {
        log::warn!("ignored stale/incompatible packaged bytecode for {id}; using current source");
    }
    let bytecode = packaged
        .or_else(|| FileBlob::open(&bytecode_cache_path(id, &digest)).ok())
        .map(Ok)
        .unwrap_or_else(|| -> Result<FileBlob> {
            let js = fs::read_to_string(&source_path)
                .with_context(|| format!("read {}", source_path.display()))?;
            match compile_script(&dir.join("main.vue-vapor.js").display().to_string(), &js) {
                Ok(bytecode) => {
                    persist_bytecode_cache(id, &digest, &bytecode);
                    Ok(FileBlob::open(&bytecode_cache_path(id, &digest)).unwrap_or(FileBlob::Owned(bytecode)))
                }
                Err(err) => {
                    log::warn!("compile {id} bytecode cache failed: {err:#}");
                    Ok(FileBlob::Owned(Vec::new()))
                }
            }
        })?;
    let hit = Arc::new(Bundle {
        revision,
        dir,
        bytecode: Arc::new(bytecode),
        pak,
    });
    let mut cache = cache.lock().unwrap();
    cache.retain(|key, _| !key.starts_with(&format!("{id}\0")));
    cache.insert(cache_key, hit.clone(), hit.pak.len() + hit.bytecode.len());
    Ok(hit)
}

fn eval_bundle(guest: &mut guest::HostedGuest, id: &str, bundle: &Bundle) -> Result<()> {
    if !bundle.bytecode.is_empty() {
        match guest.eval_bytecode(id, bundle.bytecode.clone()) {
            Ok(()) => { log::info!("boot {id} bytecode {} bytes", bundle.bytecode.len()); return Ok(()); }
            Err(err) => log::warn!("boot {id} bytecode failed: {err:#}; using source"),
        }
    }
    let path = bundle.dir.join("main.vue-vapor.js");
    guest.eval(id, &fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?)
}

fn boot_session(id: &str, shared: &Arc<Shared>) -> Result<Session> {
    boot_surface_session(id, shared, None)
}

fn boot_surface_session(id: &str, shared: &Arc<Shared>, view: Option<Arc<screen_views::Bridge>>) -> Result<Session> {
    let t0 = Instant::now();
    let session_revision = apps::revision(id);
    let epoch = contributions::epoch();
    let bundle = load_bundle(id)?;
    log::info!("boot {id} from {}", bundle.dir.display());
    if id == "shell" {
        shared.set_pager(true);
        shared.set_hot(false);
    }
    let (width, height) = view.as_ref().map(|view| view.size()).unwrap_or((shared.screen_w() as usize, shared.screen_h() as usize));
    let surface = UiSurface::new((width as f32, height as f32));
    surface.set_tick_rate(60);
    if id == "shell" {
        // Layout slots stay stable across hidden/filtered widgets and hot saves.
        for slot in 0..32 {
            surface.register_compositor_surface(format!("screen-display/home-widget-{slot}"));
        }
        surface.register_compositor_surface("screen-display/home");
    }
    if id == "shell" { surface.feed_pak_deferred_images(&bundle.pak); }
    else { surface.feed_pak(&bundle.pak); }
    let mut guest = guest::HostedGuest::new(id.contains('/'))?;
    let rpc = app_rpc::Channel(app_rpc::Session::new(apps::policy(id)));
    if view.is_some() || matches!(id, "services" | "security" | "virtual-media" | "keyboard") {
        let shared = Arc::downgrade(shared);
        rpc.on_completion(Arc::new(move || {
            if let Some(shared) = shared.upgrade() { shared.set_hot(true); shared.wake.notify(); }
        }));
    }
    let fonts = matches!(id, "settings" | "init" | "virtual-media")
        .then(|| dynamic_fonts::NetworkFonts::new(bundle.clone(), surface.clone()));
    mount_onekvm(&guest, shared.clone(), id, rpc.clone(), fonts, view.clone())?;
    surface.mount(&guest)?;
    if id == "shell" {
        let resources = bundle.clone();
        let images = surface.clone();
        guest.with(|ctx| -> pocket_mod::qjs::Result<()> {
            let ui: pocket_mod::qjs::Object = ctx.globals().get("ui")?;
            ui.set("__loadTexture", pocket_mod::qjs::Function::new(ctx.clone(), move |name: String| {
                let key = format!("ui:img.{name}");
                let handle = pocket_ui_surface::find_pak(&resources.pak, &key)
                    .map(|blob| images.load_deferred_image(&name, blob)).unwrap_or(-1);
                resources.pak.release_pages();
                handle
            })?)?;
            Ok(())
        })?;
    }
    // SDK guests only: privileged built-in Settings/init bridges are never exposed.
    let debug = if id.contains('/') {
        let (instance, role) = view.as_ref().map(|view| view.debug_identity()).unwrap_or((id, "app"));
        Some(shared.devtools.attach(&guest, id, instance, role)?)
    } else { None };
    let mut icon_textures = std::collections::BTreeMap::new();
    if matches!(id, "shell" | "settings") {
        upload_launcher_icons(id, &surface, &guest, &mut icon_textures)?;
    }
    eval_bundle(&mut guest, id, &bundle)?;
    bundle.pak.release_pages();
    anyhow::ensure!(guest.has_frame(), "{id} installed no frame()");
    if id.contains('/') && (session_revision != apps::revision(id) || epoch != contributions::epoch() || !apps::can_launch(id)) {
        rpc.close(); bail!("App changed while starting");
    }
    log::info!("boot {id} ready in {}ms", t0.elapsed().as_millis());
    Ok(Session {
        guest,
        debug,
        debug_touches: Vec::new(),
        surface,
        id: id.to_string(),
        revision: session_revision,
        rpc,
        icon_gen: shared.catalog_gen(),
        icon_textures,
        shared: shared.clone(),
        scroll_layer: None,
        list_cache: None,
        capture_scroll: true,
        pager_cancel: None,
        home_frame: retained_frame::RetainedFrame::default(),
        views: (id == "shell").then(|| Box::new(screen_views::Views::default())),
        rendered_shell_page: None,
        shell_collected: Instant::now(),
    })
}

pub(crate) fn primary_ipv4() -> String {
    onekvm_net_address::display_ipv4(None).map(|ip| ip.to_string()).unwrap_or_default()
}

pub(crate) fn default_iface() -> String {
    let Ok(text) = fs::read_to_string("/proc/net/route") else {
        return String::new();
    };
    for line in text.lines().skip(1) {
        let mut cols = line.split_whitespace();
        let Some(name) = cols.next() else { continue };
        let Some(dest) = cols.next() else { continue };
        if dest == "00000000" {
            return name.to_string();
        }
    }
    String::new()
}

fn rot_delta(from: u16, to: u16) -> f32 {
    let mut d = to as i32 - from as i32;
    if d > 180 {
        d -= 360;
    }
    if d < -180 {
        d += 360;
    }
    d as f32
}

fn unrotate_px(x: usize, y: usize, rot: u16, lw: usize, lh: usize) -> (usize, usize) {
    let xm = lw.saturating_sub(1);
    let ym = lh.saturating_sub(1);
    match rot {
        90 => (y.min(xm), ym.saturating_sub(x)),
        180 => (xm.saturating_sub(x), ym.saturating_sub(y)),
        270 => (xm.saturating_sub(y), x.min(ym)),
        _ => (x.min(xm), y.min(ym)),
    }
}

#[cfg(test)]
mod pager_cancel_tests {
    use super::*;

    fn down(id: u32, x: u32, y: u32) -> u32 {
        (id << 18) | (y << 9) | x
    }

    #[test]
    fn claimed_swipe_cancels_the_row_contact_instead_of_releasing_it() {
        let contact = down(1, 40, 70);
        let mut pending = None;
        note_pager_claim(&mut pending, &[contact]);
        let delivered = shell_touches_after_pager_claim(&[], &mut pending);
        assert_eq!(delivered.as_ref(), &[contact | TOUCH_CANCEL]);
        assert!(pending.is_none());
        let later = shell_touches_after_pager_claim(&[], &mut pending);
        assert!(later.is_empty());
    }

    #[test]
    fn lift_without_a_claim_is_left_for_the_guest_tap() {
        let mut pending = None;
        note_pager_claim(&mut pending, &[]);
        let delivered = shell_touches_after_pager_claim(&[], &mut pending);
        assert!(delivered.is_empty());
        assert!(!pager_motion_claimed(PagerMotion::Idle));
        assert!(!pager_motion_claimed(PagerMotion::Armed { x0: 0, y0: 0 }));
        assert!(!pager_motion_claimed(PagerMotion::GuestLock));
    }

    #[test]
    fn finger_up_does_not_erase_the_claim() {
        let contact = down(0, 180, 60);
        let mut pending = None;
        note_pager_claim(&mut pending, &[contact]);
        note_pager_claim(&mut pending, &[]);
        let delivered = shell_touches_after_pager_claim(&[], &mut pending);
        assert_eq!(delivered.as_ref(), &[contact | TOUCH_CANCEL]);
    }

    #[test]
    fn a_different_contact_stays_active_beside_the_cancel() {
        let claimed = 0x8000_0000 | (7u32 << 20) | (10 << 10) | 4;
        let other = down(1, 8, 8);
        let live = [claimed, other];
        let mut pending = Some(cancel_touch_words(&[claimed]));
        let delivered = shell_touches_after_pager_claim(&live, &mut pending);
        assert_eq!(delivered.as_ref(), &[claimed | TOUCH_CANCEL, other]);
    }
}

fn apply_brightness(pct: i32) {
    let Ok(dir) = fs::read_dir("/sys/class/backlight") else {
        return;
    };
    for ent in dir.flatten() {
        let path = ent.path();
        let max = fs::read_to_string(path.join("max_brightness"))
            .ok()
            .and_then(|s| s.trim().parse::<i32>().ok())
            .unwrap_or(100)
            .max(1);
        let pct = pct.clamp(5, 100);
        let val = 1 + (pct - 5) * (max - 1) / 95;
        let _ = fs::write(path.join("brightness"), format!("{val}\n"));
        break;
    }
}

fn wake_backlight() {
    let _ = fs::write("/sys/class/graphics/fb0/blank", "0\n");
}

fn hide_fbcon() {
    let _ = fs::write("/sys/class/graphics/fbcon/cursor_blink", "0\n");
    if let Ok(dir) = fs::read_dir("/sys/class/vtconsole") {
        for ent in dir.flatten() {
            let name = fs::read_to_string(ent.path().join("name")).unwrap_or_default();
            if name.contains("frame buffer") {
                let _ = fs::write(ent.path().join("bind"), "0\n");
            }
        }
    }
    for tty in ["/dev/tty1", "/dev/tty0"] {
        if let Ok(mut file) = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NOCTTY)
            .open(tty)
        {
            unsafe {
                libc::ioctl(file.as_raw_fd(), KDSETMODE, KD_GRAPHICS);
            }
            let _ = file.write_all(b"\033[?25l");
            break;
        }
    }
}

#[cfg(test)]
mod bundle_loading_tests {
    use super::*;

    #[test]
    fn valid_bytecode_never_reads_source_and_bad_code_falls_back_to_current_source() {
        let dir = std::env::temp_dir().join(format!("screen-lazy-source-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let mut bundle = Bundle {
            revision: 0, dir: dir.clone(), pak: FileBlob::Owned(Vec::new()),
            bytecode: Arc::new(FileBlob::Owned(compile_script("lazy-source", "globalThis.origin = 'bytecode';globalThis.frame=()=>{globalThis.origin='retained'}").unwrap())),
        };
        let mut guest = guest::HostedGuest::new(false).unwrap();
        // No source file exists. A successful bytecode path must not read one.
        eval_bundle(&mut guest, "lazy-source", &bundle).unwrap();
        assert_eq!(guest.with(|ctx| ctx.globals().get::<_,String>("origin").unwrap()), "bytecode");
        fs::write(dir.join("main.vue-vapor.js"), "globalThis.origin = 'source'").unwrap();
        let old_code = Arc::downgrade(&bundle.bytecode);
        bundle.bytecode = Arc::new(FileBlob::Owned(b"not quickjs bytecode".to_vec()));
        assert!(old_code.upgrade().is_some(), "active guest lost its ROM bytecode after cache/revision eviction");
        guest.frame(0).unwrap();
        assert_eq!(guest.with(|ctx| ctx.globals().get::<_,String>("origin").unwrap()), "retained");
        drop(guest);
        assert!(old_code.upgrade().is_none(), "bytecode stayed pinned after the guest exited");
        let mut fallback = guest::HostedGuest::new(false).unwrap();
        eval_bundle(&mut fallback, "lazy-source", &bundle).unwrap();
        assert_eq!(fallback.with(|ctx| ctx.globals().get::<_,String>("origin").unwrap()), "source");
        fs::remove_dir_all(dir).unwrap();
    }
}
