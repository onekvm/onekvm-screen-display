//! Merge plugin-owned title glyphs into the launcher's own font slots.
//! Rebuild from the base PAK on each catalog change so removed glyphs are freed.
use pocket_ui_surface::{walk_pak, UiSurface};
use pocketjs_core::{spec::font_atlas as fa, text::Atlas};
use std::collections::BTreeMap;

fn font_entries(pak: &[u8]) -> Vec<&[u8]> {
    walk_pak(pak)
        .into_iter()
        .filter(|entry| entry.key.starts_with("ui:font."))
        .map(|entry| entry.blob)
        .collect()
}

pub fn refresh(surface: &UiSurface, base: &[u8]) {
    refresh_with(surface, base, |_, _| {});
}

pub(crate) fn refresh_with(
    surface: &UiSurface,
    base: &[u8],
    mut augment: impl FnMut(&Atlas, &mut BTreeMap<u32, Glyph>),
) {
    let packs = crate::apps::launcher_fonts();
    for blob in font_entries(base) {
        let Some(base) = Atlas::parse(blob) else {
            continue;
        };
        let mut additions = BTreeMap::new();
        for (path, text) in &packs {
            let missing: Vec<_> = text.chars().map(|ch| ch as u32)
                .filter(|cp| base.lookup(*cp).is_none() && !additions.contains_key(cp)).collect();
            if missing.is_empty() { continue; }
            if std::fs::metadata(path).map_or(true, |meta| meta.len() > 64 * 1024 * 1024) { continue; }
            let Ok(pak) = crate::file_blob::FileBlob::open(path) else { continue; };
            let mut sources = font_entries(&pak);
            sources.sort_by_key(|blob| blob.get(12).copied() != Some(base.slot));
            for blob in sources {
                if missing.iter().all(|cp| additions.contains_key(cp)) { break; }
                let Some(source) = Atlas::parse(blob) else { continue; };
                for cp in text.chars().map(|ch| ch as u32) {
                    if base.lookup(cp).is_some() || additions.contains_key(&cp) {
                        continue;
                    }
                    if let Some(entry) = source.lookup_entry(cp) {
                        let scale = base.line_height as f32 / source.line_height.max(1) as f32;
                        let density = base.raster_density as usize;
                        let width = base.cell_w as usize * density;
                        let height = base.cell_h as usize * density;
                        let mut pixels = vec![0; width * height];
                        let source_pixels = source.glyph_rows(entry.gid);
                        for y in 0..height {
                            let sy = ((y as f32 / density as f32 - base.baseline as f32) / scale
                                + source.baseline as f32)
                                * source.raster_density as f32;
                            for x in 0..width {
                                let sx = x as f32 / density as f32 / scale
                                    * source.raster_density as f32;
                                if sx >= 0.0
                                    && sy >= 0.0
                                    && sx < source.coverage_width() as f32
                                    && sy < source.coverage_height() as f32
                                {
                                    pixels[y * width + x] = source_pixels[sy as usize
                                        * source.coverage_width() as usize
                                        + sx as usize];
                                }
                            }
                        }
                        additions.insert(
                            cp,
                            Glyph {
                                width: base.cell_w,
                                height: base.cell_h,
                                baseline: base.baseline,
                                density: base.raster_density,
                                advance: (entry.advance as f32 * scale).round().clamp(0.0, 255.0)
                                    as u8,
                                xoff: (entry.xoff as f32 * scale).round().clamp(0.0, 255.0) as u8,
                                pixels,
                            },
                        );
                    }
                }
            }
        }
        augment(&base, &mut additions);
        if additions.is_empty() {
            surface.with_ui(|ui| { ui.load_font_atlas(blob); });
            continue;
        }
        if let Some(merged) = merge(blob, &base, additions) {
            surface.with_ui(|ui| {
                ui.load_font_atlas(&merged);
            });
        }
    }
}

pub(crate) struct Glyph {
    pub width: u32,
    pub height: u32,
    pub baseline: u32,
    pub density: u8,
    pub advance: u8,
    pub xoff: u8,
    pub pixels: Vec<u8>,
}

pub(crate) fn merge(blob: &[u8], base: &Atlas, additions: BTreeMap<u32, Glyph>) -> Option<Vec<u8>> {
    let width = additions
        .values()
        .map(|g| g.width)
        .max()
        .unwrap_or(0)
        .max(base.cell_w);
    let baseline = additions
        .values()
        .map(|g| g.baseline)
        .max()
        .unwrap_or(0)
        .max(base.baseline);
    let below = additions
        .values()
        .map(|g| g.height.saturating_sub(g.baseline))
        .max()
        .unwrap_or(0)
        .max(base.cell_h.saturating_sub(base.baseline));
    let height = baseline + below;
    if width > 255 || height > 255 {
        return None;
    }
    let mut glyphs = BTreeMap::new();
    for index in 0..base.glyph_count as usize {
        let offset = fa::HEADER_SIZE + index * fa::CMAP_ENTRY_SIZE;
        let cp = u32::from_le_bytes(blob.get(offset..offset + 4)?.try_into().ok()?);
        let entry = base.lookup_entry(cp)?;
        glyphs.insert(
            cp,
            Glyph {
                width: base.cell_w,
                height: base.cell_h,
                baseline: base.baseline,
                density: base.raster_density,
                advance: entry.advance,
                xoff: entry.xoff,
                pixels: base.glyph_rows(entry.gid).to_vec(),
            },
        );
    }
    glyphs.extend(additions);
    let count = glyphs.len().checked_add(1)?;
    let density = base.raster_density as usize;
    let stride = width as usize * density;
    let cell = stride.checked_mul(height as usize * density)?;
    if count > u16::MAX as usize || count.checked_mul(cell)? > 32 * 1024 * 1024 {
        return None;
    }
    let mut out = vec![0; fa::HEADER_SIZE];
    out[..4].copy_from_slice(&fa::MAGIC.to_le_bytes());
    out[4..6].copy_from_slice(&fa::VERSION.to_le_bytes());
    out[6..8].copy_from_slice(&(count as u16).to_le_bytes());
    out[8..15].copy_from_slice(&[
        width as u8,
        height as u8,
        baseline as u8,
        base.line_height as u8,
        base.slot,
        base.flags,
        base.raster_density,
    ]);
    // Reserve gid 0 for the base atlas's missing-glyph box.
    out.extend_from_slice(&[0; fa::CMAP_ENTRY_SIZE]);
    for (index, (cp, glyph)) in glyphs.iter().enumerate() {
        out.extend_from_slice(&cp.to_le_bytes());
        out.extend_from_slice(&((index + 1) as u16).to_le_bytes());
        out.extend_from_slice(&[glyph.advance, glyph.xoff]);
    }
    let tofu = Glyph {
        width: base.cell_w,
        height: base.cell_h,
        baseline: base.baseline,
        density: base.raster_density,
        advance: 0,
        xoff: 0,
        pixels: base.glyph_rows(0).to_vec(),
    };
    for glyph in std::iter::once(&tofu).chain(glyphs.values()) {
        let start = out.len();
        out.resize(start + cell, 0);
        for y in 0..glyph.height as usize * density {
            let dst_y = y + (baseline - glyph.baseline) as usize * density;
            for x in 0..glyph.width as usize * density {
                let src_x = x * glyph.density as usize / density;
                let src_y = y * glyph.density as usize / density;
                out[start + dst_y * stride + x] =
                    glyph.pixels[src_y * glyph.width as usize * glyph.density as usize + src_x];
            }
        }
    }
    // The synthetic gid-0 cmap entry must precede the sorted Unicode entries.
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_unicode_titles_merge_without_rebuilding_and_removal_restores_base() {
        let mut blob = vec![0; fa::HEADER_SIZE];
        blob[..4].copy_from_slice(&fa::MAGIC.to_le_bytes());
        blob[4..6].copy_from_slice(&fa::VERSION.to_le_bytes());
        blob[6..8].copy_from_slice(&1u16.to_le_bytes());
        blob[8..15].copy_from_slice(&[1, 1, 1, 2, 0, 0, 1]);
        blob.extend_from_slice(&('A' as u32).to_le_bytes());
        blob.extend_from_slice(&[0, 0, 1, 0, 255]);
        let base = Atlas::parse(&blob).unwrap();
        let additions = [(
            '新' as u32,
            Glyph {
                width: 1,
                height: 1,
                baseline: 1,
                density: 1,
                advance: 1,
                xoff: 0,
                pixels: vec![123],
            },
        )]
        .into();
        let merged = Atlas::parse(&merge(&blob, &base, additions).unwrap()).unwrap();
        assert_eq!(merged.lookup('A' as u32).unwrap().1, 1);
        assert_eq!(
            merged.glyph_rows(merged.lookup('新' as u32).unwrap().0),
            [123]
        );
        let removed = Atlas::parse(&merge(&blob, &base, BTreeMap::new()).unwrap()).unwrap();
        assert!(removed.lookup('新' as u32).is_none());
    }
}
