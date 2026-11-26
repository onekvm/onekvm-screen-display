//! A private raster target, independent of the framebuffer used for transitions.
use pocketjs_core::{
    damage::{DamagePlan, DamagePolicy, DamageRect, DamageTarget, DamageTracker},
    raster,
    resources::RenderResources,
};

#[derive(Default)]
pub struct RetainedFrame {
    pixels: Vec<u16>,
    window: Vec<u16>,
    tracker: DamageTracker,
}

impl RetainedFrame {
    pub fn render(&mut self, ui: &impl RenderResources, words: &[u32], dest: &mut [u16], background: u16) {
        let (width, height) = ui.viewport();
        let (width, height) = (width as usize, height as usize);
        assert_eq!(dest.len(), width * height);
        if self.pixels.len() != dest.len() {
            self.pixels.resize(dest.len(), background);
            self.tracker.invalidate();
        }
        let target = DamageTarget::new(width as u32, height as u32, 1, background as u64);
        let plan = self.tracker.prepare(ui, words, target)
            .and_then(|plan| plan.with_policy(DamagePolicy::default()));
        let valid = plan.is_ok();
        let plan = plan.unwrap_or_else(|_| DamagePlan::full(DamageRect::new(0, 0, width as i32, height as i32)));
        for rect in plan.regions() {
            let (x, y, w, h) = (rect.x0 as usize, rect.y0 as usize,
                (rect.x1 - rect.x0) as usize, (rect.y1 - rect.y0) as usize);
            self.window.resize(w * h, background);
            self.window.fill(background);
            // Replay painter order under a root clip. This also correctly
            // erases removed/moved translucent widgets and rounded corners.
            raster::render_scaled_rgb565_window_over(ui, words, &mut self.window, 1, *rect);
            for row in 0..h {
                self.pixels[(y + row) * width + x..(y + row) * width + x + w]
                    .copy_from_slice(&self.window[row * w..(row + 1) * w]);
            }
        }
        if valid { self.tracker.commit(ui, words, target); }
        else { self.tracker.invalidate(); }
        dest.copy_from_slice(&self.pixels);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pocketjs_core::{spec::draw_op, Ui};

    fn rect(x: u32, y: u32, w: u32, h: u32, color: u32) -> [u32; 4] {
        [draw_op::RECT, x | (y << 16), w | (h << 16), color]
    }

    #[test]
    fn changes_removal_and_background_match_full_compositing() {
        let mut ui = Ui::new();
        ui.set_viewport(40.0, 24.0);
        let mut retained = RetainedFrame::default();
        let mut output = vec![0; 40 * 24];
        for (x, color, removed, background) in [
            (2, 0x801122ee, false, 0x2945),
            (8, 0x8077ee11, false, 0x2945),
            (8, 0x8077ee11, true, 0x2945),
            (8, 0x8077ee11, true, 0x632c),
        ] {
            let mut words = rect(1, 1, 35, 20, 0x80332211).to_vec();
            if !removed { words.extend(rect(x, 5, 8, 7, color)); }
            let mut expected = vec![background; output.len()];
            raster::render_scaled_rgb565_over(&ui, &words, &mut expected, 1);
            retained.render(&ui, &words, &mut output, background);
            assert_eq!(output, expected);
            // Transitions mutate their own output, never our retained target.
            output.fill(0xffff);
            retained.render(&ui, &words, &mut output, background);
            assert_eq!(output, expected);
        }
    }

    #[test]
    fn geometry_change_with_same_pixel_count_invalidates_target() {
        let mut ui = Ui::new();
        let mut retained = RetainedFrame::default();
        let mut output = vec![0; 40 * 24];
        let words = rect(1, 1, 10, 8, 0xff1144ee);
        for (w, h) in [(40, 24), (24, 40)] {
            ui.set_viewport(w as f32, h as f32);
            let mut expected = vec![0x2945; output.len()];
            raster::render_scaled_rgb565_over(&ui, &words, &mut expected, 1);
            retained.render(&ui, &words, &mut output, 0x2945);
            assert_eq!(output, expected);
        }
    }
}
