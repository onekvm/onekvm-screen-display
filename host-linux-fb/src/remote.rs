//! On-demand screen snapshots and complete, bounded remote touch gestures.
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub fn framebuffer_pixels(
    data: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    rotate: u16,
    logical_width: usize,
    logical_height: usize,
) -> Vec<u16> {
    let mut pixels = vec![0u16; logical_width * logical_height];
    for y in 0..height {
        for x in 0..width {
            let (lx, ly) = if width == height {
                (x, y)
            } else {
                crate::unrotate_px(x, y, rotate, logical_width, logical_height)
            };
            // fbdev's Panel stride is in RGB565 words, including row padding.
            let offset = (y * stride + x) * 2;
            if lx < logical_width && ly < logical_height && offset + 1 < data.len() {
                pixels[ly * logical_width + lx] =
                    u16::from_le_bytes([data[offset], data[offset + 1]]);
            }
        }
    }
    pixels
}

/// A CPU-memory copy of the last frame actually presented to fbdev.
/// Reading an uncached framebuffer on every idle touch tick is expensive on Pro.
pub struct PresentedFrame {
    pixels: Vec<u16>,
    generation: u64,
    published: Option<(u64, u16, usize, usize)>,
}

impl PresentedFrame {
    pub fn new(data: &[u8], width: usize, height: usize, stride: usize) -> Self {
        let mut pixels = Vec::with_capacity(width * height);
        for row in data.chunks_exact(stride * 2).take(height) {
            pixels.extend(row[..width * 2].chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])));
        }
        Self { pixels, generation: 1, published: None }
    }

    pub fn pixels(&self) -> &[u16] { &self.pixels }
    pub fn pixels_mut(&mut self) -> &mut [u16] { &mut self.pixels }
    pub fn changed(&mut self) { self.generation = self.generation.wrapping_add(1); }

    pub fn update(&mut self, pixels: &[u16]) {
        if self.pixels != pixels {
            self.pixels.clear();
            self.pixels.extend_from_slice(pixels);
            self.changed();
        }
    }

    pub fn snapshot(&mut self, width: usize, height: usize, rotate: u16, logical_width: usize, logical_height: usize) -> Option<Vec<u16>> {
        let view = (self.generation, rotate, logical_width, logical_height);
        if self.published == Some(view) { return None; }
        self.published = Some(view);
        // fbdev RGB565 and all supported targets use little-endian words.
        let bytes = unsafe { std::slice::from_raw_parts(self.pixels.as_ptr().cast::<u8>(), self.pixels.len() * 2) };
        Some(framebuffer_pixels(bytes, width, height, width, rotate, logical_width, logical_height))
    }
}

#[derive(Clone, Default)]
pub(crate) struct Frame {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u16>,
    pub sequence: u64,
}

struct Gesture {
    points: Vec<(u64, u32, u32)>,
    started: Option<Instant>,
    duration: Duration,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rotary {
    Step(i32),
    Press,
    Hold,
}

#[derive(Default)]
pub struct Remote {
    requested: AtomicBool,
    frame: Mutex<Frame>,
    gesture: Mutex<Option<Gesture>>,
    rotary: Mutex<VecDeque<Rotary>>,
    viewers: AtomicUsize,
    changed: Condvar,
}

pub struct Viewer<'a>(&'a Remote);
impl Drop for Viewer<'_> {
    fn drop(&mut self) { self.0.viewers.fetch_sub(1, Ordering::Relaxed); }
}

impl Remote {
    pub fn viewer(&self) -> Option<Viewer<'_>> {
        self.viewers.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| (n < 2).then_some(n + 1)).ok()?;
        Some(Viewer(self))
    }

    pub fn wait_frame(&self, previous: u64, timeout: Duration) -> Option<Frame> {
        let frame = self.frame.lock().unwrap();
        let (frame, _) = self.changed.wait_timeout_while(frame, timeout, |frame| frame.sequence == previous || frame.pixels.is_empty()).unwrap();
        (frame.sequence != previous && !frame.pixels.is_empty()).then(|| frame.clone())
    }

    pub fn queue_rotary(&self, action: Rotary) -> Result<(), String> {
        let mut queue = self.rotary.lock().unwrap();
        if queue.len() >= 32 {
            return Err("remote rotary queue is full".into());
        }
        queue.push_back(action);
        Ok(())
    }

    pub fn rotary_queued(&self) -> bool {
        !self.rotary.lock().unwrap().is_empty()
    }

    pub fn take_rotary(&self) -> Option<Rotary> {
        self.rotary.lock().unwrap().pop_front()
    }

    pub fn frame(&self, previous: u64) -> Value {
        self.requested.store(true, Ordering::Relaxed);
        let frame = self.frame.lock().unwrap();
        json!({
            "ready": !frame.pixels.is_empty(), "width": frame.width, "height": frame.height,
            "sequence": frame.sequence, "format": "rgb565le",
            "pixels": if frame.sequence != previous {
                let bytes = frame.pixels.iter().flat_map(|pixel| pixel.to_le_bytes()).collect::<Vec<_>>();
                base64(&bytes)
            } else { String::new() },
        })
    }

    pub fn take_snapshot_request(&self) -> bool {
        self.requested.swap(false, Ordering::Relaxed) || self.viewers.load(Ordering::Relaxed) > 0
    }

    pub fn publish(&self, width: usize, height: usize, pixels: Vec<u16>) {
        let mut frame = self.frame.lock().unwrap();
        if frame.width != width || frame.height != height || frame.pixels != pixels {
            frame.width = width;
            frame.height = height;
            frame.pixels = pixels;
            frame.sequence = frame.sequence.wrapping_add(1).max(1);
            self.changed.notify_all();
        }
    }

    pub fn gesture(&self, request: &Value, width: u16, height: u16) -> Result<(), String> {
        let points = request
            .get("points")
            .and_then(Value::as_array)
            .filter(|points| !points.is_empty() && points.len() <= 64)
            .ok_or("a gesture needs 1 to 64 points")?;
        let duration = request
            .get("duration_ms")
            .and_then(Value::as_u64)
            .filter(|duration| (32..=3000).contains(duration))
            .ok_or("invalid gesture duration")?;
        let mut parsed = Vec::new();
        for point in points {
            let t = point
                .get("t")
                .and_then(Value::as_u64)
                .ok_or("invalid point time")?;
            let x = point
                .get("x")
                .and_then(Value::as_u64)
                .filter(|x| *x < u64::from(width))
                .ok_or("invalid point x")?;
            let y = point
                .get("y")
                .and_then(Value::as_u64)
                .filter(|y| *y < u64::from(height))
                .ok_or("invalid point y")?;
            if t > duration || parsed.last().is_some_and(|(last, _, _)| *last > t) {
                return Err("gesture times must be ordered".into());
            }
            parsed.push((t, x as u32, y as u32));
        }
        if parsed[0].0 != 0 {
            return Err("gesture must begin at zero".into());
        }
        let mut gesture = self.gesture.lock().unwrap();
        if gesture.is_some() {
            return Err("another screen gesture is running".into());
        }
        *gesture = Some(Gesture {
            points: parsed,
            started: None,
            duration: Duration::from_millis(duration),
        });
        Ok(())
    }

    pub fn touches(&self, physical: Vec<u32>) -> Vec<u32> {
        self.touches_at(physical, Instant::now())
    }

    fn touches_at(&self, physical: Vec<u32>, now: Instant) -> Vec<u32> {
        let mut gesture = self.gesture.lock().unwrap();
        if !physical.is_empty() {
            *gesture = None;
            return physical;
        }
        let Some(active) = gesture.as_mut() else {
            return physical;
        };
        // Start at the first owner-thread input frame. A busy renderer must
        // not let a short remote tap expire before its DOWN is ever delivered.
        let started = *active.started.get_or_insert(now);
        let elapsed = now.saturating_duration_since(started);
        if elapsed >= active.duration {
            *gesture = None;
            return Vec::new();
        }
        let (_, x, y) = active
            .points
            .iter()
            .rev()
            .find(|(time, _, _)| *time <= elapsed.as_millis() as u64)
            .unwrap_or(&active.points[0]);
        vec![(*y << 9) | *x]
    }
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for part in bytes.chunks(3) {
        let word = (u32::from(part[0]) << 16)
            | (u32::from(*part.get(1).unwrap_or(&0)) << 8)
            | u32::from(*part.get(2).unwrap_or(&0));
        output.push(TABLE[((word >> 18) & 63) as usize] as char);
        output.push(TABLE[((word >> 12) & 63) as usize] as char);
        output.push(if part.len() > 1 {
            TABLE[((word >> 6) & 63) as usize] as char
        } else {
            '='
        });
        output.push(if part.len() > 2 {
            TABLE[(word & 63) as usize] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presented_frames_skip_idle_snapshots_and_preserve_rotation_and_padding() {
        let padded: Vec<u8> = [1u16, 2, 3, 4, 99, 5, 6, 7, 8, 99].iter()
            .flat_map(|pixel| pixel.to_le_bytes()).collect();
        let mut cache = PresentedFrame::new(&padded, 4, 2, 5);
        assert_eq!(cache.snapshot(4, 2, 0, 4, 2).unwrap(), [1, 2, 3, 4, 5, 6, 7, 8]);
        // No allocation or full-frame conversion occurs on unchanged idle ticks.
        assert!(cache.snapshot(4, 2, 0, 4, 2).is_none());
        cache.update(&[1, 2, 3, 4, 5, 6, 7, 8]);
        assert!(cache.snapshot(4, 2, 0, 4, 2).is_none());
        assert_eq!(cache.snapshot(4, 2, 180, 4, 2).unwrap(), [8, 7, 6, 5, 4, 3, 2, 1]);
        cache.update(&[10, 20, 30, 40, 50, 60, 70, 80]);
        assert_eq!(cache.snapshot(4, 2, 180, 4, 2).unwrap(), [80, 70, 60, 50, 40, 30, 20, 10]);
        // Rotation paints directly into the same physical frame storage.
        cache.pixels_mut()[0] = 99;
        cache.changed();
        assert_eq!(cache.snapshot(4, 2, 180, 4, 2).unwrap(), [80, 70, 60, 50, 40, 30, 20, 99]);
        assert!(cache.snapshot(4, 2, 180, 4, 2).is_none());
    }

    #[test]
    fn video_viewers_enable_capture_only_until_the_last_viewer_leaves() {
        let remote = Remote::default();
        assert!(!remote.take_snapshot_request());
        let one = remote.viewer().unwrap();
        let two = remote.viewer().unwrap();
        assert!(remote.viewer().is_none());
        assert!(remote.take_snapshot_request());
        remote.publish(1, 1, vec![0xf800]);
        assert_eq!(remote.wait_frame(0, Duration::ZERO).unwrap().pixels, [0xf800]);
        assert!(remote.wait_frame(1, Duration::ZERO).is_none());
        drop(one);
        assert!(remote.take_snapshot_request());
        drop(two);
        assert!(!remote.take_snapshot_request());
    }

    #[test]
    fn remote_rotary_keeps_order_and_bounds_pending_input() {
        let remote = Remote::default();
        for action in [Rotary::Hold, Rotary::Step(1), Rotary::Press, Rotary::Step(-1)] {
            remote.queue_rotary(action).unwrap();
        }
        for action in [Rotary::Hold, Rotary::Step(1), Rotary::Press, Rotary::Step(-1)] {
            assert!(remote.rotary_queued());
            assert_eq!(remote.take_rotary(), Some(action));
        }
        assert!(!remote.rotary_queued());
        assert_eq!(remote.take_rotary(), None);
        for _ in 0..32 { remote.queue_rotary(Rotary::Step(1)).unwrap(); }
        assert!(remote.queue_rotary(Rotary::Hold).is_err());
        assert_eq!(remote.take_rotary(), Some(Rotary::Step(1)));
    }

    #[test]
    fn snapshots_preserve_row_stride_padding_and_pro_orientation() {
        let padded = [1, 0, 2, 0, 0xad, 0xde, 3, 0, 4, 0, 0xad, 0xde];
        assert_eq!(
            framebuffer_pixels(&padded, 2, 2, 3, 0, 2, 2),
            vec![1, 2, 3, 4]
        );
        let pro = [1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0];
        assert_eq!(
            framebuffer_pixels(&pro, 2, 3, 2, 270, 3, 2),
            vec![5, 3, 1, 6, 4, 2]
        );
    }

    #[test]
    fn remote_touch_always_releases_without_another_network_request() {
        let remote = Remote::default();
        remote
            .gesture(
                &json!({"points":[{"t":0,"x":100,"y":50}],"duration_ms":64}),
                320,
                172,
            )
            .unwrap();
        // Even a tap received while the previous frame was slow must play.
        let started = Instant::now() + Duration::from_secs(5);
        assert_eq!(remote.touches_at(vec![], started), vec![(50 << 9) | 100]);
        assert!(remote
            .touches_at(vec![], started + Duration::from_millis(65))
            .is_empty());
        assert!(remote.gesture.lock().unwrap().is_none());
    }

    #[test]
    fn malformed_and_overlapping_gestures_are_rejected_and_local_touch_wins() {
        let remote = Remote::default();
        assert!(remote
            .gesture(
                &json!({"points":[{"t":0,"x":320,"y":0}],"duration_ms":64}),
                320,
                172
            )
            .is_err());
        let request =
            json!({"points":[{"t":0,"x":10,"y":10},{"t":50,"x":100,"y":10}],"duration_ms":100});
        remote.gesture(&request, 320, 172).unwrap();
        assert!(remote.gesture(&request, 320, 172).is_err());
        assert_eq!(remote.touches(vec![123]), vec![123]);
        assert!(remote.touches(vec![]).is_empty());
    }

    #[test]
    fn unchanged_frames_do_not_send_pixels_or_advance_sequence() {
        let remote = Remote::default();
        remote.publish(1, 1, vec![0xf800]);
        assert_eq!(remote.frame(0)["pixels"], "APg=");
        remote.publish(1, 1, vec![0xf800]);
        assert_eq!(remote.frame(1)["pixels"], "");
        assert_eq!(remote.frame(1)["sequence"], 1);
    }
}
