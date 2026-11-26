//! MP4 demuxing and pluggable H.264 decoding for media widgets.
//!
//! The container is deliberately independent from the decoder.  Devices with
//! a V4L2/vendor decoder can implement [`VideoDecoderBackend`] without changing
//! the saved asset format or compositor. Pro uses the platform VDEC ABI;
//! other builds retain OpenH264 where no platform decoder is selected.

use std::fs::File;
use std::io::{Cursor, Read, Seek};
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use mp4::{MediaType, Mp4Reader, TrackType};
use openh264::decoder::{DecodeOptions, Decoder, DecoderConfig, Flush};
use openh264::formats::YUVSource;

#[derive(Clone, Debug)]
pub struct VideoConfig {
    pub width: usize,
    pub height: usize,
    pub timescale: u32,
    pub sps: Vec<u8>,
    pub pps: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct VideoSample {
    pub bytes: Vec<u8>,
    pub timestamp_ms: u64,
    pub presentation_ms: u64,
    pub duration_ms: u64,
    pub is_sync: bool,
}

#[derive(Debug)]
pub struct DemuxedVideo {
    pub config: VideoConfig,
    pub samples: Vec<VideoSample>,
    source: Option<(Mp4Reader<File>, u32)>,
}

impl DemuxedVideo {
    pub fn sample(&mut self, index: usize) -> Result<VideoSample> {
        let mut sample = self.samples.get(index).context("MP4 sample index")?.clone();
        if let Some((reader, track)) = &mut self.source {
            let encoded = reader.read_sample(*track, index as u32 + 1)?.context("missing MP4 sample")?;
            sample.bytes = length_prefixed_to_annex_b(&encoded.bytes)?;
        }
        Ok(sample)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DecodedPixelFormat {
    /// Planar Y, U, V with tightly packed rows.
    #[default]
    I420,
    /// Semi-planar Y followed by interleaved U, V.
    Nv12,
    /// Semi-planar Y followed by interleaved V, U.
    Nv21,
    /// Little-endian 16-bit RGB565.
    Rgb565,
}

impl DecodedPixelFormat {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::I420 => "i420",
            Self::Nv12 => "nv12",
            Self::Nv21 => "nv21",
            Self::Rgb565 => "rgb565",
        }
    }
}

#[derive(Default, Debug)]
pub struct DecodedFrame {
    pub width: usize,
    pub height: usize,
    pub timestamp_ms: u64,
    pub limited_range: bool,
    pub format: DecodedPixelFormat,
    /// Tightly packed native output, reused for every decoded picture. Keeping
    /// the decoder's native NV12/NV21/RGB565 layout avoids a conversion before
    /// the framebuffer compositor consumes the frame.
    pub pixels: Vec<u8>,
}

impl DecodedFrame {
    pub fn pixel_count(&self) -> usize {
        self.width.saturating_mul(self.height)
    }

    /// Read one visible pixel as the panel's little-endian RGB565 value. This
    /// is a direct load for hardware RGB565 and a fixed-point conversion for
    /// YUV formats.
    pub fn rgb565(&self, index: usize) -> u16 {
        if self.width == 0 || index >= self.pixel_count() {
            return 0;
        }
        let (x, y) = (index % self.width, index / self.width);
        if self.format == DecodedPixelFormat::Rgb565 {
            let offset = index.saturating_mul(2);
            return u16::from_le_bytes([self.pixels[offset], self.pixels[offset + 1]]);
        }

        let chroma_width = self.width.div_ceil(2);
        let chroma_height = self.height.div_ceil(2);
        let chroma = y / 2 * chroma_width + x / 2;
        let plane = self.width * self.height;
        let (u, v) = match self.format {
            DecodedPixelFormat::I420 => {
                let chroma_len = chroma_width * chroma_height;
                (
                    self.pixels[plane + chroma],
                    self.pixels[plane + chroma_len + chroma],
                )
            }
            DecodedPixelFormat::Nv12 => {
                let offset = plane + chroma * 2;
                (self.pixels[offset], self.pixels[offset + 1])
            }
            DecodedPixelFormat::Nv21 => {
                let offset = plane + chroma * 2;
                (self.pixels[offset + 1], self.pixels[offset])
            }
            DecodedPixelFormat::Rgb565 => unreachable!(),
        };
        let y = i32::from(self.pixels[index]);
        let luma = if self.limited_range {
            (y - 16) * 1192
        } else {
            y * 1024
        };
        let u = i32::from(u) - 128;
        let v = i32::from(v) - 128;
        // BT.601 fixed-point conversion. The result is written directly to
        // the framebuffer format, so no temporary RGB buffer is allocated.
        let (rv, gu, gv, bu) = if self.limited_range {
            (1634, 401, 833, 2066)
        } else {
            (1436, 352, 731, 1815)
        };
        let r = ((luma + rv * v) >> 10).clamp(0, 255) as u16;
        let g = ((luma - gu * u - gv * v) >> 10).clamp(0, 255) as u16;
        let b = ((luma + bu * u) >> 10).clamp(0, 255) as u16;
        ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)
    }
}

/// Decoder contract shared by software and device-specific hardware backends.
pub trait VideoDecoderBackend: Send {
    fn configure(&mut self, config: &VideoConfig) -> Result<()>;
    fn decode_sample(&mut self, sample: &VideoSample) -> Result<bool>;
    fn frame(&self) -> Option<&DecodedFrame>;
    fn finish(&mut self) -> Result<bool> {
        Ok(false)
    }
}

#[cfg(feature = "platform-vdec")]
fn copy_plane_tight(
    destination: &mut [u8],
    plane: &onekvm_video::decoder::DecodedPlane<'_>,
    row_bytes: usize,
    rows: usize,
) -> Result<()> {
    let source = plane
        .bytes()
        .ok_or_else(|| anyhow!("VDEC output has no CPU mapping"))?;
    let stride = plane.stride() as usize;
    if stride < row_bytes || destination.len() < row_bytes.saturating_mul(rows) {
        return Err(anyhow!("invalid VDEC plane stride"));
    }
    let packed_size = row_bytes.saturating_mul(rows);
    if stride == row_bytes {
        if source.len() < packed_size {
            return Err(anyhow!("VDEC plane is shorter than its stride"));
        }
        destination[..packed_size].copy_from_slice(&source[..packed_size]);
        return Ok(());
    }
    for row in 0..rows {
        let source_start = row * stride;
        let source_end = source_start + row_bytes;
        if source_end > source.len() {
            return Err(anyhow!("VDEC plane is shorter than its stride"));
        }
        let destination_start = row * row_bytes;
        destination[destination_start..destination_start + row_bytes]
            .copy_from_slice(&source[source_start..source_end]);
    }
    Ok(())
}

pub fn backend() -> Result<Box<dyn VideoDecoderBackend>> {
    #[cfg(all(feature = "platform-vdec", not(test)))]
    {
        return Ok(Box::new(PlatformH264Backend::new()?));
    }
    #[cfg(any(not(feature = "platform-vdec"), test))]
    Ok(Box::new(SoftwareH264Backend::new()))
}

#[cfg(feature = "platform-vdec")]
struct PlatformH264Backend {
    backend: std::sync::Arc<onekvm_video::LoadedBackend>,
    decoder: Option<onekvm_video::decoder::Decoder>,
    output_format: onekvm_video::PixelFormat,
    headers: Vec<u8>,
    frame: DecodedFrame,
    ready: bool,
    eos: bool,
}

#[cfg(feature = "platform-vdec")]
impl PlatformH264Backend {
    fn new() -> Result<Self> {
        let backend = onekvm_video::discover("").context("load platform VDEC backend")?;
        let caps = backend
            .decoder_capabilities()?
            .ok_or_else(|| anyhow!("platform VDEC ABI is unavailable"))?;
        // Prefer a format the panel can consume directly. A backend may expose
        // only YUV formats; in that case NV12/NV21 still avoid the old
        // NV12 -> I420 conversion and YUV420P remains the portable fallback.
        let output_format = [
            onekvm_video::PixelFormat::Rgb565,
            onekvm_video::PixelFormat::Nv12,
            onekvm_video::PixelFormat::Nv21,
            onekvm_video::PixelFormat::Yuv420p,
        ]
        .into_iter()
        .find(|format| caps.pixel_format_mask & (1u64 << format.to_abi()) != 0)
        .ok_or_else(|| anyhow!("platform VDEC exposes no supported framebuffer format"))?;
        log::info!(
            "home video uses hardware VDEC: {} (output {})",
            caps.name,
            output_format.as_str()
        );
        Ok(Self {
            backend,
            decoder: None,
            output_format,
            headers: Vec::new(),
            frame: DecodedFrame::default(),
            ready: false,
            eos: false,
        })
    }

    fn receive(&mut self, wait_ms: u32) -> Result<bool> {
        use onekvm_video::decoder::DecoderOutput;
        let decoder = self
            .decoder
            .as_mut()
            .ok_or_else(|| anyhow!("VDEC is not configured"))?;
        let mut changed = false;
        // The decoder output is copied once into a reusable, tightly packed
        // buffer. Preserve its native format so the compositor can avoid a
        // second NV12/NV21 -> I420 conversion.
        let mut wait = wait_ms;
        loop {
            match decoder.receive(wait)? {
                DecoderOutput::Picture(picture) => {
                    let (w, h) = (picture.width() as usize, picture.height() as usize);
                    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
                    let format = match picture.pixel_format() {
                        onekvm_video::PixelFormat::Yuv420p => DecodedPixelFormat::I420,
                        onekvm_video::PixelFormat::Nv12 => DecodedPixelFormat::Nv12,
                        onekvm_video::PixelFormat::Nv21 => DecodedPixelFormat::Nv21,
                        onekvm_video::PixelFormat::Rgb565 => DecodedPixelFormat::Rgb565,
                        other => return Err(anyhow!("unsupported VDEC output {}", other.as_str())),
                    };
                    let copy_started = std::time::Instant::now();
                    match format {
                        DecodedPixelFormat::I420 => {
                            self.frame.pixels.resize(w * h + 2 * cw * ch, 0);
                            let (y_dst, chroma) = self.frame.pixels.split_at_mut(w * h);
                            let (u_dst, v_dst) = chroma.split_at_mut(cw * ch);
                            copy_plane_tight(
                                y_dst,
                                &picture
                                    .plane(0)
                                    .ok_or_else(|| anyhow!("VDEC luma is missing"))?,
                                w,
                                h,
                            )?;
                            copy_plane_tight(
                                u_dst,
                                &picture
                                    .plane(1)
                                    .ok_or_else(|| anyhow!("VDEC U plane is missing"))?,
                                cw,
                                ch,
                            )?;
                            copy_plane_tight(
                                v_dst,
                                &picture
                                    .plane(2)
                                    .ok_or_else(|| anyhow!("VDEC V plane is missing"))?,
                                cw,
                                ch,
                            )?;
                        }
                        DecodedPixelFormat::Nv12 | DecodedPixelFormat::Nv21 => {
                            self.frame.pixels.resize(w * h + 2 * cw * ch, 0);
                            let (y_dst, uv_dst) = self.frame.pixels.split_at_mut(w * h);
                            copy_plane_tight(
                                y_dst,
                                &picture
                                    .plane(0)
                                    .ok_or_else(|| anyhow!("VDEC luma is missing"))?,
                                w,
                                h,
                            )?;
                            copy_plane_tight(
                                uv_dst,
                                &picture
                                    .plane(1)
                                    .ok_or_else(|| anyhow!("VDEC chroma is missing"))?,
                                cw * 2,
                                ch,
                            )?;
                        }
                        DecodedPixelFormat::Rgb565 => {
                            self.frame.pixels.resize(w * h * 2, 0);
                            copy_plane_tight(
                                &mut self.frame.pixels,
                                &picture
                                    .plane(0)
                                    .ok_or_else(|| anyhow!("VDEC RGB565 plane is missing"))?,
                                w * 2,
                                h,
                            )?;
                        }
                    }
                    self.frame.width = w;
                    self.frame.height = h;
                    self.frame.format = format;
                    self.frame.timestamp_ms = picture.pts_ns() / 1_000_000;
                    self.frame.limited_range =
                        picture.color_range() == onekvm_video::COLOR_RANGE_LIMITED;
                    self.ready = true;
                    changed = true;
                    log::trace!(
                        target: "onekvm_screen_display::profile",
                        "home video vdec frame={}x{} format={} copy_us={}",
                        w,
                        h,
                        self.frame.format.as_str(),
                        copy_started.elapsed().as_micros()
                    );
                    // After the first picture, drain only ready output. Do
                    // not add another full timeout to every displayed frame.
                    wait = 0;
                }
                DecoderOutput::Pending | DecoderOutput::End => break,
            }
        }
        Ok(changed)
    }
}

#[cfg(feature = "platform-vdec")]
impl VideoDecoderBackend for PlatformH264Backend {
    fn configure(&mut self, config: &VideoConfig) -> Result<()> {
        use onekvm_video::{decoder::DecoderConfig, Codec};
        if let Some(decoder) = self.decoder.as_mut() {
            decoder.reset()?;
        } else {
            self.decoder = Some(self.backend.open_decoder(&DecoderConfig {
                codec: Codec::H264,
                width: config.width.next_multiple_of(16) as u32,
                height: config.height.next_multiple_of(16) as u32,
                pixel_format: self.output_format,
            })?);
        }
        self.ready = false;
        self.eos = false;
        self.headers.clear();
        for nal in [&config.sps, &config.pps] {
            self.headers.extend_from_slice(&[0, 0, 0, 1]);
            self.headers.extend_from_slice(nal);
        }
        if self
            .decoder
            .as_mut()
            .unwrap()
            .submit(&self.headers, 0, 0, true, 100)?
            != onekvm_video::decoder::SubmitResult::Accepted
        {
            return Err(anyhow!("VDEC did not accept parameter sets"));
        }
        self.receive(100)?;
        Ok(())
    }
    fn decode_sample(&mut self, sample: &VideoSample) -> Result<bool> {
        let changed = self.receive(100)?;
        let result = self
            .decoder
            .as_mut()
            .ok_or_else(|| anyhow!("VDEC is not configured"))?
            .submit(
                &sample.bytes,
                sample.presentation_ms.saturating_mul(1_000_000),
                sample.timestamp_ms,
                sample.is_sync,
                100,
            )?;
        if result != onekvm_video::decoder::SubmitResult::Accepted {
            return Err(anyhow!("VDEC input is busy"));
        }
        Ok(self.receive(100)? || changed)
    }
    fn frame(&self) -> Option<&DecodedFrame> {
        self.ready.then_some(&self.frame)
    }
    fn finish(&mut self) -> Result<bool> {
        if !self.eos {
            let decoder = self
                .decoder
                .as_mut()
                .ok_or_else(|| anyhow!("VDEC is not configured"))?;
            if decoder.end_of_stream(100)? != onekvm_video::decoder::SubmitResult::Accepted {
                return Err(anyhow!("VDEC EOS is busy"));
            }
            self.eos = true;
        }
        self.receive(100)
    }
}

/// Bundled fallback used on devices without a hardware H.264 decoder.
pub struct SoftwareH264Backend {
    decoder: Option<Decoder>,
    frame: DecodedFrame,
    ready: bool,
}

impl SoftwareH264Backend {
    pub fn new() -> Self {
        Self {
            decoder: None,
            frame: DecodedFrame::default(),
            ready: false,
        }
    }
}

impl Default for SoftwareH264Backend {
    fn default() -> Self {
        Self::new()
    }
}

impl VideoDecoderBackend for SoftwareH264Backend {
    fn configure(&mut self, config: &VideoConfig) -> Result<()> {
        self.decoder = Some(
            Decoder::with_api_config(crate::h264_codec::api()?, DecoderConfig::new())
                .context("create OpenH264 decoder")?,
        );
        self.ready = false;
        let mut headers = Vec::with_capacity(config.sps.len() + config.pps.len() + 8);
        for nal in [&config.sps, &config.pps] {
            headers.extend_from_slice(&[0, 0, 0, 1]);
            headers.extend_from_slice(nal);
        }
        self.decoder
            .as_mut()
            .unwrap()
            .decode_with_options(
                &headers,
                DecodeOptions::default().flush_after_decode(Flush::NoFlush),
            )
            .context("configure H.264 parameter sets")?;
        Ok(())
    }

    fn decode_sample(&mut self, sample: &VideoSample) -> Result<bool> {
        let started = std::time::Instant::now();
        let decoder = self
            .decoder
            .as_mut()
            .ok_or_else(|| anyhow!("decoder is not configured"))?;
        let output = decoder
            // Samples share a reference-picture buffer. Flushing between
            // samples corrupts B-frame reordering and exhausts that buffer.
            .decode_with_options(
                &sample.bytes,
                DecodeOptions::default().flush_after_decode(Flush::NoFlush),
            )
            .context("decode H.264 sample")?;
        let Some(yuv) = output else {
            return Ok(false);
        };
        let decoded = std::time::Instant::now();
        let (width, height) = yuv.dimensions();
        let (cw, ch) = (width.div_ceil(2), height.div_ceil(2));
        self.frame.pixels.resize(width * height + 2 * cw * ch, 0);
        let strides = yuv.strides();
        let mut offset = 0;
        for (plane, stride, columns, rows) in [
            (yuv.y(), strides.0, width, height),
            (yuv.u(), strides.1, cw, ch),
            (yuv.v(), strides.2, cw, ch),
        ] {
            for row in 0..rows {
                self.frame.pixels[offset..offset + columns]
                    .copy_from_slice(&plane[row * stride..row * stride + columns]);
                offset += columns;
            }
        }
        self.frame.width = width;
        self.frame.height = height;
        self.frame.format = DecodedPixelFormat::I420;
        self.frame.timestamp_ms = sample.timestamp_ms;
        self.ready = true;
        log::debug!(target: "onekvm_screen_display::profile", "home video decode_us={} copy_us={}",
            decoded.duration_since(started).as_micros(), decoded.elapsed().as_micros());
        Ok(true)
    }

    fn frame(&self) -> Option<&DecodedFrame> {
        self.ready.then_some(&self.frame)
    }
}

/// Parse an MP4 once, retaining compressed samples and timestamps only.
/// Decoded frames are produced on demand by the selected backend.
pub fn demux_mp4(data: &[u8]) -> Result<DemuxedVideo> {
    let mut reader =
        Mp4Reader::read_header(Cursor::new(data), data.len() as u64).context("parse MP4 header")?;
    let (config, samples, _) = video_index(&mut reader, true)?;
    Ok(DemuxedVideo { config, samples, source: None })
}

/// Keep the container on disk and only timestamps/keyframes in memory. Each
/// playback step reads one compressed sample, including when looping/seeking.
pub fn demux_mp4_file(path: &Path) -> Result<DemuxedVideo> {
    let file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut reader = Mp4Reader::read_header(file, size).context("parse MP4 header")?;
    let (config, samples, track) = video_index(&mut reader, false)?;
    Ok(DemuxedVideo { config, samples, source: Some((reader, track)) })
}

fn video_index<R: Read + Seek>(reader: &mut Mp4Reader<R>, retain_bytes: bool) -> Result<(VideoConfig, Vec<VideoSample>, u32)> {
    let (track_id, track) = reader
        .tracks()
        .iter()
        .find(|(_, track)| {
            track.track_type().ok() == Some(TrackType::Video)
                && track.media_type().ok() == Some(MediaType::H264)
        })
        .ok_or_else(|| anyhow!("MP4 does not contain an H.264 video track"))?;
    let track_id = *track_id;
    let config = VideoConfig {
        width: track.width() as usize,
        height: track.height() as usize,
        timescale: track.timescale(),
        sps: track
            .sequence_parameter_set()
            .context("missing H.264 SPS")?
            .to_vec(),
        pps: track
            .picture_parameter_set()
            .context("missing H.264 PPS")?
            .to_vec(),
    };
    if config.width == 0 || config.height == 0 || config.width > 4096 || config.height > 4096 {
        return Err(anyhow!("invalid MP4 video dimensions"));
    }
    // Bound a single compressed frame before the MP4 library allocates it.
    const MAX_SAMPLE_BYTES: u32 = 8 * 1024 * 1024;
    let sizes = &track.trak.mdia.minf.stbl.stsz;
    if sizes.sample_size > MAX_SAMPLE_BYTES || sizes.sample_sizes.iter().any(|size| *size > MAX_SAMPLE_BYTES)
        || track.trafs.iter().any(|traf| traf.tfhd.default_sample_size.unwrap_or(0) > MAX_SAMPLE_BYTES
            || traf.trun.as_ref().is_some_and(|trun| trun.sample_sizes.iter().any(|size| *size > MAX_SAMPLE_BYTES))) {
        return Err(anyhow!("MP4 compressed frame exceeds 8 MiB"));
    }
    let count = track.sample_count() as usize;
    if count == 0 {
        return Err(anyhow!("MP4 sample count is empty"));
    }
    let mut samples = Vec::with_capacity(count);
    for id in 1..=count as u32 {
        let sample = reader
            .read_sample(track_id, id)
            .with_context(|| format!("read MP4 sample {id}"))?
            .ok_or_else(|| anyhow!("MP4 sample {id} is missing"))?;
        let scale = config.timescale.max(1) as u64;
        samples.push(VideoSample {
            bytes: if retain_bytes { length_prefixed_to_annex_b(&sample.bytes)? } else { Vec::new() },
            timestamp_ms: sample.start_time.saturating_mul(1000) / scale,
            presentation_ms: ((i128::from(sample.start_time) + i128::from(sample.rendering_offset))
                .max(0) as u64)
                .saturating_mul(1000)
                / scale,
            duration_ms: (sample.duration as u64).saturating_mul(1000) / scale,
            is_sync: sample.is_sync,
        });
    }
    Ok((config, samples, track_id))
}

/// Convert ISO BMFF AVC samples (4-byte NAL lengths) to Annex-B packets.
pub fn length_prefixed_to_annex_b(sample: &[u8]) -> Result<Vec<u8>> {
    let mut output = Vec::with_capacity(sample.len() + 16);
    let mut cursor = 0usize;
    while cursor < sample.len() {
        if sample.len() - cursor < 4 {
            return Err(anyhow!("truncated AVC NAL length"));
        }
        let size = u32::from_be_bytes(sample[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let end = cursor
            .checked_add(size)
            .ok_or_else(|| anyhow!("AVC NAL length overflow"))?;
        if end > sample.len() || size == 0 {
            return Err(anyhow!("invalid AVC NAL length"));
        }
        output.extend_from_slice(&[0, 0, 0, 1]);
        output.extend_from_slice(&sample[cursor..end]);
        cursor = end;
    }
    if output.is_empty() {
        return Err(anyhow!("empty AVC sample"));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::{demux_mp4, length_prefixed_to_annex_b, SoftwareH264Backend, VideoDecoderBackend};

    #[test]
    fn limited_range_decoder_output_preserves_black_and_white() {
        let mut frame = super::DecodedFrame {
            width: 2,
            height: 2,
            limited_range: true,
            pixels: vec![16, 235, 16, 235, 128, 128],
            ..Default::default()
        };
        assert_eq!(frame.rgb565(0), 0);
        assert_eq!(frame.rgb565(1), 0xffff);
        frame.pixels[..4].fill(0);
        assert_eq!(frame.rgb565(0), 0);
    }

    #[test]
    fn native_semiplanar_formats_preserve_chroma_order() {
        for format in [
            super::DecodedPixelFormat::Nv12,
            super::DecodedPixelFormat::Nv21,
        ] {
            let frame = super::DecodedFrame {
                width: 2,
                height: 2,
                limited_range: true,
                format,
                pixels: vec![16, 235, 16, 235, 128, 128],
                ..Default::default()
            };
            assert_eq!(frame.rgb565(0), 0);
            assert_eq!(frame.rgb565(1), 0xffff);
        }
    }

    #[test]
    fn native_rgb565_is_loaded_without_yuv_conversion() {
        let frame = super::DecodedFrame {
            width: 2,
            height: 1,
            format: super::DecodedPixelFormat::Rgb565,
            pixels: vec![0x00, 0xf8, 0xe0, 0x07],
            ..Default::default()
        };
        assert_eq!(frame.rgb565(0), 0xf800);
        assert_eq!(frame.rgb565(1), 0x07e0);
    }

    #[test]
    fn mp4_keeps_composition_timestamps_for_reordered_pictures() {
        let video = demux_mp4(include_bytes!("../tests/fixtures/main-b-frames.mp4")).unwrap();
        assert!(video
            .samples
            .iter()
            .any(|s| s.presentation_ms != s.timestamp_ms));
        assert!(video
            .samples
            .windows(2)
            .all(|s| s[0].timestamp_ms <= s[1].timestamp_ms));
    }

    #[test]
    fn main_profile_mp4_keeps_decoding_b_frames() {
        let video = demux_mp4(include_bytes!("../tests/fixtures/main-b-frames.mp4")).unwrap();
        let mut decoder = SoftwareH264Backend::new();
        decoder.configure(&video.config).unwrap();
        let mut decoded = 0;
        let mut distinct = std::collections::HashSet::new();
        let mut storage = None;
        for sample in &video.samples {
            if decoder.decode_sample(sample).unwrap() {
                let frame = decoder.frame().unwrap();
                assert_eq!((frame.width, frame.height), (64, 48));
                decoded += 1;
                distinct.insert(frame.pixels.clone());
                if let Some(address) = storage {
                    assert_eq!(frame.pixels.as_ptr(), address);
                }
                storage = Some(frame.pixels.as_ptr());
            }
        }
        // A B frame can remain queued until end of stream; the sequence must
        // continue producing changing pictures without intermediate flushes.
        assert!(decoded >= video.samples.len() - 2);
        assert!(distinct.len() > 20);
    }

    #[test]
    fn converts_length_prefixed_nals() {
        let sample = [0, 0, 0, 2, 0x67, 0x64, 0, 0, 0, 1, 0x68];
        let annex_b = length_prefixed_to_annex_b(&sample).unwrap();
        assert_eq!(annex_b, [0, 0, 0, 1, 0x67, 0x64, 0, 0, 0, 1, 0x68]);
    }

    #[test]
    fn rejects_truncated_nal() {
        assert!(length_prefixed_to_annex_b(&[0, 0, 0]).is_err());
        assert!(length_prefixed_to_annex_b(&[0, 0, 0, 4, 1]).is_err());
    }

    #[test]
    fn direct_rgb565_matches_the_previous_colour_conversion() {
        let mut frame = super::DecodedFrame {
            width: 2,
            height: 2,
            pixels: vec![0; 6],
            ..Default::default()
        };
        for y in [0, 16, 63, 127, 192, 235, 255] {
            for u in [0, 16, 64, 127, 128, 129, 192, 240, 255] {
                for v in [0, 16, 64, 127, 128, 129, 192, 240, 255] {
                    frame.pixels[..4].fill(y);
                    frame.pixels[4] = u;
                    frame.pixels[5] = v;
                    let y = f32::from(y);
                    let u = f32::from(u) - 128.0;
                    let v = f32::from(v) - 128.0;
                    let expected = [
                        (y + 1.402 * v) as u8,
                        (y - 0.344 * u - 0.714 * v) as u8,
                        (y + 1.772 * u) as u8,
                    ];
                    let pixel = frame.rgb565(3);
                    let actual = [
                        ((pixel >> 11) << 3) as u8,
                        (((pixel >> 5) & 63) << 2) as u8,
                        ((pixel & 31) << 3) as u8,
                    ];
                    for (actual, expected) in actual.into_iter().zip(expected) {
                        assert!(
                            (i16::from(actual) - i16::from(expected)).abs() <= 8,
                            "RGB565 changed colour: {actual} vs {expected}"
                        );
                    }
                }
            }
        }
    }
}
