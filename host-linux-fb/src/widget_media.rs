use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::home_compositor::{self, Surface};
use pocketjs_core::{damage::DamageRect, resources::RenderResources};
use serde_json::Value;

use crate::video_decode::{demux_mp4, DecodedFrame, DemuxedVideo, VideoDecoderBackend};

const MAX_SIDE: usize = 240;
const MAX_SOURCE_SIDE: usize = 4096;
const MAX_CATCHUP_SAMPLES: usize = 8;

struct MediaAsset {
    width: usize,
    height: usize,
    durations: Vec<u64>,
    // Base64 ranges borrow the canonical, optionally file-mapped metadata.
    // Only visible assets need their decoded pixels in the native heap.
    frames: Vec<std::ops::Range<usize>>,
    decoded_frames: Mutex<Vec<Vec<u16>>>,
    cycle_ms: u64,
    video: Option<Arc<Mutex<VideoResource>>>,
}

// File-backed videos keep no sample index or decoder while unused.
struct VideoResource {
    player: Option<VideoPlayer>,
    file: Option<std::path::PathBuf>,
    retry_after: Instant,
}

impl From<VideoPlayer> for VideoResource {
    fn from(player: VideoPlayer) -> Self {
        Self { player: Some(player), file: None, retry_after: Instant::now() }
    }
}

impl VideoResource {
    fn frame_at(&mut self, timestamp_ms: u64) -> Option<&DecodedFrame> {
        if self.player.is_none() {
            let path = self.file.as_ref()?;
            if Instant::now() < self.retry_after { return None; }
            match crate::video_decode::demux_mp4_file(path).map_err(|error| error.to_string()).and_then(VideoPlayer::new) {
                Ok(player) => self.player = Some(player),
                Err(error) => {
                    log::warn!("open home video: {error}");
                    self.retry_after = Instant::now() + std::time::Duration::from_secs(1);
                    return None;
                }
            }
        }
        self.player.as_mut()?.frame_at(timestamp_ms)
    }

    fn release(&mut self) {
        if self.file.is_some() { self.player = None; }
    }
}

struct VideoPlayer {
    demuxed: DemuxedVideo,
    backend: Option<Box<dyn VideoDecoderBackend>>,
    next_sample: usize,
    decode_warning: bool,
    retry_after: Instant,
    stats: VideoStats,
}

#[derive(Debug)]
struct VideoStats {
    decoded_samples: u64,
    decoded_frames: u64,
    skipped_samples: u64,
    decode_us: u64,
    last_report_frames: u64,
    last_report: Instant,
}

impl Default for VideoStats {
    fn default() -> Self {
        Self {
            decoded_samples: 0,
            decoded_frames: 0,
            skipped_samples: 0,
            decode_us: 0,
            last_report_frames: 0,
            last_report: Instant::now(),
        }
    }
}

impl VideoPlayer {
    fn new(demuxed: DemuxedVideo) -> Result<Self, String> {
        Ok(Self {
            demuxed,
            backend: None,
            next_sample: 0,
            decode_warning: false,
            retry_after: Instant::now(),
            stats: VideoStats::default(),
        })
    }

    fn reset(&mut self) -> Result<(), String> {
        if let Some(backend) = self.backend.as_mut() {
            backend
                .configure(&self.demuxed.config)
                .map_err(|err| format!("reset H.264 decoder: {err:#}"))?;
        }
        self.next_sample = 0;
        self.decode_warning = false;
        Ok(())
    }

    fn seek_if_behind(&mut self, timestamp_ms: u64) -> Result<(), String> {
        let Some((keyframe, target, behind)) =
            keyframe_seek_target(&self.demuxed.samples, self.next_sample, timestamp_ms)
        else {
            return Ok(());
        };
        self.backend
            .as_mut()
            .ok_or_else(|| "H.264 decoder is not configured".to_string())?
            .configure(&self.demuxed.config)
            .map_err(|err| format!("seek H.264 decoder: {err:#}"))?;
        self.stats.skipped_samples = self
            .stats
            .skipped_samples
            .saturating_add((keyframe - self.next_sample) as u64);
        self.next_sample = keyframe;
        log::trace!(
            target: "onekvm_screen_display::profile",
            "home video seek keyframe={} skipped={} target={}",
            keyframe,
            behind.saturating_sub(target.saturating_sub(keyframe)),
            target
        );
        Ok(())
    }

    fn report_stats(&mut self) {
        if self.stats.decoded_samples == 0
            || (self.stats.decoded_samples % 60 != 0
                && self.stats.last_report.elapsed().as_secs() < 2)
        {
            return;
        }
        let elapsed_us = self.stats.last_report.elapsed().as_micros().max(1) as u64;
        let interval_frames = self
            .stats
            .decoded_frames
            .saturating_sub(self.stats.last_report_frames);
        log::debug!(
            target: "onekvm_screen_display::profile",
            "home video stats samples={} frames={} skipped={} decode_avg_us={} throughput_fps={}",
            self.stats.decoded_samples,
            self.stats.decoded_frames,
            self.stats.skipped_samples,
            self.stats.decode_us / self.stats.decoded_samples.max(1),
            interval_frames.saturating_mul(1_000_000) / elapsed_us
        );
        self.stats.last_report_frames = self.stats.decoded_frames;
        self.stats.last_report = Instant::now();
    }

    fn frame_at(&mut self, timestamp_ms: u64) -> Option<&DecodedFrame> {
        if self.backend.is_none() {
            if Instant::now() < self.retry_after {
                return None;
            }
            let result = crate::video_decode::backend().and_then(|mut backend| {
                backend.configure(&self.demuxed.config)?;
                Ok(backend)
            });
            match result {
                Ok(backend) => self.backend = Some(backend),
                Err(err) => {
                    if !self.decode_warning {
                        log::warn!("configure home VDEC: {err:#}");
                        self.decode_warning = true;
                    }
                    self.retry_after = Instant::now() + std::time::Duration::from_secs(1);
                    return None;
                }
            }
        }
        if self.next_sample > 0
            && self
                .demuxed
                .samples
                .get(self.next_sample.saturating_sub(1))
                .is_some_and(|sample| sample.timestamp_ms > timestamp_ms)
        {
            self.reset().ok()?;
        }
        self.seek_if_behind(timestamp_ms).ok()?;
        while self.next_sample < self.demuxed.samples.len()
            && self.demuxed.samples[self.next_sample].timestamp_ms <= timestamp_ms
        {
            let started = Instant::now();
            let result = self.demuxed.sample(self.next_sample).and_then(|source| self.backend.as_mut().unwrap().decode_sample(&source));
            match result {
                Ok(true) => {
                    self.decode_warning = false;
                    self.stats.decoded_frames = self.stats.decoded_frames.saturating_add(1);
                }
                Ok(false) => {}
                Err(err) => {
                    if !self.decode_warning {
                        log::warn!("home video sample {} failed: {err:#}", self.next_sample);
                        self.decode_warning = true;
                    }
                }
            }
            self.stats.decoded_samples = self.stats.decoded_samples.saturating_add(1);
            self.stats.decode_us = self
                .stats
                .decode_us
                .saturating_add(started.elapsed().as_micros() as u64);
            self.next_sample += 1;
        }
        if self.next_sample == self.demuxed.samples.len() {
            if let Err(err) = self.backend.as_mut().unwrap().finish() {
                if !self.decode_warning {
                    log::warn!("drain home VDEC: {err:#}");
                    self.decode_warning = true;
                }
            }
        }
        self.report_stats();
        self.backend.as_ref()?.frame()
    }
}

fn keyframe_seek_target(
    samples: &[crate::video_decode::VideoSample],
    next_sample: usize,
    timestamp_ms: u64,
) -> Option<(usize, usize, usize)> {
    let target = samples.partition_point(|sample| sample.timestamp_ms <= timestamp_ms);
    let behind = target.saturating_sub(next_sample);
    if behind <= MAX_CATCHUP_SAMPLES {
        return None;
    }
    let keyframe = samples[..target]
        .iter()
        .rposition(|sample| sample.is_sync)?;
    (keyframe > next_sample).then_some((keyframe, target, behind))
}

pub struct MediaLibrary {
    assets: HashMap<String, MediaAsset>,
    files: HashSet<String>,
    encoded: crate::file_blob::FileBlob,
    started: Instant,
    scene: Mutex<Scene>,
    visibility: Mutex<(String, bool)>,
}

#[derive(Default)]
struct Scene {
    layout: String,
    status: String,
    placements: Vec<Placement>,
    compositor: home_compositor::Scratch,
    painted: HashMap<usize, u64>,
    visible: HashSet<usize>,
    presented: bool,
}

impl Scene {
    fn placements(&mut self, layout: &str, status: &str) {
        if self.layout == layout && self.status == status {
            return;
        }
        self.layout.clear();
        self.layout.push_str(layout);
        self.status.clear();
        self.status.push_str(status);
        self.placements =
            placements_with_status(layout, &serde_json::from_str(status).unwrap_or(Value::Null));
        self.painted.clear();
        self.visible.clear();
        self.presented = false;
    }
}

impl std::fmt::Debug for MediaLibrary {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MediaLibrary")
            .field("asset_count", &self.assets.len())
            .field("encoded_bytes", &self.encoded.len())
            .finish()
    }
}

#[derive(Clone)]
struct Placement {
    id: String,
    slot: usize,
    fit: MediaFit,
    speed: f64,
    loop_playback: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MediaFit {
    Contain,
    Cover,
    Fill,
}

#[derive(Clone, Copy)]
enum FramePixels<'a> {
    Rgb565(&'a [u16]),
    Decoded(&'a DecodedFrame),
}

impl FramePixels<'_> {
    fn len(self) -> usize {
        match self {
            Self::Rgb565(pixels) => pixels.len(),
            Self::Decoded(frame) => frame.pixel_count(),
        }
    }

    fn pixel(self, index: usize) -> u16 {
        match self {
            Self::Rgb565(pixels) => pixels[index],
            Self::Decoded(frame) => frame.rgb565(index),
        }
    }
}

impl MediaLibrary {
    pub fn parse(raw: &str) -> Result<Option<Self>, String> {
        Self::parse_with_directory(raw, &crate::shared::extension_data_dir().join("media"))
    }

    pub fn parse_with_directory(raw: &str, directory: &std::path::Path) -> Result<Option<Self>, String> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Ok(None);
        }
        let value: Value =
            serde_json::from_str(raw).map_err(|err| format!("invalid media asset JSON: {err}"))?;
        if !matches!(value.get("v").and_then(Value::as_u64), Some(1 | 2 | 3)) {
            return Err("unsupported media asset version".into());
        }
        let values = value
            .get("assets")
            .and_then(Value::as_object)
            .ok_or_else(|| "media assets are missing".to_string())?;
        let mut encoded = serde_json::to_string(&value)
            .map_err(|err| format!("encode media assets: {err}"))?;
        encoded.shrink_to_fit();
        let mut assets = HashMap::new();
        let mut files = HashSet::new();
        let mut decoded_bytes = 0usize;
        for (id, value) in values {
            if id.is_empty()
                || id.len() > 64
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'_' | b'-'))
            {
                return Err("invalid media asset id".into());
            }
            let version = value.get("v").and_then(Value::as_u64).unwrap_or(0);
            if version != 1 && version != 2 && version != 3 {
                return Err(format!("unsupported media asset version for {id}"));
            }
            // Full image files stay on disk; the renderer only decodes the small frames.
            if let Some(original) = value.get("original") {
                let name = original.get("file").and_then(Value::as_str).filter(|name| crate::media_store::is_image(name))
                    .ok_or_else(|| format!("invalid original image file for {id}"))?;
                dimension_with_limit(original, "width", 65535)?;
                dimension_with_limit(original, "height", 65535)?;
                let path = crate::media_store::path(directory, name).map_err(|err| err.to_string())?;
                let size = std::fs::metadata(&path).map_err(|err| format!("original image {id}: {err}"))?.len();
                if size == 0 || original.get("size_bytes").and_then(Value::as_u64) != Some(size) {
                    return Err(format!("original image size does not match {id}"));
                }
                files.insert(name.to_string());
            }
            if matches!(version, 2 | 3) && value.get("format").and_then(Value::as_str) == Some("mp4") {
                let width = dimension_with_limit(value, "width", MAX_SOURCE_SIDE)?;
                let height = dimension_with_limit(value, "height", MAX_SOURCE_SIDE)?;
                let duration_ms = value
                    .get("duration_ms")
                    .and_then(Value::as_u64)
                    .filter(|duration| *duration > 0)
                    .ok_or_else(|| format!("invalid MP4 duration for {id}"))?;
                if value.get("container").and_then(Value::as_str) != Some("mp4")
                    || value.get("codec").and_then(Value::as_str) != Some("h264")
                {
                    return Err(format!("invalid MP4 metadata for {id}"));
                }
                let mut file = None;
                let demuxed = if version == 3 {
                    let name = value.get("file").and_then(Value::as_str).ok_or_else(|| format!("missing MP4 file for {id}"))?;
                    let path = crate::media_store::path(directory, name).map_err(|err| err.to_string())?;
                    let size = std::fs::metadata(&path).map_err(|err| format!("MP4 file {id}: {err}"))?.len();
                    if value.get("size_bytes").and_then(Value::as_u64) != Some(size) { return Err(format!("MP4 file size does not match {id}")); }
                    files.insert(name.to_string());
                    file = Some(path.clone());
                    crate::video_decode::demux_mp4_file(&path)
                } else {
                    let encoded = value.get("data").and_then(Value::as_str).ok_or_else(|| format!("missing MP4 data for {id}"))?;
                    let bytes = crate::background::decode_base64(encoded).map_err(|_| format!("invalid MP4 data for {id}"))?;
                    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" { return Err(format!("invalid MP4 payload for {id}")); }
                    demux_mp4(&bytes)
                }.map_err(|err| format!("demux MP4 {id}: {err:#}"))?;
                if demuxed.config.width != width || demuxed.config.height != height {
                    return Err(format!("MP4 metadata dimensions do not match {id}"));
                }
                let player = VideoPlayer::new(demuxed)?;
                assets.insert(
                    id.clone(),
                    MediaAsset {
                        width,
                        height,
                        durations: vec![duration_ms],
                        frames: Vec::new(),
                        decoded_frames: Mutex::new(Vec::new()),
                        cycle_ms: duration_ms,
                        video: Some(Arc::new(Mutex::new(VideoResource {
                            player: if file.is_some() { None } else { Some(player) },
                            file, retry_after: Instant::now(),
                        }))),
                    },
                );
                continue;
            }
            if version != 1 {
                return Err(format!("unsupported media asset version for {id}"));
            }
            if !matches!(
                value.get("format").and_then(Value::as_str),
                Some("image" | "gif" | "webp" | "h264")
            ) {
                return Err(format!("invalid media format for {id}"));
            }
            let width = dimension(value, "width")?;
            let height = dimension(value, "height")?;
            let frame_values = value
                .get("frames")
                .and_then(Value::as_array)
                .filter(|frames| !frames.is_empty())
                .ok_or_else(|| format!("invalid media frames for {id}"))?;
            let duration_values = value
                .get("durations")
                .and_then(Value::as_array)
                .filter(|durations| durations.len() == frame_values.len())
                .ok_or_else(|| format!("invalid media durations for {id}"))?;
            let expected = width
                .checked_mul(height)
                .and_then(|count| count.checked_mul(2))
                .ok_or_else(|| "media dimensions are too large".to_string())?;
            let mut frames = Vec::with_capacity(frame_values.len());
            for frame in frame_values {
                let frame_data = frame
                    .as_str()
                    .ok_or_else(|| format!("invalid media frame for {id}"))?;
                let bytes = crate::background::decode_base64(frame_data)
                    .map_err(|_| format!("invalid media frame data for {id}"))?;
                if bytes.len() != expected {
                    return Err(format!(
                        "media frame for {id} has {} bytes; expected {expected}",
                        bytes.len()
                    ));
                }
                decoded_bytes = decoded_bytes
                    .checked_add(bytes.len())
                    .ok_or_else(|| "decoded media asset size overflow".to_string())?;
                // Base64 has no JSON escapes. Identical payloads may share
                // a range; the complete payload was validated just above.
                let start = encoded.find(frame_data)
                    .ok_or_else(|| format!("missing canonical frame for {id}"))?;
                frames.push(start..start + frame_data.len());
            }
            let durations: Vec<u64> = duration_values
                .iter()
                .map(|duration| {
                    duration
                        .as_u64()
                        .filter(|duration| *duration > 0)
                        .ok_or_else(|| format!("invalid media frame duration for {id}"))
                })
                .collect::<Result<_, _>>()?;
            let cycle_ms = durations.iter().sum::<u64>().max(1);
            assets.insert(
                id.clone(),
                MediaAsset {
                    width,
                    height,
                    durations,
                    frames,
                    decoded_frames: Mutex::new(Vec::new()),
                    cycle_ms,
                    video: None,
                },
            );
        }
        Ok(Some(Self {
            assets,
            files,
            encoded: crate::file_blob::FileBlob::Owned(encoded.into_bytes()),
            started: Instant::now(),
            scene: Mutex::new(Scene::default()),
            visibility: Mutex::new((String::new(), false)),
        }))
    }

    pub fn encoded(&self) -> &str {
        std::str::from_utf8(&self.encoded).expect("validated media JSON")
    }

    pub fn encoded_owned(&self) -> String {
        let value = self.encoded().to_owned();
        self.encoded.release_pages();
        value
    }

    /// Metadata writers replace the inode atomically. Keep that immutable
    /// version for API reads without retaining a second heap copy.
    pub fn map_metadata(&mut self, path: &std::path::Path) {
        let Ok(bytes) = crate::file_blob::FileBlob::open(path) else { return; };
        if &*bytes != &*self.encoded { return; }
        self.encoded = bytes;
        self.encoded.release_pages();
    }

    pub fn files(&self) -> &HashSet<String> {
        &self.files
    }

    pub fn animation_delay_ms(&self, layout_json: &str, status_json: &str) -> Option<u64> {
        let elapsed_ms = self.started.elapsed().as_millis() as u64;
        let mut scene = self.scene.lock().unwrap();
        scene.placements(layout_json, status_json);
        for (id, asset) in &self.assets {
            if !scene.placements.iter().any(|placement| &placement.id == id) {
                if let Some(video) = &asset.video { video.lock().unwrap().release(); }
                *asset.decoded_frames.lock().unwrap() = Vec::new();
            }
        }
        scene
            .placements
            .iter()
            .filter_map(|placement| {
                if scene.presented && !scene.visible.contains(&placement.slot) {
                    return None;
                }
                let asset = self.assets.get(&placement.id)?;
                if asset.video.is_none() && asset.frames.len() <= 1 {
                    return None;
                }
                let (token, delay) = frame_schedule(asset, elapsed_ms, placement);
                if scene.painted.get(&placement.slot) == Some(&token) {
                    delay
                } else {
                    Some(0)
                }
            })
            .min()
    }

    pub fn has_visible(&self, layout_json: &str) -> bool {
        let mut cache = self.visibility.lock().unwrap();
        if cache.0 == layout_json {
            return cache.1;
        }
        let visible = [true, false].into_iter().any(|active| {
            let status = serde_json::json!({"video":{"hdmi_connected":active,"active":active},"network":{"ethernet_connected":active,"wifi_connected":active},"hid":{"connected":active}});
            placements_with_status(layout_json, &status).into_iter().any(|placement| self.assets.contains_key(&placement.id))
        });
        cache.0.clear();
        cache.0.push_str(layout_json);
        cache.1 = visible;
        visible
    }

    pub fn paint_scene(
        &self, layout_json: &str, status_json: &str, ui: &impl RenderResources,
        words: &[u32], target: &mut [u16],
    ) {
        self.paint_scene_with_surfaces(layout_json, status_json, ui, words, target, |_, _| false);
    }

    pub fn paint_scene_with_surfaces(
        &self,
        layout_json: &str,
        status_json: &str,
        ui: &impl RenderResources,
        words: &[u32],
        target: &mut [u16],
        mut paint_surface: impl FnMut(Surface, &mut [u16]) -> bool,
    ) {
        let (width, height) = ui.viewport();
        let (width, height) = (width as usize, height as usize);
        let elapsed_ms = self.started.elapsed().as_millis() as u64;
        let mut scene = self.scene.lock().unwrap();
        scene.placements(layout_json, status_json);
        let Scene {
            placements,
            compositor,
            painted,
            visible,
            presented,
            ..
        } = &mut *scene;
        visible.clear();
        home_compositor::render(ui, words, target, compositor, |surface, target| {
            if paint_surface(surface, target) { return; }
            visible.insert(surface.slot);
            if let Some(placement) = placements
                .iter()
                .find(|placement| placement.slot == surface.slot)
            {
                self.paint_placement(placement, elapsed_ms, surface, target, width, height);
                if let Some(asset) = self.assets.get(&placement.id) {
                    painted.insert(
                        placement.slot,
                        frame_schedule(asset, elapsed_ms, placement).0,
                    );
                }
            }
        });
        *presented = true;
    }

    fn paint_placement(
        &self,
        placement: &Placement,
        elapsed_ms: u64,
        surface: Surface,
        target: &mut [u16],
        width: usize,
        height: usize,
    ) -> bool {
        let Some(asset) = self.assets.get(&placement.id) else {
            return false;
        };
        let started = Instant::now();
        let mut player = asset.video.as_ref().and_then(|player| player.lock().ok());
        let video_frame = player.as_mut().and_then(|player| {
            let elapsed = scaled_elapsed_ms(elapsed_ms, placement.speed);
            let timestamp = if placement.loop_playback {
                elapsed % asset.cycle_ms
            } else {
                elapsed.min(asset.cycle_ms)
            };
            player.frame_at(timestamp)
        });
        let frame = frame_index(asset, elapsed_ms, placement.speed, placement.loop_playback);
        let mut frames = asset.decoded_frames.lock().unwrap();
        if !asset.frames.is_empty() && frames.is_empty() {
            for range in &asset.frames {
                let Ok(bytes) = crate::background::decode_base64(&self.encoded()[range.clone()]) else { return false; };
                frames.push(bytes.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect());
            }
            self.encoded.release_pages();
        }
        let source_format = video_frame
            .map(|frame| frame.format.as_str())
            .unwrap_or("rgb565");
        let (source, source_width, source_height) = if let Some(frame) = video_frame {
            (FramePixels::Decoded(frame), frame.width, frame.height)
        } else if let Some(frame) = frames.get(frame) {
            (FramePixels::Rgb565(frame), asset.width, asset.height)
        } else {
            return false;
        };
        let decoded = Instant::now();
        blit_fitted_clipped(
            source,
            source_width,
            source_height,
            target,
            width,
            height,
            surface.x.round() as isize,
            surface.y.round() as isize,
            surface.width.round().max(1.0) as usize,
            surface.height.round().max(1.0) as usize,
            placement.fit,
            surface.clip,
        );
        log::debug!(target: "onekvm_screen_display::profile", "home media format={} frame_us={} blit_us={}",
            source_format, decoded.duration_since(started).as_micros(), decoded.elapsed().as_micros());
        true
    }
}

fn status_active(source: &str, status: &Value) -> bool {
    if source == "live" {
        return status.pointer("/video/session_count").and_then(Value::as_u64).unwrap_or(0) > 0;
    }
    let key = match source {
        "eth" => "/network/ethernet_connected",
        "hid" => "/hid/connected",
        "wifi" => "/network/wifi_connected",
        "live" => "/video/active",
        _ => "/video/hdmi_connected",
    };
    status
        .pointer(key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn dimension(value: &Value, key: &str) -> Result<usize, String> {
    dimension_with_limit(value, key, MAX_SIDE)
}

fn dimension_with_limit(value: &Value, key: &str, max: usize) -> Result<usize, String> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| (1..=max).contains(value))
        .ok_or_else(|| format!("invalid media {key}"))
}

fn number(value: Option<&Value>, fallback: f64, min: f64, max: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
        .clamp(min, max)
}

#[cfg(test)]
fn placements(layout_json: &str) -> Vec<Placement> {
    placements_with_status(layout_json, &Value::Null)
}

fn placements_with_status(layout_json: &str, status: &Value) -> Vec<Placement> {
    let Ok(layout) = serde_json::from_str::<Value>(layout_json) else {
        return Vec::new();
    };
    let Some(widgets) = layout.get("home_widgets").and_then(Value::as_array) else {
        return Vec::new();
    };
    widgets
        .iter()
        .enumerate()
        .filter_map(|(slot, value)| {
            let item = value.as_object()?;
            if item.get("hidden").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let id = item.get("id")?.as_str()?;
            if id.starts_with("dashboard-")
                && layout.get("face").and_then(Value::as_str) != Some("screen-display/dashboard")
            {
                return None;
            }
            let source = item.get("widget").and_then(Value::as_str).unwrap_or(id);
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            let asset_id = if kind == "status" || source == "screen-display/status" {
                if matches!(item.get("status_style").and_then(Value::as_str), Some("text" | "icon")) {
                    return None;
                }
                let active = status_active(
                    item.get("status").and_then(Value::as_str).unwrap_or("hdmi"),
                    status,
                );
                item.get(if active {
                    "status_active_image"
                } else {
                    "status_inactive_image"
                })?
                .as_str()?
            } else if kind == "media" || source == "screen-display/media" {
                item.get("media_asset")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
            } else {
                return None;
            };
            let fit = match item.get("media_fit").and_then(Value::as_str) {
                Some("cover") => MediaFit::Cover,
                Some("fill") => MediaFit::Fill,
                _ => MediaFit::Contain,
            };
            Some(Placement {
                id: asset_id.to_string(),
                slot,
                fit,
                speed: number(item.get("media_speed"), 1.0, 0.25, 2.0),
                loop_playback: item
                    .get("media_loop")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            })
        })
        .take(32)
        .collect()
}

fn scaled_elapsed_ms(elapsed_ms: u64, speed: f64) -> u64 {
    ((elapsed_ms as f64) * speed.clamp(0.25, 2.0)).min(u64::MAX as f64) as u64
}

// Returns an absolute frame token and time until its successor. Tokens include
// the loop count, so playback restarts even when the first/last picture match.
fn frame_schedule(
    asset: &MediaAsset,
    elapsed_ms: u64,
    placement: &Placement,
) -> (u64, Option<u64>) {
    let elapsed = scaled_elapsed_ms(elapsed_ms, placement.speed);
    let looping = placement.loop_playback;
    let position = if looping {
        elapsed % asset.cycle_ms
    } else {
        elapsed.min(asset.cycle_ms)
    };
    let cycle = if looping { elapsed / asset.cycle_ms } else { 0 };
    let (index, count, next) = if let Some(player) = &asset.video {
        let player = player.lock().unwrap();
        let Some(player) = player.player.as_ref() else {
            return (0, Some(player.retry_after.saturating_duration_since(Instant::now()).as_millis().min(1000) as u64));
        };
        let samples = &player.demuxed.samples;
        let index = samples.partition_point(|sample| sample.timestamp_ms <= position);
        (
            index,
            samples.len() + 1,
            samples
                .get(index)
                .map(|sample| sample.timestamp_ms)
                .unwrap_or(asset.cycle_ms),
        )
    } else {
        let index = frame_index(asset, elapsed_ms, placement.speed, looping);
        (
            index,
            asset.frames.len(),
            asset.durations[..=index].iter().sum(),
        )
    };
    let delay = if !looping && elapsed >= asset.cycle_ms {
        None
    } else {
        Some(((next.saturating_sub(position).max(1) as f64 / placement.speed).ceil() as u64).max(1))
    };
    (
        cycle
            .saturating_mul(count as u64)
            .saturating_add(index as u64),
        delay,
    )
}

fn frame_index(asset: &MediaAsset, elapsed_ms: u64, speed: f64, loop_playback: bool) -> usize {
    let elapsed_ms = scaled_elapsed_ms(elapsed_ms, speed);
    if !loop_playback && elapsed_ms >= asset.cycle_ms {
        return asset.frames.len().saturating_sub(1);
    }
    let mut cursor = if loop_playback {
        elapsed_ms % asset.cycle_ms
    } else {
        elapsed_ms
    };
    for (index, duration) in asset.durations.iter().enumerate() {
        if cursor < *duration {
            return index;
        }
        cursor -= *duration;
    }
    asset.frames.len().saturating_sub(1)
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
fn blit_fitted(
    source: &[u16],
    source_width: usize,
    source_height: usize,
    target: &mut [u16],
    target_width: usize,
    target_height: usize,
    left: isize,
    top: isize,
    box_width: usize,
    box_height: usize,
    fit: MediaFit,
) {
    blit_fitted_clipped(
        FramePixels::Rgb565(source),
        source_width,
        source_height,
        target,
        target_width,
        target_height,
        left,
        top,
        box_width,
        box_height,
        fit,
        DamageRect::new(0, 0, target_width as i32, target_height as i32),
    );
}

#[allow(clippy::too_many_arguments)]
fn blit_fitted_clipped(
    source: FramePixels<'_>,
    source_width: usize,
    source_height: usize,
    target: &mut [u16],
    target_width: usize,
    target_height: usize,
    left: isize,
    top: isize,
    box_width: usize,
    box_height: usize,
    fit: MediaFit,
    clip: DamageRect,
) {
    if source_width == 0 || source_height == 0 || box_width == 0 || box_height == 0 {
        return;
    }
    match fit {
        MediaFit::Fill => blit_scaled_region(
            source,
            source_width,
            source_height,
            0,
            0,
            source_width,
            source_height,
            target,
            target_width,
            target_height,
            left,
            top,
            box_width,
            box_height,
            clip,
        ),
        MediaFit::Contain => {
            let scale = (box_width as f64 / source_width as f64)
                .min(box_height as f64 / source_height as f64);
            let draw_width = ((source_width as f64 * scale).round() as usize)
                .max(1)
                .min(box_width);
            let draw_height = ((source_height as f64 * scale).round() as usize)
                .max(1)
                .min(box_height);
            blit_scaled_region(
                source,
                source_width,
                source_height,
                0,
                0,
                source_width,
                source_height,
                target,
                target_width,
                target_height,
                left + (box_width - draw_width) as isize / 2,
                top + (box_height - draw_height) as isize / 2,
                draw_width,
                draw_height,
                clip,
            );
        }
        MediaFit::Cover => {
            let source_ratio = source_width as f64 / source_height as f64;
            let target_ratio = box_width as f64 / box_height as f64;
            let (source_left, source_top, crop_width, crop_height) = if source_ratio > target_ratio
            {
                let crop_width = ((source_height as f64 * target_ratio).round() as usize)
                    .max(1)
                    .min(source_width);
                (
                    (source_width - crop_width) / 2,
                    0,
                    crop_width,
                    source_height,
                )
            } else {
                let crop_height = ((source_width as f64 / target_ratio).round() as usize)
                    .max(1)
                    .min(source_height);
                (
                    0,
                    (source_height - crop_height) / 2,
                    source_width,
                    crop_height,
                )
            };
            blit_scaled_region(
                source,
                source_width,
                source_height,
                source_left,
                source_top,
                crop_width,
                crop_height,
                target,
                target_width,
                target_height,
                left,
                top,
                box_width,
                box_height,
                clip,
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
fn blit_scaled(
    source: &[u16],
    source_width: usize,
    source_height: usize,
    target: &mut [u16],
    target_width: usize,
    target_height: usize,
    left: isize,
    top: isize,
    draw_width: usize,
    draw_height: usize,
) {
    blit_scaled_region(
        FramePixels::Rgb565(source),
        source_width,
        source_height,
        0,
        0,
        source_width,
        source_height,
        target,
        target_width,
        target_height,
        left,
        top,
        draw_width,
        draw_height,
        DamageRect::new(0, 0, target_width as i32, target_height as i32),
    );
}

#[allow(clippy::too_many_arguments)]
fn blit_scaled_region(
    source: FramePixels<'_>,
    source_width: usize,
    source_height: usize,
    source_left: usize,
    source_top: usize,
    source_region_width: usize,
    source_region_height: usize,
    target: &mut [u16],
    target_width: usize,
    target_height: usize,
    left: isize,
    top: isize,
    draw_width: usize,
    draw_height: usize,
    clip: DamageRect,
) {
    if source.len() < source_width.saturating_mul(source_height)
        || target.len() < target_width.saturating_mul(target_height)
        || source_left >= source_width
        || source_top >= source_height
        || source_region_width == 0
        || source_region_height == 0
        || draw_width == 0
        || draw_height == 0
    {
        return;
    }
    let source_region_width = source_region_width.min(source_width - source_left);
    let source_region_height = source_region_height.min(source_height - source_top);
    let x0 = (clip.x0.max(0) as isize - left).clamp(0, draw_width as isize) as usize;
    let x1 =
        (clip.x1.min(target_width as i32) as isize - left).clamp(0, draw_width as isize) as usize;
    let y0 = (clip.y0.max(0) as isize - top).clamp(0, draw_height as isize) as usize;
    let y1 =
        (clip.y1.min(target_height as i32) as isize - top).clamp(0, draw_height as isize) as usize;
    if x0 >= x1 || y0 >= y1 {
        return;
    }

    // Map destination coordinates with fixed-point increments. The previous
    // implementation divided for every pixel; the compositor now performs
    // only one division per axis and advances both mappings incrementally.
    let x_step = ((source_region_width as u64) << 32) / draw_width as u64;
    let y_step = ((source_region_height as u64) << 32) / draw_height as u64;
    let mut source_y_fp = y0 as u64 * y_step;
    for y in y0..y1 {
        let target_y = top + y as isize;
        let source_y = source_top + ((source_y_fp >> 32) as usize).min(source_region_height - 1);
        source_y_fp = source_y_fp.saturating_add(y_step);
        let mut source_x_fp = x0 as u64 * x_step;
        let target_start = target_y as usize * target_width + (left + x0 as isize) as usize;
        for x in x0..x1 {
            let source_x =
                source_left + ((source_x_fp >> 32) as usize).min(source_region_width - 1);
            source_x_fp = source_x_fp.saturating_add(x_step);
            target[target_start + x - x0] = source.pixel(source_y * source_width + source_x);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{blit_fitted, blit_scaled, frame_index, placements, MediaFit, MediaLibrary};
    use pocketjs_core::{spec::draw_op, Ui};

    #[test]
    fn scheduling_tracks_frame_boundaries_speed_loop_and_completion() {
        let asset = super::MediaAsset {
            width: 1,
            height: 1,
            durations: vec![100, 200],
            frames: vec![0..0, 0..0],
            decoded_frames: std::sync::Mutex::new(Vec::new()),
            cycle_ms: 300,
            video: None,
        };
        let mut placement = super::Placement {
            id: "clip".into(),
            slot: 0,
            fit: MediaFit::Contain,
            speed: 1.0,
            loop_playback: true,
        };
        assert_eq!(super::frame_schedule(&asset, 0, &placement), (0, Some(100)));
        assert_eq!(super::frame_schedule(&asset, 99, &placement), (0, Some(1)));
        assert_eq!(
            super::frame_schedule(&asset, 100, &placement),
            (1, Some(200))
        );
        assert_eq!(
            super::frame_schedule(&asset, 300, &placement),
            (2, Some(100))
        );
        placement.speed = 2.0;
        assert_eq!(super::frame_schedule(&asset, 25, &placement), (0, Some(25)));
        placement.loop_playback = false;
        assert_eq!(super::frame_schedule(&asset, 160, &placement), (1, None));
    }

    #[test]
    fn media_outside_the_guest_scene_does_not_schedule_a_busy_loop() {
        let library = MediaLibrary::parse(r#"{"v":1,"assets":{"clip":{"v":1,"name":"clip.gif","format":"gif","width":1,"height":1,"durations":[100,100],"frames":["AQA=","AgA="]}}}"#).unwrap().unwrap();
        let layout = r#"{"home_widgets":[{"id":"clip","kind":"media"}]}"#;
        assert_eq!(library.animation_delay_ms(layout, "{}"), Some(0));
        let mut ui = Ui::new();
        ui.set_viewport(4.0, 3.0);
        library.paint_scene(layout, "{}", &ui, &[], &mut [0; 12]);
        assert_eq!(library.animation_delay_ms(layout, "{}"), None);
    }

    #[test]
    fn video_scheduling_uses_compressed_sample_timestamps_and_stops_after_the_end() {
        let player = super::VideoPlayer::new(
            crate::video_decode::demux_mp4(include_bytes!("../tests/fixtures/main-b-frames.mp4"))
                .unwrap(),
        )
        .unwrap();
        let cycle_ms = player
            .demuxed
            .samples
            .last()
            .map(|sample| sample.timestamp_ms + sample.duration_ms)
            .unwrap();
        let asset = super::MediaAsset {
            width: 64,
            height: 48,
            durations: vec![cycle_ms],
            frames: vec![],
            decoded_frames: std::sync::Mutex::new(Vec::new()),
            cycle_ms,
            video: Some(std::sync::Arc::new(std::sync::Mutex::new(player.into()))),
        };
        let mut placement = super::Placement {
            id: "clip".into(),
            slot: 0,
            fit: MediaFit::Contain,
            speed: 1.0,
            loop_playback: false,
        };
        let (first, wait) = super::frame_schedule(&asset, 0, &placement);
        assert_eq!(wait, Some(41)); // The regression fixture is 24 FPS.
        assert!(super::frame_schedule(&asset, 100, &placement).0 > first);
        assert_eq!(
            super::frame_schedule(&asset, cycle_ms + 100, &placement).1,
            None
        );
        placement.loop_playback = true;
        assert!(super::frame_schedule(&asset, cycle_ms, &placement).0 > first);
    }

    #[test]
    fn file_video_keeps_no_index_until_used_and_releases_it_after_removal() {
        struct Directory(std::path::PathBuf);
        impl Drop for Directory {
            fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
        }
        let directory = Directory(std::env::temp_dir().join(format!("screen-video-lazy-{}-{}",
            std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos())));
        std::fs::create_dir_all(&directory.0).unwrap();
        let name = "0123456789abcdef0123456789abcdef.mp4";
        let bytes = include_bytes!("../tests/fixtures/main-b-frames.mp4");
        std::fs::write(directory.0.join(name), bytes).unwrap();
        let raw = serde_json::json!({"v":3,"assets":{"clip":{
            "v":3,"format":"mp4","name":"clip.mp4","file":name,"size_bytes":bytes.len(),
            "width":64,"height":48,"duration_ms":1000,"codec":"h264","container":"mp4"
        }}}).to_string();
        let mut library = MediaLibrary::parse_with_directory(&raw, &directory.0).unwrap().unwrap();
        let metadata = directory.0.join("metadata.json");
        std::fs::write(&metadata, &raw).unwrap();
        library.map_metadata(&metadata);
        assert!(matches!(library.encoded, crate::file_blob::FileBlob::Mapped(_)));
        std::fs::write(directory.0.join("replacement"), "{}").unwrap();
        std::fs::rename(directory.0.join("replacement"), &metadata).unwrap();
        assert_eq!(library.encoded_owned(), raw);
        let video = library.assets["clip"].video.as_ref().unwrap();
        assert!(video.lock().unwrap().player.is_none());
        video.lock().unwrap().frame_at(500);
        assert!(video.lock().unwrap().player.is_some());
        library.animation_delay_ms("{}", "{}");
        assert!(video.lock().unwrap().player.is_none());
        // The same asset can be used again without re-importing or changing metadata.
        video.lock().unwrap().frame_at(500);
        assert!(video.lock().unwrap().player.is_some());
        assert_eq!(library.encoded(), raw);
    }

    #[test]
    fn lagged_video_seeks_to_the_latest_safe_keyframe() {
        let samples: Vec<crate::video_decode::VideoSample> = (0..16)
            .map(|index| crate::video_decode::VideoSample {
                bytes: vec![1],
                timestamp_ms: index * 10,
                presentation_ms: index * 10,
                duration_ms: 10,
                is_sync: index == 0 || index == 8,
            })
            .collect();
        assert_eq!(
            super::keyframe_seek_target(&samples, 1, 110),
            Some((8, 12, 11))
        );
        assert_eq!(super::keyframe_seek_target(&samples, 7, 110), None);
        assert_eq!(super::keyframe_seek_target(&samples, 9, 30), None);
    }

    fn paint(
        library: &MediaLibrary,
        layout: &str,
        status: &str,
        pixels: &mut [u16],
        width: usize,
        height: usize,
    ) {
        let mut ui = Ui::new();
        ui.set_viewport(width as f32, height as f32);
        let widgets: serde_json::Value = serde_json::from_str(layout).unwrap();
        let mut words = Vec::new();
        for (slot, _) in widgets["home_widgets"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            words.extend_from_slice(&[
                draw_op::SURFACE_QUAD,
                slot as u32,
                0f32.to_bits(),
                0f32.to_bits(),
                (width as f32).to_bits(),
                (height as f32).to_bits(),
                0,
                width as u32 | ((height as u32) << 16),
                0,
            ]);
        }
        library.paint_scene(layout, status, &ui, &words, pixels);
    }

    #[test]
    fn parses_and_selects_timed_frames() {
        let library = MediaLibrary::parse(
            r#"{"v":1,"assets":{"home-media-1":{"v":1,"name":"a.gif","format":"gif","width":1,"height":1,"durations":[100,200],"frames":["AQA=","AgA="]}}}"#,
        )
        .unwrap()
        .unwrap();
        let asset = &library.assets["home-media-1"];
        assert_eq!(frame_index(asset, 0, 1.0, true), 0);
        assert_eq!(frame_index(asset, 99, 1.0, true), 0);
        assert_eq!(frame_index(asset, 100, 1.0, true), 1);
        assert_eq!(frame_index(asset, 299, 1.0, true), 1);
        assert_eq!(frame_index(asset, 300, 1.0, true), 0);
        assert_eq!(frame_index(asset, 49, 2.0, true), 0);
        assert_eq!(frame_index(asset, 50, 2.0, true), 1);
        assert_eq!(frame_index(asset, 300, 1.0, false), 1);
        assert_eq!(frame_index(asset, 900, 2.0, false), 1);
    }

    #[test]
    fn rejects_wrong_frame_length() {
        let error = MediaLibrary::parse(
            r#"{"v":1,"assets":{"x":{"v":1,"name":"x","format":"gif","width":2,"height":1,"durations":[100],"frames":["AQA="]}}}"#,
        )
        .unwrap_err();
        assert!(error.contains("expected 4"));
    }

    #[test]
    fn rejects_unknown_asset_metadata() {
        let error = MediaLibrary::parse(
            r#"{"v":1,"assets":{"x":{"v":2,"name":"x","format":"png","width":1,"height":1,"durations":[100],"frames":["AQA="]}}}"#,
        )
        .unwrap_err();
        assert!(error.contains("version"));
    }

    #[test]
    fn blits_scaled_and_clips() {
        let mut target = [0u16; 12];
        blit_scaled(&[1, 2], 2, 1, &mut target, 4, 3, -1, 1, 4, 2);
        assert_eq!(target, [0, 0, 0, 0, 1, 2, 2, 0, 1, 2, 2, 0]);
    }

    #[test]
    fn contains_and_covers_without_distorting_media() {
        let mut contained = [0u16; 8];
        blit_fitted(
            &[1, 2, 3, 4],
            2,
            2,
            &mut contained,
            4,
            2,
            0,
            0,
            4,
            2,
            MediaFit::Contain,
        );
        assert_eq!(contained, [0, 1, 2, 0, 0, 3, 4, 0]);

        let mut covered = [0u16; 4];
        blit_fitted(
            &[1, 2, 3, 4, 5, 6, 7, 8],
            4,
            2,
            &mut covered,
            2,
            2,
            0,
            0,
            2,
            2,
            MediaFit::Cover,
        );
        assert_eq!(covered, [2, 3, 6, 7]);
    }

    #[test]
    fn status_icons_ignore_saved_images_and_live_uses_session_count() {
        let layout = r#"{"home_widgets":[{"id":"state","kind":"status","status_style":"icon","status_active_image":"on","status_inactive_image":"off"}]}"#;
        assert!(placements(layout).is_empty());
        assert!(!super::status_active("live", &serde_json::json!({"video":{"active":true,"session_count":0}})));
        assert!(super::status_active("live", &serde_json::json!({"video":{"active":false,"session_count":2}})));
    }

    #[test]
    fn parses_static_images_and_media_playback_settings() {
        let library = MediaLibrary::parse(
            r#"{"v":1,"assets":{"home-media-1":{"v":1,"name":"still.png","format":"image","width":1,"height":1,"durations":[1000],"frames":["AQA="]}}}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(library.assets["home-media-1"].frames.len(), 1);
        let frames = &library.assets["home-media-1"].decoded_frames;
        assert!(frames.lock().unwrap().is_empty());
        let layout = r#"{"home_widgets":[{"id":"home-media-1","kind":"media"}]}"#;
        let mut pixels = [0u16; 4];
        paint(&library, layout, "{}", &mut pixels, 2, 2);
        assert_eq!(pixels, [1; 4]);
        assert_eq!(*frames.lock().unwrap(), vec![vec![1]]);
        library.animation_delay_ms(r#"{"home_widgets":[]}"#, "{}");
        assert!(frames.lock().unwrap().is_empty());
        pixels.fill(0);
        paint(&library, layout, "{}", &mut pixels, 2, 2);
        assert_eq!(pixels, [1; 4]);

        let parsed = placements(
            r#"{"mode":"free","home_widgets":[{"id":"home-media-1","kind":"media","media_fit":"cover","media_speed":1.5,"media_loop":false}]}"#,
        );
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].fit, MediaFit::Cover);
        assert_eq!(parsed[0].speed, 1.5);
        assert!(!parsed[0].loop_playback);
    }

    #[test]
    fn hidden_media_is_not_painted() {
        let library = MediaLibrary::parse(
            r#"{"v":1,"assets":{"home-media-1":{"v":1,"name":"a.gif","format":"gif","width":1,"height":1,"durations":[100],"frames":["AQA="]}}}"#,
        )
        .unwrap()
        .unwrap();
        let mut target = [0u16; 16];
        paint(
            &library,
            r#"{"mode":"free","home_widgets":[{"id":"home-media-1","kind":"media","hidden":true}]}"#,
            "{}",
            &mut target,
            4,
            4,
        );
        assert_eq!(target, [0; 16]);
    }

    #[test]
    fn shared_media_and_status_images_paint_selected_library_frames() {
        let library = MediaLibrary::parse(r#"{"v":1,"assets":{"on":{"v":1,"name":"on","format":"image","width":1,"height":1,"durations":[1000],"frames":["AQA="]},"off":{"v":1,"name":"off","format":"image","width":1,"height":1,"durations":[1000],"frames":["AgA="]}}}"#).unwrap().unwrap();
        let layout = r#"{"mode":"free","home_widgets":[{"id":"status","kind":"status","status":"hdmi","status_active_image":"on","status_inactive_image":"off","x":50,"y":50,"width":2,"height":2}]}"#;
        let mut pixels = [0u16; 4];
        assert!(library.has_visible(layout));
        paint(
            &library,
            layout,
            r#"{"video":{"hdmi_connected":true}}"#,
            &mut pixels,
            2,
            2,
        );
        assert_eq!(pixels, [1; 4]);
        paint(
            &library,
            layout,
            r#"{"video":{"hdmi_connected":false}}"#,
            &mut pixels,
            2,
            2,
        );
        assert_eq!(pixels, [2; 4]);
        let media = r#"{"mode":"free","home_widgets":[{"id":"media","kind":"media","media_asset":"on","x":50,"y":50,"width":2,"height":2}]}"#;
        paint(&library, media, "{}", &mut pixels, 2, 2);
        assert_eq!(pixels, [1; 4]);
    }

    #[test]
    fn hidden_slots_do_not_shift_media_and_later_widgets_cover_only_their_pixels() {
        let library = MediaLibrary::parse(r#"{"v":1,"assets":{"clip":{"v":1,"format":"image","width":1,"height":1,"durations":[1000],"frames":["//8="]}}}"#).unwrap().unwrap();
        let layout = r#"{"home_widgets":[{"id":"hidden","kind":"media","hidden":true},{"id":"card","kind":"rect"},{"id":"video","kind":"media","media_asset":"clip","media_fit":"fill"}]}"#;
        let mut ui = Ui::new();
        ui.set_viewport(4.0, 2.0);
        let words = [
            draw_op::RECT,
            0,
            4 | (2 << 16),
            0xff0000ff,
            // The media is clipped without shifting its unclipped origin.
            draw_op::SURFACE_QUAD,
            2,
            (-1f32).to_bits(),
            0f32.to_bits(),
            4f32.to_bits(),
            2f32.to_bits(),
            0,
            3 | (2 << 16),
            0,
            draw_op::RECT,
            1,
            1 | (2 << 16),
            0xff00ff00,
        ];
        let mut pixels = [0; 8];
        library.paint_scene(layout, "{}", &ui, &words, &mut pixels);
        assert_eq!(
            pixels,
            [0xffff, 0x07e0, 0xffff, 0xf800, 0xffff, 0x07e0, 0xffff, 0xf800]
        );
    }

    #[test]
    fn accepts_sixty_fps_frame_durations() {
        let library = MediaLibrary::parse(r#"{"v":1,"assets":{"clip":{"v":1,"name":"clip","format":"h264","width":1,"height":1,"durations":[17,16,17],"frames":["AQA=","AgA=","AwA="]}}}"#).unwrap().unwrap();
        let asset = &library.assets["clip"];
        assert_eq!(frame_index(asset, 17, 1.0, true), 1);
        assert_eq!(frame_index(asset, 33, 1.0, true), 2);
        assert_eq!(frame_index(asset, 50, 1.0, true), 0);
    }
}
