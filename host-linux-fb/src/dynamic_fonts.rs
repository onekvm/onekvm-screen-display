//! Runtime network names cannot be collected into the build-time UI atlases.
//! Keep the outline face file-backed; retain only the currently needed glyphs.
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::sync::{Arc, OnceLock};

use ab_glyph_rasterizer::{point, Point, Rasterizer};
use memmap2::Mmap;
use pocket_ui_surface::UiSurface;
use pocketjs_core::text::Atlas;
use ttf_parser::{Face, OutlineBuilder};

use crate::launcher_fonts::{self, Glyph};

const MAX_CHARS: usize = 1024;
const MAX_VALUE_CHARS: usize = 8192;
static FONT: OnceLock<Option<Mmap>> = OnceLock::new();

fn font() -> Option<Face<'static>> {
    let bytes = FONT
        .get_or_init(|| {
            for root in crate::dist_roots() {
                let Ok(file) = File::open(root.join("fallback-font.bin")) else {
                    continue;
                };
                if !file
                    .metadata()
                    .ok()
                    .is_some_and(|m| m.len() <= 32 * 1024 * 1024)
                {
                    continue;
                }
                // Packaged outline files are immutable for this process's lifetime.
                let Ok(map) = (unsafe { Mmap::map(&file) }) else {
                    continue;
                };
                if Face::parse(&map, 0).is_ok() {
                    return Some(map);
                }
            }
            log::warn!("network name fallback font unavailable");
            None
        })
        .as_ref()?;
    Face::parse(bytes, 0).ok()
}

pub struct NetworkFonts {
    bundle: Arc<crate::Bundle>,
    surface: UiSurface,
    sources: BTreeMap<String, String>,
    chars: BTreeSet<char>,
    generation: Option<u32>,
}

impl NetworkFonts {
    pub fn new(bundle: Arc<crate::Bundle>, surface: UiSurface) -> Self {
        Self {
            bundle,
            surface,
            sources: BTreeMap::new(),
            chars: BTreeSet::new(),
            generation: None,
        }
    }

    pub fn update(&mut self, key: &str, value: &str, generation: u32) {
        if !matches!(key, "wifiScan" | "wifiSsid" | "wifiAp" | "wifiSetup" | "mediaNames" | "mediaBrowseNames") {
            return;
        }
        let unchanged = self.sources.get(key).is_some_and(|old| old == value);
        if unchanged && self.generation == Some(generation) {
            return;
        }
        self.sources
            .insert(key.into(), value.chars().take(MAX_VALUE_CHARS).collect());
        let chars: BTreeSet<_> = self
            .sources
            .values()
            .flat_map(|s| s.chars())
            .filter(|ch| !ch.is_ascii() && !ch.is_control())
            .take(MAX_CHARS)
            .collect();
        if chars == self.chars && self.generation == Some(generation) {
            return;
        }
        let needed = !chars.is_empty() || !self.chars.is_empty();
        self.chars = chars;
        self.generation = Some(generation);
        if !needed {
            return;
        }
        let Some(face) = font() else {
            return;
        };
        launcher_fonts::refresh_with(&self.surface, &self.bundle.pak, |base, additions| {
            for &ch in &self.chars {
                let cp = ch as u32;
                if base.lookup(cp).is_some() || additions.contains_key(&cp) {
                    continue;
                }
                if let Some(glyph) = rasterize(&face, base, ch) {
                    additions.insert(cp, glyph);
                }
            }
        });
    }
}

fn pixel_size(slot: u8) -> f32 {
    const SIZES: [f32; 7] = [12., 14., 16., 18., 20., 24., 36.];
    match slot {
        0..=6 => SIZES[slot as usize],
        7..=13 => SIZES[slot as usize - 7],
        14 | 15 => 54.,
        _ => 14.,
    }
}

fn rasterize(face: &Face<'_>, base: &Atlas, ch: char) -> Option<Glyph> {
    let gid = face.glyph_index(ch)?;
    let bounds = face.glyph_bounding_box(gid)?;
    let scale = pixel_size(base.slot) / face.units_per_em() as f32;
    let density = base.raster_density as f32;
    let xoff = (-bounds.x_min as f32 * scale).max(0.).ceil();
    let width = base
        .cell_w
        .max((bounds.x_max as f32 * scale + xoff).ceil() as u32);
    let height = base
        .cell_h
        .max((base.baseline as f32 - bounds.y_min as f32 * scale).ceil() as u32);
    if width > 255 || height > 255 {
        return None;
    }
    let (w, h) = (
        width as usize * base.raster_density as usize,
        height as usize * base.raster_density as usize,
    );
    let mut outline = Outline {
        raster: Rasterizer::new(w, h),
        scale: scale * density,
        xoff: xoff * density,
        baseline: base.baseline as f32 * density,
        start: point(0., 0.),
        last: point(0., 0.),
    };
    face.outline_glyph(gid, &mut outline)?;
    let mut pixels = vec![0; w * h];
    outline
        .raster
        .for_each_pixel(|i, coverage| pixels[i] = (coverage.clamp(0., 1.) * 255.).round() as u8);
    Some(Glyph {
        width,
        height,
        baseline: base.baseline,
        density: base.raster_density,
        advance: (face.glyph_hor_advance(gid)? as f32 * scale)
            .round()
            .clamp(0., 255.) as u8,
        xoff: xoff.min(255.) as u8,
        pixels,
    })
}

struct Outline {
    raster: Rasterizer,
    scale: f32,
    xoff: f32,
    baseline: f32,
    start: Point,
    last: Point,
}

impl Outline {
    fn point(&self, x: f32, y: f32) -> Point {
        point(x * self.scale + self.xoff, self.baseline - y * self.scale)
    }
}

impl OutlineBuilder for Outline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.start = self.point(x, y);
        self.last = self.start;
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let end = self.point(x, y);
        self.raster.draw_line(self.last, end);
        self.last = end;
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let end = self.point(x, y);
        self.raster.draw_quad(self.last, self.point(x1, y1), end);
        self.last = end;
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let end = self.point(x, y);
        self.raster
            .draw_cubic(self.last, self.point(x1, y1), self.point(x2, y2), end);
        self.last = end;
    }
    fn close(&mut self) {
        self.raster.draw_line(self.last, self.start);
        self.last = self.start;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pocketjs_core::spec::font_atlas as fa;

    fn base(slot: u8) -> Vec<u8> {
        let mut blob = vec![0; fa::HEADER_SIZE];
        blob[..4].copy_from_slice(&fa::MAGIC.to_le_bytes());
        blob[4..6].copy_from_slice(&fa::VERSION.to_le_bytes());
        blob[6..8].copy_from_slice(&1u16.to_le_bytes());
        blob[8..15].copy_from_slice(&[16, 25, 19, 25, slot, 0, 1]);
        blob.extend_from_slice(&0xfffdu32.to_le_bytes());
        blob.extend_from_slice(&[0, 0, 8, 0]);
        blob.extend_from_slice(&[0; 16 * 25]);
        blob
    }

    #[test]
    fn dynamic_names_cover_simplified_traditional_accents_and_non_bmp() {
        // A tiny subset of the packaged OFL Noto face; no system fonts needed.
        let face = Face::parse(include_bytes!("../tests/fixtures/network-names.otf"), 0).unwrap();
        let blob = base(2);
        let atlas = Atlas::parse(&blob).unwrap();
        let mut additions = BTreeMap::new();
        for ch in "咖啡馆網絡é𠮷".chars() {
            assert!(atlas.lookup(ch as u32).is_none());
            let glyph = rasterize(&face, &atlas, ch).unwrap();
            assert!(glyph.pixels.iter().any(|&p| p > 0));
            assert!(glyph.pixels.iter().any(|&p| p > 0 && p < 255));
            if ch != 'é' {
                assert_eq!(glyph.advance, 16);
            }
            additions.insert(ch as u32, glyph);
        }
        let merged = launcher_fonts::merge(&blob, &atlas, additions).unwrap();
        let merged = Atlas::parse(&merged).unwrap();
        for ch in "咖啡馆網絡é𠮷".chars() {
            let (gid, advance) = merged.lookup(ch as u32).unwrap();
            assert_ne!(gid, 0);
            assert!(advance > 0);
        }
    }

    #[test]
    fn rebuilt_atlas_releases_old_network_names() {
        let face = Face::parse(include_bytes!("../tests/fixtures/network-names.otf"), 0).unwrap();
        let blob = base(1);
        let atlas = Atlas::parse(&blob).unwrap();
        for ch in ['咖', '網', '𠮷'] {
            let additions = [(ch as u32, rasterize(&face, &atlas, ch).unwrap())].into();
            let merged = launcher_fonts::merge(&blob, &atlas, additions).unwrap();
            let merged = Atlas::parse(&merged).unwrap();
            assert_eq!(merged.glyph_count, 3); // original tofu + synthetic gid 0 + new glyph
            assert!(merged.lookup(ch as u32).is_some());
            for other in ['咖', '網', '𠮷'] {
                if other != ch {
                    assert!(merged.lookup(other as u32).is_none());
                }
            }
        }
    }
}
