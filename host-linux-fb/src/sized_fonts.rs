//! Text at any pixel size. Baked atlases cover the framework's fixed sizes
//! (slots 0..15); a guest asks for another size with `onekvm.font(px, text)`
//! and gets a slot from 16..23 whose atlas is rasterized here, at that size,
//! from the packaged outline face. Advances, descent and line height follow
//! PocketJS's baker (framework/compiler/bake-font.ts). The cell's ascent is
//! tight to the requested characters' ink instead of the font ascender: the
//! core drops a glyph whose cell starts above the screen, so text placed by
//! its ink near the top edge would vanish at large sizes.
use std::collections::BTreeSet;

use pocket_ui_surface::UiSurface;
use pocketjs_core::spec::{font_atlas as fa, MAX_FONT_SLOTS};
use ttf_parser::Face;

use crate::dynamic_fonts;

/// The raster density of a bundle's baked atlases.
pub fn pak_density(pak: &[u8]) -> u8 {
    pocket_ui_surface::walk_pak(pak)
        .into_iter()
        .find(|entry| entry.key.starts_with("ui:font."))
        .and_then(|entry| pocketjs_core::text::Atlas::parse(entry.blob))
        .map_or(1, |atlas| atlas.raster_density)
}

/// First slot after the framework's pinned size table.
const FIRST_SLOT: u8 = 16;
const MIN_PX: f64 = 4.0;
const MAX_PX: f64 = 160.0;
/// Characters one sized slot keeps; text beyond this renders as tofu.
const MAX_CHARS: usize = 256;
/// Coverage bytes one sized atlas may allocate.
const MAX_ATLAS_BYTES: usize = 2 * 1024 * 1024;
const TOFU: u32 = 0xfffd;

/// Where text in a sized slot lands inside its Text box, in logical px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Metrics {
    pub line_height: u32,
    /// Box top to baseline for a single line (the core centers the glyph
    /// cell in the line).
    pub baseline: f32,
    /// Height of capitals and lining figures above the baseline.
    pub cap_height: f32,
}

struct Entry {
    /// Size in 1/100 px.
    size: u32,
    slot: u8,
    chars: BTreeSet<char>,
    metrics: Metrics,
    used: u64,
}

pub struct SizedFonts {
    surface: UiSurface,
    density: u8,
    entries: Vec<Entry>,
    clock: u64,
}

impl SizedFonts {
    /// `density` is the guest's raster density (its baked atlases' samples
    /// per logical px).
    pub fn new(surface: UiSurface, density: u8) -> Self {
        Self { surface, density: density.max(1), entries: Vec::new(), clock: 0 }
    }

    /// The slot holding `text` at `px`, rasterizing missing characters.
    /// The least recently requested size is reused once all eight slots
    /// are taken.
    pub fn request(&mut self, px: f64, text: &str) -> Option<(u8, Metrics)> {
        if !(MIN_PX..=MAX_PX).contains(&px) {
            return None;
        }
        let size = (px * 100.0).round() as u32;
        self.clock += 1;
        let wanted: BTreeSet<char> = text.chars().filter(|ch| !ch.is_control()).collect();
        let index = match self.entries.iter().position(|e| e.size == size) {
            Some(index) => index,
            None => {
                let slot = if self.entries.len() < (MAX_FONT_SLOTS - FIRST_SLOT as usize) {
                    FIRST_SLOT + self.entries.len() as u8
                } else {
                    let oldest = (0..self.entries.len()).min_by_key(|&i| self.entries[i].used)?;
                    self.entries.swap_remove(oldest).slot
                };
                self.entries.push(Entry {
                    size,
                    slot,
                    chars: BTreeSet::new(),
                    metrics: Metrics { line_height: 0, baseline: 0.0, cap_height: 0.0 },
                    used: 0,
                });
                self.entries.len() - 1
            }
        };
        let entry = &mut self.entries[index];
        entry.used = self.clock;
        if entry.metrics.line_height > 0 && wanted.is_subset(&entry.chars) {
            return Some((entry.slot, entry.metrics));
        }
        let mut chars = entry.chars.clone();
        for ch in wanted {
            if chars.len() >= MAX_CHARS {
                break;
            }
            chars.insert(ch);
        }
        let face = dynamic_fonts::font()?;
        let (blob, metrics) = bake(&face, entry.slot, size as f32 / 100.0, self.density, &chars)?;
        if !self.surface.with_ui(|ui| ui.load_font_atlas(&blob)) {
            return None;
        }
        entry.chars = chars;
        entry.metrics = metrics;
        Some((entry.slot, metrics))
    }
}

struct Baked {
    cp: u32,
    gid: ttf_parser::GlyphId,
    bounds: Option<ttf_parser::Rect>,
    advance: u8,
    xoff: f32,
}

/// One atlas blob for `chars` at `px` in `slot`, with the descent, line
/// height, advance and left-bearing rules of PocketJS's baker and the
/// baseline at the top of the tallest ink.
pub fn bake(face: &Face<'_>, slot: u8, px: f32, density: u8, chars: &BTreeSet<char>) -> Option<(Vec<u8>, Metrics)> {
    let scale = px / face.units_per_em() as f32;
    let ascent = face.ascender() as f32 * scale;
    let descent = -(face.descender() as f32) * scale;
    let line_height = (ascent + descent + face.line_gap() as f32 * scale).round().min(255.0);

    let mut glyphs = Vec::new();
    let mut ink_top: Option<f32> = None;
    for &ch in chars {
        let cp = ch as u32;
        if cp == TOFU {
            continue;
        }
        let Some(gid) = face.glyph_index(ch) else { continue };
        let advance = (face.glyph_hor_advance(gid).unwrap_or(0) as f32 * scale).round().clamp(0.0, 255.0) as u8;
        let bounds = face.glyph_bounding_box(gid);
        let xoff = bounds.map_or(0.0, |b| (-(b.x_min as f32) * scale).max(0.0).ceil().min(255.0));
        if let Some(b) = bounds {
            ink_top = Some(ink_top.unwrap_or(0.0).max(b.y_max as f32 * scale));
        }
        glyphs.push(Baked { cp, gid, bounds, advance, xoff });
    }
    let baseline = ink_top.map_or(ascent.round(), |top| top.ceil()).clamp(1.0, 255.0);
    let tofu_w = (px * 0.55).round().max(4.0);
    let mut cell_w = tofu_w;
    let mut cell_h = (baseline + descent.ceil()).clamp(1.0, 255.0);
    for g in &glyphs {
        if let Some(b) = g.bounds {
            cell_w = cell_w.max((b.x_max as f32 * scale + g.xoff).ceil());
            cell_h = cell_h.max((baseline - b.y_min as f32 * scale).ceil() + 1.0);
        }
    }
    if cell_w > 255.0 || cell_h > 255.0 {
        return None;
    }
    let (cell_w, cell_h) = (cell_w as usize, cell_h as usize);
    let slot_line_height = (line_height as usize).max(cell_h);
    let d = density as usize;
    let (coverage_w, coverage_h) = (cell_w * d, cell_h * d);
    let count = glyphs.len() + 1;
    let cell_bytes = coverage_w * coverage_h;
    if count > u16::MAX as usize || count.checked_mul(cell_bytes)? > MAX_ATLAS_BYTES {
        return None;
    }

    let mut out = Vec::with_capacity(fa::HEADER_SIZE + count * fa::CMAP_ENTRY_SIZE + count * cell_bytes);
    out.extend_from_slice(&fa::MAGIC.to_le_bytes());
    out.extend_from_slice(&fa::VERSION.to_le_bytes());
    out.extend_from_slice(&(count as u16).to_le_bytes());
    out.extend_from_slice(&[cell_w as u8, cell_h as u8, baseline as u8, slot_line_height as u8, slot, 0, density, 0]);

    // gid 0 is the tofu box, also mapped from U+FFFD; the rest follow in
    // code point order. The cmap is sorted by code point.
    let (tofu, tofu_advance) = tofu(cell_w, cell_h, baseline as usize, px, d);
    let mut cmap: Vec<(u32, u16, u8, u8)> = glyphs
        .iter()
        .enumerate()
        .map(|(i, g)| (g.cp, (i + 1) as u16, g.advance, g.xoff as u8))
        .collect();
    cmap.push((TOFU, 0, tofu_advance, 0));
    cmap.sort_by_key(|e| e.0);
    for (cp, gid, advance, xoff) in cmap {
        out.extend_from_slice(&cp.to_le_bytes());
        out.extend_from_slice(&gid.to_le_bytes());
        out.extend_from_slice(&[advance, xoff]);
    }
    out.extend_from_slice(&tofu);
    let density = density as f32;
    for g in &glyphs {
        // Blank glyphs (space) have no outline and stay transparent.
        let cell = dynamic_fonts::coverage(face, g.gid, coverage_w, coverage_h, scale * density, g.xoff * density, baseline * density)
            .unwrap_or_else(|| vec![0; cell_bytes]);
        out.extend_from_slice(&cell);
    }
    let cap_height = face.capital_height().map(|h| h as f32).unwrap_or(face.ascender() as f32 * 0.7) * scale;
    let metrics = Metrics {
        line_height: slot_line_height as u32,
        baseline: (slot_line_height - cell_h) as f32 * 0.5 + baseline,
        cap_height,
    };
    Some((out, metrics))
}

/// Hollow box for gid 0, as the baker draws it.
fn tofu(cell_w: usize, cell_h: usize, baseline: usize, px: f32, d: usize) -> (Vec<u8>, u8) {
    let (coverage_w, coverage_h) = (cell_w * d, cell_h * d);
    let mut out = vec![0; coverage_w * coverage_h];
    let w = ((px * 0.55).round() as usize).min(cell_w).max(4);
    let h = ((px * 0.7).round() as usize).max(5);
    let y1 = (baseline * d).saturating_sub(1).min(coverage_h - 1);
    let y0 = (y1 + 1).saturating_sub(h * d);
    let x1 = (w * d).saturating_sub(1);
    for inset in 0..d {
        if x1 < inset || y1 < y0 + inset {
            break;
        }
        for x in inset..=x1 - inset {
            out[(y0 + inset) * coverage_w + x] = 255;
            out[(y1 - inset) * coverage_w + x] = 255;
        }
        for y in y0 + inset..=y1 - inset {
            out[y * coverage_w + inset] = 255;
            out[y * coverage_w + x1 - inset] = 255;
        }
    }
    (out, (w + 2).min(255) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pocketjs_core::text::Atlas;

    fn face() -> Face<'static> {
        Face::parse(include_bytes!("../tests/fixtures/clock-glyphs.otf"), 0).unwrap()
    }

    fn chars(text: &str) -> BTreeSet<char> {
        text.chars().collect()
    }

    #[test]
    fn baked_slot_matches_the_framework_metrics() {
        // Noto Sans CJK SC: ascender 1160, descender -288, figures 555 wide
        // and 746 units tall at most.
        let (blob, metrics) = bake(&face(), 16, 16.0, 1, &chars("0123456789: AMP")).unwrap();
        let atlas = Atlas::parse(&blob).unwrap();
        assert_eq!(atlas.slot, 16);
        // The cell starts at the ink (11.9 px) and keeps the font's 4.6 px
        // descent; the line keeps the font's 23 px height.
        assert_eq!(atlas.baseline, 12);
        assert_eq!(atlas.cell_h, 17);
        assert_eq!(atlas.line_height, 23);
        assert_eq!(atlas.raster_density, 1);
        for digit in '0'..='9' {
            assert_eq!(atlas.lookup(digit as u32).unwrap().1, 9);
        }
        assert_eq!(atlas.lookup(':' as u32).unwrap().1, 4);
        assert_eq!(atlas.lookup(0xfffd).unwrap().0, 0);
        assert!((metrics.cap_height - 11.728).abs() < 0.01);
        assert_eq!(metrics.line_height, 23);
        assert_eq!(metrics.baseline, 15.0);
        let (gid, _) = atlas.lookup('8' as u32).unwrap();
        assert!(atlas.glyph_rows(gid).iter().any(|&c| c == 255));
        let (gid, _) = atlas.lookup(' ' as u32).unwrap();
        assert!(atlas.glyph_rows(gid).iter().all(|&c| c == 0));
    }

    #[test]
    fn any_size_rasterizes_at_that_size() {
        let mut previous = 0;
        for tenth in [83, 120, 184, 240, 320, 480] {
            let px = tenth as f32 / 10.0;
            let (blob, metrics) = bake(&face(), 17, px, 1, &chars("0")).unwrap();
            let atlas = Atlas::parse(&blob).unwrap();
            let (gid, advance) = atlas.lookup('0' as u32).unwrap();
            assert_eq!(advance as f32, (0.555 * px).round());
            let rows = atlas.glyph_rows(gid);
            let width = atlas.coverage_width() as usize;
            let inked = rows.chunks(width).filter(|row| row.iter().any(|&c| c > 127)).count();
            // The figure's ink is about 0.76 em tall.
            assert!((inked as f32 - 0.759 * px).abs() <= 1.5, "{px}: {inked}");
            assert!(inked > previous);
            previous = inked;
            assert!(metrics.baseline >= atlas.baseline as f32);
        }
    }

    #[test]
    fn density_two_keeps_logical_metrics() {
        let (one, _) = bake(&face(), 16, 24.0, 1, &chars("AM")).unwrap();
        let (two, _) = bake(&face(), 16, 24.0, 2, &chars("AM")).unwrap();
        let (one, two) = (Atlas::parse(&one).unwrap(), Atlas::parse(&two).unwrap());
        assert_eq!((one.cell_w, one.cell_h, one.baseline, one.line_height), (two.cell_w, two.cell_h, two.baseline, two.line_height));
        assert_eq!(two.coverage_width(), one.coverage_width() * 2);
        assert_eq!(one.lookup('M' as u32).unwrap().1, two.lookup('M' as u32).unwrap().1);
    }

    #[test]
    fn missing_characters_fall_back_to_tofu() {
        let (blob, _) = bake(&face(), 16, 20.0, 1, &chars("1字")).unwrap();
        let atlas = Atlas::parse(&blob).unwrap();
        assert!(atlas.lookup('1' as u32).is_some());
        assert!(atlas.lookup('字' as u32).is_none());
        assert!(atlas.glyph_rows(0).iter().any(|&c| c == 255));
    }

    #[test]
    fn large_text_near_the_top_keeps_its_cells_on_screen() {
        // The clock centers capitals 24 px below the top edge at 32 px.
        let (blob, metrics) = bake(&face(), 16, 32.0, 1, &chars("0123456789:AMP")).unwrap();
        let atlas = Atlas::parse(&blob).unwrap();
        let top = 24.0 - metrics.baseline + metrics.cap_height / 2.0;
        let cell_top = top + (atlas.line_height - atlas.cell_h) as f32 / 2.0;
        assert!(cell_top >= 0.0, "{cell_top}");
        assert!(atlas.line_height >= 46);
    }

    #[test]
    fn out_of_range_sizes_are_refused() {
        assert!(bake(&face(), 16, 400.0, 1, &chars("0")).is_none());
    }
}
