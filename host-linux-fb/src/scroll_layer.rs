//! Rasterize a complete list once; motion only samples its cached pixels.
use pocketjs_core::{
    damage::{DamagePolicy, DamageRect, DamageTracker},
    raster,
    resources::{FontView, RenderResources},
    spec, TexView, Ui,
};

#[derive(Clone, Copy, Debug)]
pub struct ScrollCapture {
    pub node: i32,
    pub parent: i32,
    pub offset: usize,
    pub height: usize,
}

impl ScrollLayer {
    /// Reuse the full-list raster for the target viewport. Only fixed chrome
    /// needs another raster pass; never rasterize the list a second time.
    pub fn paint_target(&self, ui: &Ui, words: &[u32], pixels: &mut [u16]) {
        let (width, height) = ui.viewport();
        let (width, height) = (width as usize, height as usize);
        let y = self.viewport.0.min(height);
        let end = y.saturating_add(self.viewport.1).min(height);
        pixels[y * width..end * width]
            .copy_from_slice(&self.pixels[self.offset * width..(self.offset + end - y) * width]);
        raster::render_scaled_rgb565_regions(
            ui,
            words,
            pixels,
            1,
            &[
                DamageRect::new(0, 0, width as i32, y as i32),
                DamageRect::new(0, end as i32, width as i32, height as i32),
            ],
        );
    }
}

pub struct ScrollLayer {
    pub pixels: Vec<u16>,
    pub node: i32,
    pub offset: usize,
    pub height: usize,
    pub viewport: (usize, usize),
    /// DrawList diff for this strip. Reused only while `node` and pixel size match.
    pub damage: DamageTracker,
}

struct LayerResources<'a> {
    ui: &'a Ui,
    size: (f32, f32),
}

impl RenderResources for LayerResources<'_> {
    fn viewport(&self) -> (f32, f32) {
        self.size
    }
    fn raster_revision(&self) -> u64 {
        self.ui.raster_revision()
    }
    fn texture(&self, handle: i32) -> Option<TexView<'_>> {
        self.ui.texture(handle)
    }
    fn font_atlas(&self, slot: u8) -> Option<FontView<'_>> {
        RenderResources::font_atlas(self.ui, slot)
    }
}

fn reused_layer(
    previous: Option<ScrollLayer>,
    node: i32,
    width: usize,
    height: usize,
) -> ScrollLayer {
    if let Some(layer) = previous {
        if layer.node == node && layer.height == height && layer.pixels.len() == width * height {
            return layer;
        }
    }
    ScrollLayer {
        pixels: vec![0; width * height],
        node,
        offset: 0,
        height,
        viewport: (0, 0),
        damage: DamageTracker::new(),
    }
}

fn rasterize_strip(layer: &mut ScrollLayer, ui: &Ui, words: &[u32], width: f32, height: usize) {
    let resources = LayerResources {
        ui,
        size: (width, height as f32),
    };
    // A highlight changes two rows. Keep that under the full-redraw threshold
    // so a fast detent does not clear the whole strip.
    match raster::render_scaled_rgb565_incremental(
        &resources,
        words,
        &mut layer.pixels,
        1,
        &mut layer.damage,
        DamagePolicy::new(50),
    ) {
        Ok(plan) => {
            log::debug!(
                "scroll capture node={} regions={} full={}",
                layer.node,
                plan.region_count(),
                plan.is_full_redraw()
            );
        }
        Err(error) => {
            log::debug!("scroll capture incremental failed: {error:?}; full raster");
            layer.damage.invalidate();
            raster::render_scaled_rgb565(&resources, words, &mut layer.pixels, 1);
        }
    }
}

pub fn capture(
    ui: &mut Ui,
    request: ScrollCapture,
    viewport: (usize, usize),
    previous: Option<ScrollLayer>,
) -> Option<ScrollLayer> {
    // Bound untrusted bridge requests and reject stale mirrors. No guest JS
    // runs while the subtree is temporarily attached to the offscreen root.
    let (_, _, _, laid_out_height) = ui.layout_of(request.node)?;
    ui.layout_of(request.parent)?;
    let style = ui.resolved_style(request.node)?;
    let (width, _) = ui.viewport();
    let height = request
        .height
        .max(laid_out_height.ceil() as usize)
        .max(request.offset.checked_add(viewport.1)?);
    if height == 0 || height > 8192 || request.node <= spec::ROOT_ID {
        return None;
    }

    // The host owns the visible fade. Finish the short native colour tracks
    // without re-running JS or rasterizing their intermediate frames. This
    // also settles a page slide interrupted by a new rotary list input.
    for _ in 0..20 {
        ui.tick();
    }
    let root = ui.create_auxiliary_surface(width, height as f32);
    if root == 0 {
        return None;
    }
    ui.insert_before(root, request.node, 0);
    ui.set_prop(request.node, spec::prop::TRANSLATE_Y, 0.0);
    // The root was just created, so this draw always exists. Restore the
    // live tree before returning even if a future renderer rejects it.
    let words = ui.draw_auxiliary().map(|list| list.words.clone());
    let mut layer = reused_layer(previous, request.node, width as usize, height);
    if let Some(words) = &words {
        rasterize_strip(&mut layer, ui, words, width, height);
    }
    ui.insert_before(request.parent, request.node, 0);
    ui.set_prop(
        request.node,
        spec::prop::TRANSLATE_Y,
        style.translate_y as f64,
    );
    words?;
    layer.node = request.node;
    layer.offset = request.offset;
    layer.height = height;
    layer.viewport = viewport;
    Some(layer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_offscreen_rows_and_restores_live_tree() {
        let mut ui = Ui::new();
        ui.set_viewport(2.0, 4.0);
        let header = ui.create_node(spec::NodeType::View as u8);
        ui.set_prop(header, spec::prop::WIDTH, 2.0);
        ui.set_prop(header, spec::prop::HEIGHT, 1.0);
        ui.set_prop(header, spec::prop::BG_COLOR, 0xff0000ffu32 as f64);
        ui.insert_before(spec::ROOT_ID, header, 0);
        let viewport = ui.create_node(spec::NodeType::View as u8);
        ui.set_prop(viewport, spec::prop::WIDTH, 2.0);
        ui.set_prop(viewport, spec::prop::HEIGHT, 3.0);
        ui.set_prop(viewport, spec::prop::OVERFLOW, 1.0);
        ui.insert_before(spec::ROOT_ID, viewport, 0);
        let list = ui.create_node(spec::NodeType::View as u8);
        ui.set_prop(list, spec::prop::WIDTH, 2.0);
        ui.set_prop(list, spec::prop::HEIGHT, 6.0);
        ui.set_prop(list, spec::prop::FLEX_DIR, spec::FlexDir::Col as u32 as f64);
        ui.set_prop(list, spec::prop::SHRINK, 0.0);
        ui.set_prop(list, spec::prop::TRANSLATE_Y, -3.0);
        ui.insert_before(viewport, list, 0);
        for color in [0xff0000ffu32, 0xff00ff00] {
            let row = ui.create_node(spec::NodeType::View as u8);
            ui.set_prop(row, spec::prop::WIDTH, 2.0);
            ui.set_prop(row, spec::prop::HEIGHT, 3.0);
            ui.set_prop(row, spec::prop::SHRINK, 0.0);
            ui.set_prop(row, spec::prop::BG_COLOR, color as f64);
            ui.insert_before(list, row, 0);
        }
        ui.tick();
        let before = ui.draw().words.clone();
        let layer = capture(
            &mut ui,
            ScrollCapture {
                node: list,
                parent: viewport,
                offset: 3,
                height: 6,
            },
            (1, 3),
            None,
        )
        .unwrap();
        assert_eq!(&layer.pixels[..6], &[0xf800; 6]);
        assert_eq!(&layer.pixels[6..], &[0x07e0; 6]);
        assert_eq!(ui.resolved_style(list).unwrap().translate_y, -3.0);
        assert_eq!(ui.draw().words, before);
        let mut target = vec![0; 8];
        let words = ui.draw().words.clone();
        layer.paint_target(&ui, &words, &mut target);
        let mut expected = vec![0; 8];
        raster::render_scaled_rgb565(&ui, &words, &mut expected, 1);
        assert_eq!(target, expected, "cached crop differs from live viewport");
        assert_eq!(&target[..2], &[0xf800; 2], "fixed chrome was not repainted");
    }

    #[test]
    fn capture_settles_colour_without_another_guest_frame() {
        let mut ui = Ui::new();
        ui.set_viewport(2.0, 3.0);
        let list = ui.create_node(spec::NodeType::View as u8);
        ui.set_prop(list, spec::prop::WIDTH, 2.0);
        ui.set_prop(list, spec::prop::HEIGHT, 3.0);
        ui.set_prop(list, spec::prop::BG_COLOR, 0xff0000ffu32 as f64);
        ui.insert_before(spec::ROOT_ID, list, 0);
        ui.tick();
        ui.animate(list, spec::prop::BG_COLOR, 0xff00ff00u32 as f64, 160, 0, 0);
        let layer = capture(
            &mut ui,
            ScrollCapture {
                node: list,
                parent: spec::ROOT_ID,
                offset: 0,
                height: 3,
            },
            (0, 3),
            None,
        )
        .unwrap();
        assert_eq!(layer.pixels, [0x07e0; 6]);
    }

    #[test]
    fn recapture_repaints_only_the_changed_row() {
        let mut ui = Ui::new();
        ui.set_viewport(2.0, 8.0);
        let list = ui.create_node(spec::NodeType::View as u8);
        ui.set_prop(list, spec::prop::WIDTH, 2.0);
        ui.set_prop(list, spec::prop::HEIGHT, 8.0);
        ui.set_prop(list, spec::prop::FLEX_DIR, spec::FlexDir::Col as u32 as f64);
        ui.set_prop(list, spec::prop::SHRINK, 0.0);
        ui.insert_before(spec::ROOT_ID, list, 0);
        let mut rows = Vec::new();
        for color in [0xff0000ffu32, 0xff00ff00, 0xff0000ff, 0xff00ff00] {
            let row = ui.create_node(spec::NodeType::View as u8);
            ui.set_prop(row, spec::prop::WIDTH, 2.0);
            ui.set_prop(row, spec::prop::HEIGHT, 2.0);
            ui.set_prop(row, spec::prop::SHRINK, 0.0);
            ui.set_prop(row, spec::prop::BG_COLOR, color as f64);
            ui.insert_before(list, row, 0);
            rows.push(row);
        }
        ui.tick();
        let request = ScrollCapture {
            node: list,
            parent: spec::ROOT_ID,
            offset: 0,
            height: 8,
        };
        let first = capture(&mut ui, request, (0, 8), None).unwrap();
        let mut reused = first;
        // An unchanged row must survive. A full clear would erase this marker.
        reused.pixels[0] = 0x1234;
        ui.set_prop(rows[3], spec::prop::BG_COLOR, 0xffff0000u32 as f64);
        let second = capture(&mut ui, request, (0, 8), Some(reused)).unwrap();
        assert_eq!(second.pixels[0], 0x1234, "unchanged row was cleared");
        let fresh = capture(&mut ui, request, (0, 8), None).unwrap();
        assert_eq!(&second.pixels[12..16], &fresh.pixels[12..16]);
        assert_eq!(&second.pixels[1..12], &fresh.pixels[1..12]);
        assert_ne!(fresh.pixels[0], 0x1234);
    }
}
