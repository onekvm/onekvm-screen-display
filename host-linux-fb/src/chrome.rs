use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use pocket_ui_surface::UiSurface;
use pocketjs_core::{spec::{self, prop, NodeType, Easing}, Ui};

use crate::{file_blob::FileBlob, shared::Shared};

/// The shared pill/hint layer needs native UI nodes, not a separate JS realm.
pub struct AppChrome {
    layer: ChromeLayer,
    shared: Arc<Shared>,
}

struct ChromeLayer {
    surface: UiSurface,
    pill: i32,
    bar: i32,
    label: i32,
    wake: u32,
    shown: bool,
    hiding: bool,
    fade_frames: u8,
    fade_anim: i32,
    text: String,
}

impl AppChrome {
    pub fn new(shared: Arc<Shared>) -> Result<Self> {
        let pak = FileBlob::open(&crate::bundle_dir("chrome")?.join("main.vue-vapor.pak"))?;
        let layer = ChromeLayer::new(shared.screen_w() as f32, shared.screen_h() as f32, &pak);
        Ok(Self { layer, shared })
    }

    pub fn frame(&mut self) {
        self.layer.frame(
            self.shared.touch_on() && self.shared.home_pill_visible(),
            &self.shared.hint_text(),
            self.shared.chrome_wake(),
        );
    }

    pub fn animating(&self) -> bool {
        self.layer.animating(self.shared.chrome_wake())
    }

    pub fn with_ui<R>(&self, f: impl FnOnce(&mut Ui) -> R) -> R {
        self.layer.surface.with_ui(f)
    }
}

impl ChromeLayer {
    fn new(w: f32, h: f32, pak: &[u8]) -> Self {
        let surface = UiSurface::new((w, h));
        surface.feed_pak(pak);
        let (pill, bar, label) = surface.with_ui(|ui| {
            let pill = ui.create_node(NodeType::View as u8);
            let bar = ui.create_node(NodeType::View as u8);
            let label = ui.create_node(NodeType::Text as u8);
            for (id, width, height, left, top, radius, color) in [
                (pill, 40., 4., ((w - 40.) / 2.).round(), h - 12., 2., 0xff7a7171u32),
                (bar, 208., 44., ((w - 208.) / 2.).round(), h - 60., 12., 0xff2a2727u32),
            ] {
                for (p, value) in [(prop::POS_TYPE, 1.), (prop::WIDTH, width), (prop::HEIGHT, height),
                    (prop::INSET_L, left), (prop::INSET_T, top), (prop::RADIUS, radius), (prop::OPACITY, 0.)] {
                    ui.set_prop(id, p, value as f64);
                }
                ui.set_prop(id, prop::BG_COLOR, color as f64);
                ui.insert_before(spec::ROOT_ID, id, 0);
            }
            for (p, value) in [(prop::PADDING_T, 8.), (prop::PADDING_B, 8.),
                (prop::PADDING_L, 12.), (prop::PADDING_R, 12.), (prop::JUSTIFY, 1.), (prop::ALIGN, 1.)] {
                ui.set_prop(bar, p, value);
            }
            ui.set_prop(label, prop::FONT_SLOT, 3.); // text-lg / 18 px, same packaged atlas.
            ui.set_prop(label, prop::LINE_HEIGHT, 24.);
            ui.set_prop(label, prop::TEXT_COLOR, 0xffffffffu32 as f64);
            ui.insert_before(bar, label, 0);
            (pill, bar, label)
        });
        Self { surface, pill, bar, label, wake: 0, shown: false, hiding: false, fade_frames: 0, fade_anim: -1, text: String::new() }
    }

    fn animating(&self, wake: u32) -> bool {
        self.fade_frames > 0 && self.wake == wake
    }

    fn frame(&mut self, pill_on: bool, hint: &str, wake: u32) {
        self.surface.with_ui(|ui| {
            if wake != self.wake {
                self.wake = wake;
                self.shown = false;
                self.hiding = false;
                self.fade_frames = 0;
                ui.cancel_anim(self.fade_anim);
                self.fade_anim = -1;
                ui.set_prop(self.bar, prop::OPACITY, 0.);
            }
            ui.set_prop(self.pill, prop::OPACITY, if pill_on { 1. } else { 0. });
            if !hint.is_empty() {
                if hint != self.text { self.text = hint.to_string(); ui.set_text(self.label, hint); }
                if !self.shown || self.hiding {
                    self.fade_anim = ui.animate(self.bar, prop::OPACITY, 1., 180, Easing::EaseOut as u8, 0);
                    self.shown = true;
                    self.hiding = false;
                    self.fade_frames = 12;
                }
            } else if self.shown && !self.hiding {
                self.fade_anim = ui.animate(self.bar, prop::OPACITY, 0., 180, Easing::EaseIn as u8, 0);
                self.hiding = true;
                self.fade_frames = 12;
            }
            ui.tick();
            if self.fade_frames > 0 {
                self.fade_frames -= 1;
                if self.fade_frames == 0 && self.hiding {
                    ui.set_prop(self.bar, prop::OPACITY, 0.);
                    self.shown = false;
                    self.hiding = false;
                }
            }
        });
    }
}

const SPIN565: u16 = 0xE79C;
const HINT_FADE_S: f32 = 0.18;

pub struct HintGlyph {
    advance: i32,
    cov: Vec<u8>,
}

pub struct HintAtlas {
    cell_w: usize,
    cell_h: usize,
    glyphs: HashMap<u32, HintGlyph>,
}

impl HintAtlas {
    pub fn load() -> Self {
        for root in crate::dist_roots() {
            if let Some(atlas) = Self::from_path(&root.join("hint-atlas.bin")) {
                return atlas;
            }
        }
        Self {
            cell_w: 12,
            cell_h: 16,
            glyphs: HashMap::new(),
        }
    }

    fn from_path(path: &Path) -> Option<Self> {
        let raw = fs::read(path).ok()?;
        if raw.len() < 10 {
            return None;
        }
        let hat2 = raw.starts_with(b"HAT2");
        if !hat2 && !raw.starts_with(b"HAT1") {
            return None;
        }
        let cell_w = u16::from_le_bytes([raw[4], raw[5]]) as usize;
        let cell_h = u16::from_le_bytes([raw[6], raw[7]]) as usize;
        let count = u16::from_le_bytes([raw[8], raw[9]]) as usize;
        let cell = cell_w.checked_mul(cell_h)?;
        let rec = 4 + usize::from(hat2) * 2 + cell;
        let mut off = 10;
        let mut glyphs = HashMap::new();
        for _ in 0..count {
            if off + rec > raw.len() {
                break;
            }
            let cp = u32::from_le_bytes(raw[off..off + 4].try_into().ok()?);
            off += 4;
            let advance = if hat2 {
                let adv = u16::from_le_bytes([raw[off], raw[off + 1]]) as i32;
                off += 2;
                adv
            } else {
                cell_w as i32 - 2
            };
            glyphs.insert(
                cp,
                HintGlyph {
                    advance,
                    cov: raw[off..off + cell].to_vec(),
                },
            );
            off += cell;
        }
        log::info!("hint atlas {} glyphs from {}", glyphs.len(), path.display());
        Some(Self {
            cell_w,
            cell_h,
            glyphs,
        })
    }
}

#[derive(Default)]
pub struct HintFade {
    text: String,
    alpha: f32,
}

impl HintFade {
    pub fn step(&mut self, wanted: &str, dt: f32) -> bool {
        let show = !wanted.is_empty();
        if show && self.text != wanted {
            self.text = wanted.to_string();
        }
        let target = if show { 1.0 } else { 0.0 };
        if (self.alpha - target).abs() < 0.008 {
            let changed = self.alpha != target;
            self.alpha = target;
            if !show && self.alpha == 0.0 {
                self.text.clear();
            }
            return changed;
        }
        let dir = if target > self.alpha { 1.0 } else { -1.0 };
        self.alpha = (self.alpha + dir * (dt / HINT_FADE_S)).clamp(0.0, 1.0);
        if self.alpha == 0.0 && !show {
            self.text.clear();
        }
        true
    }

    pub fn active(&self) -> bool {
        self.alpha > 0.001
    }

    pub fn armed(&self) -> bool {
        self.alpha > 0.2 || !self.text.is_empty()
    }
}

pub fn overlay_app_chrome(_buf: &mut [u16], _atlas: &HintAtlas, _fade: &HintFade) {}

const WELL565: u16 = 0x7BEF;

pub struct LoadIcon {
    w: i32,
    h: i32,
    rgb: Vec<u16>,
    alpha: Vec<u8>,
}

impl LoadIcon {
    pub fn load(id: &str) -> Option<Self> {
        if id == "shell" {
            return None;
        }
        if let Some(bundle) = crate::apps::bundle_dir(id) {
            if let Some(icon) = Self::from_path(&bundle.join("icon.bin")) {
                return Some(icon);
            }
        }
        for root in crate::dist_roots() {
            for path in [
                root.join("icons").join(format!("{id}.icon.bin")),
                root.join("apps").join(id).join("icon.bin"),
            ] {
                if let Some(icon) = Self::from_path(&path) {
                    return Some(icon);
                }
            }
        }
        None
    }

    pub fn from_path(path: &Path) -> Option<Self> {
        if fs::metadata(path).ok()?.len() > 8 + 256 * 256 * 3 { return None; }
        let raw = fs::read(path).ok()?;
        Self::from_bytes(&raw)
    }

    fn from_bytes(raw: &[u8]) -> Option<Self> {
        if raw.len() < 8 || &raw[..4] != b"ICO1" {
            return None;
        }
        let w = u16::from_le_bytes([raw[4], raw[5]]) as i32;
        let h = u16::from_le_bytes([raw[6], raw[7]]) as i32;
        if w <= 0 || h <= 0 || w > 256 || h > 256 || !(w as u32).is_power_of_two() || !(h as u32).is_power_of_two() {
            return None;
        }
        let n = (w * h) as usize;
        let rgb_bytes = n * 2;
        if raw.len() < 8 + rgb_bytes + n {
            return None;
        }
        let mut rgb = Vec::with_capacity(n);
        let mut off = 8;
        for _ in 0..n {
            rgb.push(u16::from_le_bytes([raw[off], raw[off + 1]]));
            off += 2;
        }
        Some(Self {
            w,
            h,
            rgb,
            alpha: raw[off..off + n].to_vec(),
        })
    }

    pub fn texture(&self) -> (u32, u32, Vec<u8>) {
        let mut rgba = Vec::with_capacity(self.rgb.len() * 4);
        for (&pixel, &alpha) in self.rgb.iter().zip(&self.alpha) {
            let r = ((pixel >> 11) & 31) as u8;
            let g = ((pixel >> 5) & 63) as u8;
            let b = (pixel & 31) as u8;
            rgba.extend_from_slice(&[(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), alpha]);
        }
        (self.w as u32, self.h as u32, rgba)
    }
}

pub fn draw_load_plate(buf: &mut [u16], icon: Option<&LoadIcon>, w: usize, h: usize) {
    buf.fill(0);
    let cx = (w.saturating_sub(1) as f32) * 0.5;
    let cy = (h.saturating_sub(1) as f32) * 0.5;
    draw_disc(buf, cx, cy, 32.0, WELL565, w, h);
    if let Some(icon) = icon {
        blit_icon(buf, icon, cx.round() as i32, cy.round() as i32, w, h);
    }
}

fn blit_icon(buf: &mut [u16], icon: &LoadIcon, cx: i32, cy: i32, w: usize, h: usize) {
    let x0 = cx - icon.w / 2;
    let y0 = cy - icon.h / 2;
    for row in 0..icon.h {
        for col in 0..icon.w {
            let i = (row * icon.w + col) as usize;
            let a = icon.alpha[i] as f32 / 255.0;
            if a <= 0.0 {
                continue;
            }
            let px = x0 + col;
            let py = y0 + row;
            if px < 0 || py < 0 || px >= w as i32 || py >= h as i32 {
                continue;
            }
            blend_cov(&mut buf[py as usize * w + px as usize], icon.rgb[i], a);
        }
    }
}

fn draw_disc(buf: &mut [u16], cx: f32, cy: f32, radius: f32, color: u16, w: usize, h: usize) {
    let x0 = (cx - radius - 1.0).max(0.0) as i32;
    let y0 = (cy - radius - 1.0).max(0.0) as i32;
    let x1 = (cx + radius + 2.0).min(w as f32) as i32;
    let y1 = (cy + radius + 2.0).min(h as f32) as i32;
    for y in y0..y1 {
        for x in x0..x1 {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let cov = (radius + 0.5 - (dx * dx + dy * dy).sqrt()).clamp(0.0, 1.0);
            if cov <= 0.0 {
                continue;
            }
            blend_cov(&mut buf[y as usize * w + x as usize], color, cov);
        }
    }
}

pub fn draw_host_spinner(buf: &mut [u16], start_deg: i32, w: usize, h: usize) {
    let cx = (w.saturating_sub(1) as f32) * 0.5;
    let cy = (h.saturating_sub(1) as f32) * 0.5;
    const R_OUT: f32 = 48.0;
    const R_IN: f32 = 44.5;
    let sweep = 270.0;
    let start = start_deg as f32;
    let x0 = (cx - R_OUT - 2.0).max(0.0) as i32;
    let y0 = (cy - R_OUT - 2.0).max(0.0) as i32;
    let x1 = (cx + R_OUT + 3.0).min(w as f32) as i32;
    let y1 = (cy + R_OUT + 3.0).min(h as f32) as i32;
    for y in y0..y1 {
        for x in x0..x1 {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            let ring = band(dist, R_IN, R_OUT);
            if ring <= 0.0 {
                continue;
            }
            let mut deg = dx.atan2(-dy) * 180.0 / std::f32::consts::PI;
            if deg < 0.0 {
                deg += 360.0;
            }
            let ang = sweep_cov(deg, start, sweep);
            let cov = ring * ang;
            if cov <= 0.0 {
                continue;
            }
            let i = y as usize * w + x as usize;
            blend_cov(&mut buf[i], SPIN565, cov);
        }
    }
}

fn sweep_cov(deg: f32, start: f32, sweep: f32) -> f32 {
    let mut rel = deg - start;
    while rel < 0.0 {
        rel += 360.0;
    }
    while rel >= 360.0 {
        rel -= 360.0;
    }
    if rel > sweep {
        return 0.0;
    }
    let edge = 2.5;
    (rel.min(sweep - rel) / edge).clamp(0.0, 1.0)
}

fn band(d: f32, lo: f32, hi: f32) -> f32 {
    let outer = (hi + 0.5 - d).clamp(0.0, 1.0);
    let inner = (d - (lo - 0.5)).clamp(0.0, 1.0);
    outer * inner
}

fn blend_cov(dst: &mut u16, color: u16, cov: f32) {
    let a = (cov.clamp(0.0, 1.0) * 256.0) as u32;
    if a == 0 {
        return;
    }
    let ia = 256 - a;
    let d = *dst as u32;
    let s = color as u32;
    let r = ((((d >> 11) & 31) * ia) + (((s >> 11) & 31) * a)) >> 8;
    let g = ((((d >> 5) & 63) * ia) + (((s >> 5) & 63) * a)) >> 8;
    let b = (((d & 31) * ia) + ((s & 31) * a)) >> 8;
    *dst = ((r << 11) | (g << 5) | b) as u16;
}

#[cfg(test)]
mod icon_tests {
    use super::*;

    #[test]
    fn native_chrome_retains_cue_geometry_fades_and_resets_between_apps() {
        for (w,h) in [(320,172), (240,240)] {
            let mut chrome = ChromeLayer::new(w as f32,h as f32,&[]);
            let render = |layer: &ChromeLayer| {
                let mut pixels = vec![0u16; w*h];
                layer.surface.with_ui(|ui| {
                    let words = ui.draw().words.clone();
                    pocketjs_core::raster::render_scaled_rgb565_over(ui, &words, &mut pixels, 1);
                });
                pixels
            };
            chrome.frame(false,"",0);
            assert!(render(&chrome).iter().all(|p| *p == 0));
            chrome.frame(true,"",0);
            let pill = render(&chrome);
            assert_ne!(pill[(h-10)*w+w/2],0);
            assert_eq!(pill[(h-10)*w+w/2-22],0);
            for _ in 0..12 { chrome.frame(false,"Hint",0); }
            assert_ne!(render(&chrome)[(h-38)*w+w/2],0);
            for _ in 0..12 { chrome.frame(false,"",0); }
            assert!(render(&chrome).iter().all(|p| *p == 0));
            assert_eq!(chrome.fade_frames,0);
            chrome.frame(false,"Hint",0);
            assert!(chrome.animating(0));
            assert!(!chrome.animating(1), "leaving an App must not keep the home shell in a busy loop");
            chrome.frame(false,"",1);
            assert!(render(&chrome).iter().all(|p| *p == 0));
            assert_eq!(chrome.fade_frames,0);
        }
    }

    #[test]
    #[ignore = "requires generated dist/chrome assets"]
    fn native_chrome_matches_legacy_pixels() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/chrome");
        let pak = fs::read(dir.join("main.vue-vapor.pak")).expect("build chrome-app first");
        let source = fs::read_to_string(dir.join("main.vue-vapor.js")).unwrap();
        for (w,h) in [(320,172), (240,240)] {
            for (language,hint) in [("en","Swipe again for Home"),("zh","再滑一次返回首页"),("zh_tw","再滑一次返回首頁")] {
                for (pill_on,text) in [(false,""),(true,""),(true,hint)] {
                    let guest = pocket_mod::Guest::new().unwrap();
                    let legacy = UiSurface::new((w as f32,h as f32));
                    legacy.feed_pak(&pak);
                    legacy.mount(&guest).unwrap();
                    let values = serde_json::json!({"screenW":w.to_string(),"screenH":h.to_string(),"touchOn":"1",
                        "language":language,"hint":text,"chromeWake":"0","homePill":if pill_on {"1"} else {"0"}});
                    guest.eval("bridge", &format!("const values={values};globalThis.onekvm={{get:k=>values[k]||'',set:()=>{{}}}};")).unwrap();
                    guest.eval("chrome", &source).unwrap();
                    let mut native = ChromeLayer::new(w as f32,h as f32,&pak);
                    for _ in 0..20 {
                        guest.frame_with_touches(0,spec::ANALOG_CENTER,&[]).unwrap(); legacy.tick();
                        native.frame(pill_on,text,0);
                    }
                    let render = |surface: &UiSurface| {
                        let mut pixels = vec![0u16;w*h];
                        surface.with_ui(|ui| {
                            let words = ui.draw().words.clone();
                            pocketjs_core::raster::render_scaled_rgb565_over(ui,&words,&mut pixels,1);
                        });pixels
                    };
                    let a=render(&legacy);let b=render(&native.surface);
                    let diffs:Vec<_> = a.iter().zip(&b).enumerate().filter(|(_, (a,b))| a!=b).map(|(i,(a,b))|(i%w,i/w,*a,*b)).collect();
                    assert!(diffs.is_empty(),"{w}x{h}/{language}/pill={pill_on}/hint={text}: {} pixels differ, first {:?}",diffs.len(),diffs.first());
                }
            }
        }
    }
    #[test]
    fn rgb565_icons_preserve_color_and_alpha_and_reject_bad_dimensions() {
        let raw = b"ICO1\x02\x00\x01\x00\x00\xf8\xe0\x07\xff\x80";
        let icon = LoadIcon::from_bytes(raw).unwrap();
        assert_eq!(icon.texture(), (2,1,vec![255,0,0,255,0,255,0,128]));
        assert!(LoadIcon::from_bytes(&raw[..raw.len()-1]).is_none());
        assert!(LoadIcon::from_bytes(b"ICO1\x00\x00\x01\x00").is_none());
        assert!(LoadIcon::from_bytes(b"ICO1\x01\x01\x01\x00").is_none());
    }
}
