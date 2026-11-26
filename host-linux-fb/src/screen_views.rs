//! Isolated programmable home/widget guests. The Shell owns navigation and layering.
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use pocketjs_core::{damage::DamageRect, raster, spec::ANALOG_CENTER};
use serde_json::{json, Value};

use crate::{apps, home_compositor::Surface, shared::Shared, Session};

pub const HOME_SLOT: usize = 32;
const MAX_WIDGETS: usize = 8;
static FOCUS: Mutex<String> = Mutex::new(String::new());
static FAILED: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();

pub fn focus() -> String { FOCUS.lock().unwrap().clone() }
pub fn set_focus(id: &str) -> bool {
    let mut focus = FOCUS.lock().unwrap();
    if *focus == id { return false; }
    *focus = id.chars().take(128).collect();
    true
}

fn controls_match(id: &str, shared: &Shared) -> bool {
    let controls: Vec<String> = serde_json::from_str(&shared.get_key("controls")).unwrap_or_default();
    apps::supports_controls(id, &controls)
}

pub fn widgets_json(shared: &Shared) -> String {
    let items: Vec<Value> = serde_json::from_str(&apps::surfaces_json("widget")).unwrap_or_default();
    Value::Array(items.into_iter().filter(|item| item["id"].as_str().is_some_and(|id| available(id, "widget") && controls_match(id, shared))).collect()).to_string()
}

fn available(id: &str, slot: &str) -> bool {
    apps::has_slot(id, slot) && apps::can_launch(id)
        && !FAILED.get_or_init(Default::default).lock().unwrap().get(id)
            .is_some_and(|revision| Some(*revision) == apps::revision(id))
}

pub fn selected_home(shared: &Shared) -> Option<String> {
    let layout: Value = serde_json::from_str(&shared.layout_json()).ok()?;
    let id = layout["home"].as_str()?;
    (available(id, "home") && controls_match(id, shared)).then(|| id.to_string())
}

/// Explicit read-only projection. Adding private Core fields cannot expose them here.
pub fn device_state(shared: &Shared) -> String {
    let raw: Value = serde_json::from_str(&shared.get_key("system")).unwrap_or_default();
    let mut result = json!({});
    for (group, fields) in [
        ("network", &["ip", "ipv4_addresses", "hostname", "ethernet_connected", "wifi_connected"][..]),
        ("video", &["active", "session_count", "hdmi_connected", "codec", "actual_fps", "fps", "input_width", "input_height"][..]),
        ("hid", &["connected"][..]),
        ("system", &["cpu_percent", "memory_used_bytes", "memory_total_bytes", "storage_available_bytes", "storage_total_bytes"][..]),
    ] {
        for field in fields {
            if let Some(value) = raw[group].get(field) { result[group][*field] = value.clone(); }
        }
    }
    for field in ["uptime_seconds", "machine", "version"] {
        if let Some(value) = raw.get(field) { result[field] = value.clone(); }
    }
    result.to_string()
}

#[derive(Default)]
struct Input {
    sequence: String,
    step: String,
    click: String,
    visible: bool,
    focused: bool,
    hot: bool,
    after: Option<Instant>,
    settings: Value,
}

pub struct Bridge {
    width: usize,
    height: usize,
    instance: String,
    role: &'static str,
    input: Mutex<Input>,
}

impl Bridge {
    pub fn debug_identity(&self) -> (&str, &str) { (&self.instance, self.role) }
    pub fn size(&self) -> (usize, usize) { (self.width, self.height) }

    pub fn get(&self, key: &str) -> Option<String> {
        let input = self.input.lock().unwrap();
        Some(match key {
            "screenW" => self.width.to_string(),
            "screenH" => self.height.to_string(),
            "surfaceContext" => json!({"version":1,"instanceId":self.instance,"role":self.role,
                "width":self.width,"height":self.height,"visible":input.visible,"focused":input.focused,
                "settings":input.settings}).to_string(),
            "knobSeq" => input.sequence.clone(),
            "knob" => input.step.clone(),
            "knobClick" => input.click.clone(),
            // A hold belongs to system navigation and cannot be intercepted.
            "knobHold" | "back" => "0".into(),
            _ => return None,
        })
    }

    pub fn set(&self, key: &str, value: &str, shared: &Arc<Shared>) -> bool {
        match key {
            "hot" => self.input.lock().unwrap().hot = value == "1" || value == "true",
            "frameAfter" => {
                if let Ok(ms) = value.parse::<u64>() {
                    self.input.lock().unwrap().after = (ms > 0).then(|| Instant::now() + Duration::from_millis(ms.clamp(16, 60_000)));
                }
            }
            "launch" => {
                if self.input.lock().unwrap().visible {
                    if value == "shell" || value == "launcher" { shared.request_shell_page(1); }
                    else if apps::has_slot(value, "app") { shared.set_launch(value); }
                }
            }
            // Surface guests cannot control shell scrolling, hints or the framebuffer.
            "back" | "hint" | "appPageTransition" | "appScrollTransition" | "appDrawerTransition" => {},
            _ => return false,
        }
        true
    }
}

struct View {
    session: Session,
    bridge: Arc<Bridge>,
    words: Vec<u32>,
    pixels: Vec<u16>,
    bounds: Option<Surface>,
    touches: Vec<u32>,
    contact: Option<u32>,
    framed: bool,
}

#[derive(Default)]
pub struct Views {
    views: BTreeMap<usize, View>,
    active: bool,
    interactive: bool,
    started: Option<Instant>,
    order: Vec<usize>,
    contacts: BTreeMap<u32, Option<usize>>,
}

impl Views {
    pub fn poll_devtools(&mut self, deadline: Instant) -> bool {
        let mut changed = false;
        for view in self.views.values_mut() {
            if view.session.poll_devtools(deadline) {
                view.words.clear();
                changed = true;
            }
        }
        changed
    }
    pub fn has_views(&self) -> bool { !self.views.is_empty() }

    pub fn prepare(&mut self, shared: &Arc<Shared>, home: bool, interactive: bool, touches: &[u32]) {
        self.active = shared.shell_page() == 0;
        self.interactive = interactive && home && self.active;
        self.started = Some(Instant::now());
        if !home {
            if interactive { self.pause(); }
            return;
        }
        let layout: Value = serde_json::from_str(&shared.layout_json()).unwrap_or_default();
        let mut wanted = BTreeMap::new();
        if let Some(id) = selected_home(shared) {
            wanted.insert(HOME_SLOT, (id.clone(), id, "home", shared.screen_w() as usize, shared.screen_h() as usize, layout["home_settings"].clone()));
        } else if let Some(placements) = layout["home_widgets"].as_array() {
            for (slot, placement) in placements.iter().take(32).enumerate() {
                if placement["hidden"] == true || wanted.len() == MAX_WIDGETS { continue; }
                let Some(instance) = placement["id"].as_str() else { continue; };
                let id = placement["widget"].as_str().unwrap_or(instance);
                if !available(id, "widget") || !controls_match(id, shared) { continue; }
                let width = dimension(&placement["width"], 64, 240).max(2);
                let height = dimension(&placement["height"], 24, 120);
                wanted.insert(slot, (id.into(), instance.into(), "widget", width, height, placement["settings"].clone()));
            }
        }
        self.views.retain(|slot, view| wanted.get(slot).is_some_and(|(id, instance, _, w, h, _)|
            view.session.id == *id && view.bridge.instance == *instance && view.bridge.size() == (*w, *h)
                && view.session.revision == apps::revision(id)));
        for (slot, (id, instance, role, width, height, settings)) in wanted {
            if !self.views.contains_key(&slot) {
                let bridge = Arc::new(Bridge { width, height, instance, role,
                    input: Mutex::new(Input { settings: if settings.is_object() { settings.clone() } else { json!({}) }, visible: self.active, ..Default::default() }) });
                match crate::boot_surface_session(&id, shared, Some(bridge.clone())) {
                    Ok(session) => { self.views.insert(slot, View { session, bridge, words: vec![],
                        pixels: vec![0; width * height], bounds: None, touches: vec![], contact: None, framed: false }); },
                    Err(error) => { fail(&id, &format!("{error:#}")); },
                }
            }
            if let Some(view) = self.views.get_mut(&slot) {
                view.framed = false;
                view.touches.clear();
                let mut input = view.bridge.input.lock().unwrap();
                input.settings = if settings.is_object() { settings } else { json!({}) };
                input.visible = self.active;
                input.focused = self.interactive && (slot == HOME_SLOT || focus() == view.bridge.instance);
                input.sequence = if input.focused { shared.get_key("knobSeq") } else { "0".into() };
                input.step = if input.focused { shared.get_key("knob") } else { "0".into() };
                input.click = if input.focused { shared.get_key("knobClick") } else { "0".into() };
                if shared.get_key("knobHold") == "1" { input.step = "0".into(); input.click = "0".into(); }
                if input.after.is_some_and(|at| at <= Instant::now()) { input.after = None; }
            }
        }
        if self.interactive { self.route_touches(touches); }
        self.order.clear();
        self.started = Some(Instant::now());
    }

    fn route_touches(&mut self, touches: &[u32]) {
        // Preserve ownership from down through release/cancel, including outside drags.
        for word in touches {
            let (id, x, y) = unpack_touch(*word);
            let owner = *self.contacts.entry(id).or_insert_with(|| self.order.iter().rev()
                .find(|slot| self.views.get(slot).is_some_and(|view| view.bounds.is_some_and(|bounds| contains(bounds, x, y)))).copied());
            let Some(view) = owner.and_then(|slot| self.views.get_mut(&slot)) else { continue; };
            let Some(bounds) = view.bounds else { continue; };
            view.contact = Some(id);
            let local_x = ((x - bounds.x) * view.bridge.width as f64 / bounds.width).round().clamp(0.0, (view.bridge.width - 1) as f64) as u32;
            let local_y = ((y - bounds.y) * view.bridge.height as f64 / bounds.height).round().clamp(0.0, (view.bridge.height - 1) as f64) as u32;
            let cancel = if !contains(bounds, x, y) { crate::TOUCH_CANCEL } else { *word & crate::TOUCH_CANCEL };
            view.touches.push(0x8000_0000 | cancel | (id << 20) | (local_y << 10) | local_x);
            if cancel != 0 { self.contacts.insert(id, None); }
        }
        for view in self.views.values_mut() {
            if !touches.iter().any(|word| Some(unpack_touch(*word).0) == view.contact) { view.contact = None; }
        }
        self.contacts.retain(|id, _| touches.iter().any(|word| unpack_touch(*word).0 == *id));
    }

    pub fn paint(&mut self, bounds: Surface, target: &mut [u16], panel_width: usize, panel_height: usize) -> bool {
        let Some(view) = self.views.get_mut(&bounds.slot) else { return false; };
        self.order.push(bounds.slot);
        view.bounds = Some(bounds);
        if !view.framed && (self.interactive || view.words.is_empty()) {
            let remaining = Duration::from_millis(100).saturating_sub(self.started.unwrap_or_else(Instant::now).elapsed());
            if remaining.is_zero() {
                view.session.shared.frame_timer.schedule_earlier(Duration::from_millis(16));
                return true;
            }
            view.session.guest.arm(remaining.min(Duration::from_millis(50)));
            view.session.debug_touches.clone_from(&view.touches);
            let result = view.session.guest.frame_with_touches(0, ANALOG_CENTER, &view.touches);
            if let Err(error) = result {
                fail(&view.session.id, &format!("{error:#}"));
                let shared = view.session.shared.clone();
                self.views.remove(&bounds.slot);
                shared.set_hot(true);
                shared.wake.notify();
                return true;
            }
            view.session.surface.tick();
            view.session.surface.with_ui(|ui| view.words.clone_from(&ui.draw().words));
            view.framed = true;
        }
        // Seed the local buffer from the already painted scene. Alpha in the
        // independent draw list then blends with precisely the underlying layer.
        let (width, height) = view.bridge.size();
        for y in 0..height { for x in 0..width {
            let px = (bounds.x + (x as f64 + 0.5) * bounds.width / width as f64).floor() as i32;
            let py = (bounds.y + (y as f64 + 0.5) * bounds.height / height as f64).floor() as i32;
            view.pixels[y * width + x] = if px >= 0 && py >= 0 && px < panel_width as i32 && py < panel_height as i32 { target[py as usize * panel_width + px as usize] } else { 0 };
        } }
        view.session.surface.with_ui(|ui| raster::render_scaled_rgb565_over(ui, &view.words, &mut view.pixels, 1));
        blit(&view.pixels, width, height, bounds, target, panel_width, panel_height);
        true
    }

    pub fn schedule(&self, shared: &Arc<Shared>) {
        if !self.active { return; }
        let now = Instant::now();
        let mut next = None;
        for view in self.views.values().filter(|view| view.framed) {
            let input = view.bridge.input.lock().unwrap();
            if input.hot { shared.set_hot(true); }
            if let Some(at) = input.after { next = Some(next.map_or(at, |old: Instant| old.min(at))); }
        }
        if let Some(at) = next { shared.frame_timer.schedule_earlier(at.saturating_duration_since(now)); }
    }

    pub fn pause(&mut self) {
        self.active = false;
        set_focus("");
        self.contacts.clear();
        self.order.clear();
        for view in self.views.values_mut() {
            let was_visible = { let mut input = view.bridge.input.lock().unwrap();
                let visible = input.visible; input.visible = false; input.focused = false;
                input.sequence = "0".into(); input.step = "0".into(); input.click = "0".into();
                visible };
            if was_visible {
                view.session.guest.arm(Duration::from_millis(50));
                let cancelled = crate::cancel_touch_words(&view.touches);
                view.session.debug_touches.clone_from(&cancelled);
                if let Err(error) = view.session.guest.frame_with_touches(0, ANALOG_CENTER, &cancelled) { fail(&view.session.id, &format!("{error:#}")); }
            }
            view.contact = None;
        }
    }
}

fn fail(id: &str, error: &str) {
    log::error!("screen surface {id}: {error}");
    apps::record_failure(id, error);
    FAILED.get_or_init(Default::default).lock().unwrap().insert(id.into(), apps::revision(id).unwrap_or_default());
}

fn dimension(value: &Value, fallback: usize, max: usize) -> usize {
    value.as_f64().filter(|n| n.is_finite()).map(|n| n.clamp(1.0, max as f64).round() as usize).unwrap_or(fallback)
}

fn unpack_touch(word: u32) -> (u32, f64, f64) {
    let (shift, mask) = if word & 0x8000_0000 != 0 { (10, 1023) } else { (9, 511) };
    ((word >> (shift * 2)) & 255, (word & mask) as f64, ((word >> shift) & mask) as f64)
}

fn contains(surface: Surface, x: f64, y: f64) -> bool {
    x >= surface.x && x < surface.x + surface.width && y >= surface.y && y < surface.y + surface.height
        && x >= surface.clip.x0 as f64 && x < surface.clip.x1 as f64 && y >= surface.clip.y0 as f64 && y < surface.clip.y1 as f64
}

fn blit(source: &[u16], width: usize, height: usize, surface: Surface, target: &mut [u16], panel_width: usize, panel_height: usize) {
    let clip = DamageRect::new(surface.x.floor() as i32, surface.y.floor() as i32,
        (surface.x + surface.width).ceil() as i32, (surface.y + surface.height).ceil() as i32);
    for y in clip.y0.max(surface.clip.y0).max(0)..clip.y1.min(surface.clip.y1).min(panel_height as i32) {
        for x in clip.x0.max(surface.clip.x0).max(0)..clip.x1.min(surface.clip.x1).min(panel_width as i32) {
            let sx = (((x as f64 + 0.5 - surface.x) / surface.width * width as f64).floor() as usize).min(width - 1);
            let sy = (((y as f64 + 0.5 - surface.y) / surface.height * height as f64).floor() as usize).min(height - 1);
            target[y as usize * panel_width + x as usize] = source[sy * width + sx];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compositing_is_clipped_and_scaled_in_local_coordinates() {
        let surface = Surface { slot: 0, x: -1.0, y: 1.0, width: 4.0, height: 2.0, clip: DamageRect::new(1, 0, 4, 4) };
        let mut target = [0; 16];
        blit(&[1, 2], 2, 1, surface, &mut target, 4, 4);
        assert_eq!(target, [0,0,0,0, 0,2,2,0, 0,2,2,0, 0,0,0,0]);
        assert!(!contains(surface, 0.0, 1.0));
        assert!(contains(surface, 1.0, 1.0));
    }

    #[test]
    fn touch_encoding_preserves_cancel_and_large_coordinates() {
        assert_eq!(unpack_touch(0x8000_0000 | crate::TOUCH_CANCEL | (3 << 20) | (171 << 10) | 319), (3,319.0,171.0));
        assert_eq!(unpack_touch((2 << 18) | (100 << 9) | 200), (2,200.0,100.0));
    }
}
