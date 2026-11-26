use crate::scroll_layer::ScrollLayer;
use std::time::{Duration, Instant};

const PAGE_TRANSITION_MS: u64 = 280;
// Keep a rotary reveal inside the direct-manipulation response window. The
// host credits only a small part of target raster time, leaving enough
// visible intermediate frames to preserve spatial continuity.
const SCROLL_TRANSITION_MS: u64 = 80;
const DRAWER_ENTER_MS: u64 = 176;
const DRAWER_EXIT_MS: u64 = 128;
const DRAWER_SCRIM_OPACITY: f32 = 0.45;

#[derive(Clone, Copy)]
struct Region {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
}

#[derive(Clone, Copy)]
enum Axis {
    Horizontal,
    ShellHorizontal,
    Vertical(Region),
    Drawer { top: usize },
}

/// A cached, host-composited transition between two complete app frames.
pub struct PageTransition {
    from: Vec<u16>,
    to: Vec<u16>,
    forward: bool,
    axis: Axis,
    distance: usize,
    duration: Duration,
    started: Instant,
    frames: u32,
    scroll_layer: Option<ScrollLayer>,
    scroll_from: usize,
    scroll_visible: usize,
}

impl PageTransition {
    pub fn new(from: Vec<u16>, to: Vec<u16>, direction: i32, started: Instant) -> Self {
        debug_assert_eq!(from.len(), to.len());
        Self {
            from,
            to,
            forward: direction >= 0,
            axis: Axis::Horizontal,
            distance: 0,
            duration: Duration::from_millis(PAGE_TRANSITION_MS),
            started,
            frames: 0,
            scroll_layer: None,
            scroll_from: 0,
            scroll_visible: 0,
        }
    }

    pub fn new_vertical(
        from: Vec<u16>,
        to: Vec<u16>,
        direction: i32,
        distance: usize,
        region: (usize, usize, usize, usize),
        started: Instant,
    ) -> Self {
        debug_assert_eq!(from.len(), to.len());
        Self {
            from,
            to,
            forward: direction >= 0,
            axis: Axis::Vertical(Region {
                x: region.0,
                y: region.1,
                width: region.2,
                height: region.3,
            }),
            distance: distance.min(32000),
            duration: Duration::from_millis(SCROLL_TRANSITION_MS),
            started,
            frames: 0,
            scroll_layer: None,
            scroll_from: 0,
            scroll_visible: 0,
        }
    }

    /// The Shell jumps its guest strip to the target once; all intermediate
    /// frames, including interrupted/reversed turns, belong to the host.
    pub fn new_shell(from: Vec<u16>, to: Vec<u16>, direction: i32, started: Instant) -> Self {
        let mut transition = Self::new(from, to, direction, started);
        transition.axis = Axis::ShellHorizontal;
        transition
    }

    pub fn new_list(
        from: Vec<u16>,
        to: Vec<u16>,
        layer: ScrollLayer,
        from_offset: usize,
        region: (usize, usize, usize, usize),
        started: Instant,
    ) -> Self {
        let mut transition = Self::new_vertical(from, to, 1, 0, region, started);
        let from_offset = from_offset.min(layer.height.saturating_sub(region.3));
        transition.scroll_from = from_offset;
        transition.scroll_visible = from_offset;
        transition.scroll_layer = Some(layer);
        transition
    }

    /// Hand the cached strip back to the session so the next detent can
    /// repaint only the rows that changed.
    pub fn take_scroll_layer(&mut self) -> Option<ScrollLayer> {
        self.scroll_layer.take()
    }

    /// Actual last-presented content coordinate, not the old settled target.
    pub fn scroll_position(&self) -> Option<(i32, usize)> {
        self.scroll_layer
            .as_ref()
            .map(|layer| (layer.node, self.scroll_visible))
    }

    pub fn new_drawer(
        from: Vec<u16>,
        to: Vec<u16>,
        opening: bool,
        top: usize,
        started: Instant,
    ) -> Self {
        debug_assert_eq!(from.len(), to.len());
        Self {
            from,
            to,
            forward: opening,
            axis: Axis::Drawer { top },
            distance: 0,
            duration: Duration::from_millis(if opening {
                DRAWER_ENTER_MS
            } else {
                DRAWER_EXIT_MS
            }),
            started,
            frames: 0,
            scroll_layer: None,
            scroll_from: 0,
            scroll_visible: 0,
        }
    }

    /// Paint the frame for `now`; returns true once the target is fully visible.
    pub fn paint(&mut self, out: &mut [u16], width: usize, height: usize, now: Instant) -> bool {
        self.frames = self.frames.saturating_add(1);
        let elapsed = now.saturating_duration_since(self.started);
        if elapsed >= self.duration {
            self.finish(out);
            if let Some(layer) = &self.scroll_layer {
                self.scroll_visible = layer.offset;
            }
            return true;
        }
        let t = elapsed.as_secs_f32() / self.duration.as_secs_f32();
        let eased = 1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(2);
        match self.axis {
            Axis::Horizontal | Axis::ShellHorizontal => {
                let slide = ((width as f32) * eased).round() as i32;
                if self.forward {
                    blit_slide(out, &self.from, &self.to, slide, width, height);
                } else {
                    blit_slide(
                        out,
                        &self.to,
                        &self.from,
                        width as i32 - slide,
                        width,
                        height,
                    );
                }
            }
            Axis::Vertical(region) => {
                // Keep fixed chrome at its target position and only slide the
                // content viewport.
                out.copy_from_slice(&self.to);
                if let Some(layer) = &self.scroll_layer {
                    self.scroll_visible = (self.scroll_from as f32
                        + (layer.offset as f32 - self.scroll_from as f32) * eased)
                        .round() as usize;
                    blit_list(
                        out,
                        &self.from,
                        layer,
                        self.scroll_from,
                        self.scroll_visible,
                        eased,
                        width,
                        height,
                        region,
                    );
                } else {
                    blit_scroll(
                        out,
                        &self.from,
                        &self.to,
                        self.distance,
                        eased,
                        width,
                        height,
                        region,
                        self.forward,
                    );
                }
            }
            Axis::Drawer { top } => {
                blit_drawer(
                    out,
                    &self.from,
                    &self.to,
                    eased,
                    width,
                    height,
                    top,
                    self.forward,
                );
            }
        }
        false
    }

    pub fn finish(&self, out: &mut [u16]) {
        out.copy_from_slice(&self.to);
    }

    pub fn frame_count(&self) -> u32 {
        self.frames
    }

    /// Whether the native compositor owns every intermediate frame. These
    /// transitions can release the expensive guest hot loop as soon as the
    /// settled target has been captured.
    pub fn is_host_owned(&self) -> bool {
        matches!(self.axis, Axis::ShellHorizontal | Axis::Vertical(_) | Axis::Drawer { .. })
    }

    pub fn elapsed_ms(&self, now: Instant) -> u128 {
        now.saturating_duration_since(self.started).as_millis()
    }
}

fn blit_drawer(
    out: &mut [u16],
    from: &[u16],
    to: &[u16],
    progress: f32,
    width: usize,
    height: usize,
    top: usize,
    opening: bool,
) {
    let top = top.min(height);
    let drawer_height = height.saturating_sub(top);
    let progress = progress.clamp(0.0, 1.0);
    let closed = if opening { from } else { to };
    let open = if opening { to } else { from };
    out.copy_from_slice(closed);

    let visible = if opening { progress } else { 1.0 - progress };
    darken_rgb565(out, DRAWER_SCRIM_OPACITY * visible);
    if drawer_height == 0 {
        return;
    }

    let offset = ((drawer_height as f32) * (1.0 - visible)).round() as usize;
    let rows = drawer_height.saturating_sub(offset);
    for local_y in 0..rows {
        let source_y = top + local_y;
        let dest_y = top + offset + local_y;
        let source = source_y * width;
        let dest = dest_y * width;
        out[dest..dest + width].copy_from_slice(&open[source..source + width]);
    }
}

fn darken_rgb565(pixels: &mut [u16], opacity: f32) {
    let keep = ((1.0 - opacity.clamp(0.0, 1.0)) * 256.0).round() as u32;
    for pixel in pixels {
        let value = *pixel as u32;
        let red = (((value >> 11) & 0x1f) * keep + 128) >> 8;
        let green = (((value >> 5) & 0x3f) * keep + 128) >> 8;
        let blue = ((value & 0x1f) * keep + 128) >> 8;
        *pixel = ((red << 11) | (green << 5) | blue) as u16;
    }
}

fn blit_scroll(
    out: &mut [u16],
    from: &[u16],
    to: &[u16],
    distance: usize,
    progress: f32,
    frame_width: usize,
    frame_height: usize,
    region: Region,
    forward: bool,
) {
    let x0 = region.x.min(frame_width);
    let x1 = region.x.saturating_add(region.width).min(frame_width);
    let y0 = region.y.min(frame_height);
    let y1 = region.y.saturating_add(region.height).min(frame_height);
    let width = x1.saturating_sub(x0);
    let height = y1.saturating_sub(y0);
    if width == 0 || height == 0 {
        return;
    }
    let slide = (distance as f32 * progress).round() as i32;
    let weight = (progress.clamp(0.0, 1.0) * 32.0).round() as u32;
    let sign = if forward { 1 } else { -1 };
    for y in 0..height {
        // Both viewports must sample the same content coordinate. Leaving
        // the incoming snapshot unshifted duplicates/skips rows at the seam.
        let old_y = y as i32 + sign * slide;
        let new_y = old_y - sign * distance as i32;
        for x in x0..x1 {
            let old = (0..height as i32)
                .contains(&old_y)
                .then(|| from[(y0 + old_y as usize) * frame_width + x]);
            let new = (0..height as i32)
                .contains(&new_y)
                .then(|| to[(y0 + new_y as usize) * frame_width + x]);
            out[(y0 + y) * frame_width + x] = match (old, new) {
                (Some(old), Some(new)) => blend_rgb565(old, new, weight),
                (Some(pixel), None) | (None, Some(pixel)) => pixel,
                _ => 0,
            };
        }
    }
}

fn blend_rgb565(from: u16, to: u16, weight: u32) -> u16 {
    if from == to {
        return to;
    }
    // Separate green from red/blue and blend all three lanes together. The
    // five-bit weight matches RGB565 precision, with no float work per pixel.
    const MASK: u32 = 0x07e0_f81f;
    let a = (from as u32 | ((from as u32) << 16)) & MASK;
    let b = (to as u32 | ((to as u32) << 16)) & MASK;
    let value = ((a * (32 - weight) + b * weight) >> 5) & MASK;
    (value | (value >> 16)) as u16
}

fn blit_list(
    out: &mut [u16],
    from: &[u16],
    layer: &ScrollLayer,
    from_offset: usize,
    offset: usize,
    progress: f32,
    width: usize,
    height: usize,
    region: Region,
) {
    let weight = (progress.clamp(0.0, 1.0) * 32.0).round() as u32;
    let x0 = region.x.min(width);
    let x1 = region.x.saturating_add(region.width).min(width);
    for y in region.y..region.y.saturating_add(region.height).min(height) {
        let local_y = y - region.y;
        let content_y = offset + local_y;
        let old_y = content_y
            .checked_sub(from_offset)
            .filter(|&row| row < region.height);
        let dest = &mut out[y * width + x0..y * width + x1];
        if content_y >= layer.height {
            dest.fill(0);
            continue;
        }
        let target = &layer.pixels[content_y * width + x0..content_y * width + x1];
        if let Some(row) = old_y.filter(|&row| region.y + row < height) {
            let source = &from[(region.y + row) * width + x0..(region.y + row) * width + x1];
            for ((pixel, &old), &new) in dest.iter_mut().zip(source).zip(target) {
                *pixel = blend_rgb565(old, new, weight);
            }
        } else {
            dest.copy_from_slice(target);
        }
    }
}

pub fn blit_slide(
    out: &mut [u16],
    left: &[u16],
    right: &[u16],
    slide: i32,
    width: usize,
    height: usize,
) {
    let slide = slide.clamp(0, width as i32) as usize;
    for y in 0..height {
        let row = y * width;
        if slide == 0 {
            out[row..row + width].copy_from_slice(&left[row..row + width]);
        } else if slide == width {
            out[row..row + width].copy_from_slice(&right[row..row + width]);
        } else {
            let left_n = width - slide;
            out[row..row + left_n].copy_from_slice(&left[row + slide..row + width]);
            out[row + left_n..row + width].copy_from_slice(&right[row..row + slide]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pocketjs_core::damage::DamageTracker;

    #[test]
    fn packed_colour_blend_keeps_channels_separate() {
        for from in [0, 1, 0xf800, 0x07e0, 0x001f, 0xffff, 0x1234] {
            for to in [0, 31, 0x07e0, 0xf800, 0xffff, 0x9abc] {
                for weight in 0..=32 {
                    let mix = |shift, mask| {
                        ((((from as u32 >> shift) & mask) * (32 - weight)
                            + ((to as u32 >> shift) & mask) * weight)
                            >> 5)
                            << shift
                    };
                    let expected = (mix(11, 31u32) | mix(5, 63) | mix(0, 31)) as u16;
                    assert_eq!(blend_rgb565(from, to, weight), expected);
                }
            }
        }
    }

    #[test]
    fn forward_slide_uses_cached_frames() {
        let started = Instant::now();
        let mut transition = PageTransition::new(vec![1, 2, 3, 4], vec![5, 6, 7, 8], 1, started);
        let mut out = vec![0; 4];

        assert!(!transition.paint(&mut out, 4, 1, started));
        assert_eq!(out, [1, 2, 3, 4]);
        assert!(transition.paint(
            &mut out,
            4,
            1,
            started + Duration::from_millis(PAGE_TRANSITION_MS),
        ));
        assert_eq!(out, [5, 6, 7, 8]);
    }

    #[test]
    fn backward_slide_enters_from_the_left() {
        let started = Instant::now();
        let mut transition = PageTransition::new(vec![1, 2, 3, 4], vec![5, 6, 7, 8], -1, started);
        let mut out = vec![0; 4];

        assert!(!transition.paint(
            &mut out,
            4,
            1,
            started + Duration::from_millis(PAGE_TRANSITION_MS / 2),
        ));
        assert_eq!(out, [6, 7, 8, 1]);
        transition.finish(&mut out);
        assert_eq!(out, [5, 6, 7, 8]);
    }

    #[test]
    fn shell_slide_is_host_owned_and_retargets_from_visible_pixels() {
        let started = Instant::now();
        let mut first = PageTransition::new_shell(vec![1; 4], vec![2; 4], 1, started);
        assert!(first.is_host_owned());
        assert!(!PageTransition::new(vec![1; 4], vec![2; 4], 1, started).is_host_owned());
        let mut visible = vec![0; 4];
        first.paint(&mut visible, 4, 1, started + Duration::from_millis(100));
        for direction in [-1, 1] {
            let mut next = PageTransition::new_shell(visible.clone(), vec![3; 4], direction, started);
            let mut out = vec![0; 4];
            next.paint(&mut out, 4, 1, started);
            assert_eq!(out, visible);
            assert!(next.paint(&mut out, 4, 1, started + Duration::from_millis(PAGE_TRANSITION_MS)));
            assert_eq!(out, [3; 4]);
        }
    }

    #[test]
    fn vertical_forward_scroll_clips_to_the_viewport() {
        let started = Instant::now();
        let mut transition = PageTransition::new_vertical(
            vec![1, 1, 2, 2, 9, 9, 9, 9, 3, 3, 4, 4],
            vec![5, 5, 6, 6, 7, 7, 8, 8, 10, 10, 11, 11],
            1,
            1,
            (0, 1, 4, 2),
            started,
        );
        let mut out = vec![0; 12];
        assert!(!transition.paint(
            &mut out,
            4,
            3,
            started + Duration::from_millis(SCROLL_TRANSITION_MS / 2),
        ));
        // Row 0 is fixed; one row of the viewport has moved out and the next
        // target row has entered from the bottom.
        assert_eq!(&out[0..4], &[5, 5, 6, 6]);
        assert_eq!(&out[4..8], &[6, 6, 7, 7]);
        assert_eq!(&out[8..12], &[10, 10, 11, 11]);
    }

    #[test]
    fn vertical_backward_scroll_enters_from_the_top() {
        let started = Instant::now();
        let mut transition = PageTransition::new_vertical(
            vec![1, 1, 2, 2, 3, 3, 4, 4],
            vec![5, 5, 6, 6, 7, 7, 8, 8],
            -1,
            1,
            (0, 1, 4, 1),
            started,
        );
        let mut out = vec![0; 8];
        assert!(transition.paint(
            &mut out,
            4,
            2,
            started + Duration::from_millis(SCROLL_TRANSITION_MS),
        ));
        assert_eq!(out, [5, 5, 6, 6, 7, 7, 8, 8]);
    }

    #[test]
    fn incoming_rows_use_the_same_content_coordinate() {
        let started = Instant::now();
        for forward in [true, false] {
            let (from, to) = if forward {
                ((0..10).collect(), (3..13).collect())
            } else {
                ((3..13).collect(), (0..10).collect())
            };
            let mut transition = PageTransition::new_vertical(
                from,
                to,
                if forward { 1 } else { -1 },
                3,
                (0, 0, 1, 10),
                started,
            );
            let mut out = vec![0; 10];
            transition.paint(&mut out, 1, 10, started + Duration::from_millis(20));
            let first = if forward { 1 } else { 2 };
            assert_eq!(out, (first..first + 10).collect::<Vec<u16>>());
        }
    }

    fn layer(offset: usize) -> ScrollLayer {
        ScrollLayer {
            pixels: (0..30).collect(),
            node: 42,
            offset,
            height: 30,
            viewport: (0, 10),
            damage: DamageTracker::new(),
        }
    }

    #[test]
    fn complete_list_moves_as_one_layer_and_leaves_chrome_fixed() {
        let started = Instant::now();
        let mut transition = PageTransition::new_list(
            [vec![99], (0..10).collect()].concat(),
            [vec![99], (12..22).collect()].concat(),
            layer(12),
            0,
            (0, 1, 1, 10),
            started,
        );
        let mut out = vec![0; 11];
        transition.paint(&mut out, 1, 11, started + Duration::from_millis(20));
        // 44% of 12 px rounds to 5 px. Even a displacement larger than the
        // viewport has no missing strip: offscreen content was cached too.
        assert_eq!(out, [vec![99], (5..15).collect()].concat());
    }

    #[test]
    fn highlight_only_requests_fade_to_the_fully_settled_target() {
        let started = Instant::now();
        let target = vec![0x001f; 4];
        let layer = ScrollLayer {
            pixels: target.clone(),
            node: 42,
            offset: 0,
            height: 4,
            viewport: (0, 4),
            damage: DamageTracker::new(),
        };
        let mut transition = PageTransition::new_list(
            vec![0xf800; 4],
            target.clone(),
            layer,
            0,
            (0, 0, 1, 4),
            started,
        );
        let mut out = vec![0; 4];
        transition.paint(&mut out, 1, 4, started);
        assert_eq!(out, [0xf800; 4]);
        transition.paint(&mut out, 1, 4, started + Duration::from_millis(40));
        assert_ne!(out, [0xf800; 4]);
        assert_ne!(out, target);
        assert!(transition.paint(&mut out, 1, 4, started + Duration::from_millis(80)));
        assert_eq!(out, target);
    }

    #[test]
    fn retarget_starts_at_the_last_visible_offset_in_both_directions() {
        let started = Instant::now();
        let mut first = PageTransition::new_list(
            (0..10).collect(),
            (6..16).collect(),
            layer(6),
            0,
            (0, 0, 1, 10),
            started,
        );
        let mut out = vec![0; 10];
        first.paint(&mut out, 1, 10, started + Duration::from_millis(20));
        let (_, offset) = first.scroll_position().unwrap();
        assert_eq!(offset, 3);
        for target in [0, 12] {
            let visible = out.clone();
            let mut next = PageTransition::new_list(
                visible.clone(),
                (target as u16..target as u16 + 10).collect(),
                layer(target),
                offset,
                (0, 0, 1, 10),
                started,
            );
            next.paint(&mut out, 1, 10, started);
            assert_eq!(out, visible, "retarget jumped before motion");
            next.paint(&mut out, 1, 10, started + Duration::from_millis(40));
            let expected = next.scroll_position().unwrap().1 as u16;
            assert_eq!(out, (expected..expected + 10).collect::<Vec<_>>());
            out = visible;
        }
    }

    #[test]
    fn drawer_uses_cached_sheet_over_a_fading_scrim() {
        let started = Instant::now();
        let from = vec![0xffff; 8];
        let mut to = from.clone();
        to[4..6].fill(0xf800);
        to[6..8].fill(0x07e0);
        let mut transition = PageTransition::new_drawer(from.clone(), to.clone(), true, 2, started);
        let mut out = vec![0; 8];

        assert!(!transition.paint(&mut out, 2, 4, started));
        assert_eq!(out, from);
        assert!(!transition.paint(
            &mut out,
            2,
            4,
            started + Duration::from_millis(DRAWER_ENTER_MS / 2),
        ));
        assert_ne!(&out[0..2], &from[0..2]);
        assert_eq!(&out[6..8], &[0xf800, 0xf800]);
        assert!(transition.is_host_owned());
        assert!(transition.paint(
            &mut out,
            2,
            4,
            started + Duration::from_millis(DRAWER_ENTER_MS),
        ));
        assert_eq!(out, to);
    }

    #[test]
    fn drawer_exit_finishes_on_the_closed_frame() {
        let started = Instant::now();
        let closed = vec![0xffff; 8];
        let mut open = vec![0x8c51; 8];
        open[4..6].fill(0xf800);
        open[6..8].fill(0x07e0);
        let mut transition = PageTransition::new_drawer(open, closed.clone(), false, 2, started);
        let mut out = vec![0; 8];

        assert!(transition.paint(
            &mut out,
            2,
            4,
            started + Duration::from_millis(DRAWER_EXIT_MS),
        ));
        assert_eq!(out, closed);
    }
}
