//! Session-authenticated H.264 screen stream, transported through Core's Unix route proxy.
//! Only connected viewers enable framebuffer capture; idle screens are never forced hot.
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use openh264::encoder::{Complexity, Encoder, EncoderConfig, FrameRate, IntraFramePeriod, Profile, QpRange, RateControlMode, UsageType};
use openh264::formats::{RgbSliceU8, YUVBuffer};
use crate::h264_codec::api as codec_api;

use crate::shared::Shared;

const SOCKET: &str = "/run/onekvm/extensions/screen-display/sockets/remote.sock";
const INTERVAL: Duration = Duration::from_micros(33_333);

pub fn spawn(shared: Arc<Shared>) {
    std::thread::spawn(move || {
        if let Err(err) = serve(shared) { log::error!("remote screen video: {err:#}"); }
    });
}

fn serve(shared: Arc<Shared>) -> Result<()> {
    let parent = std::path::Path::new(SOCKET).parent().unwrap();
    fs::create_dir_all(parent)?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    if let Ok(meta) = fs::symlink_metadata(SOCKET) {
        if !meta.file_type().is_socket() { bail!("remote screen path is not a socket"); }
        fs::remove_file(SOCKET)?;
    }
    let listener = UnixListener::bind(SOCKET)?;
    fs::set_permissions(SOCKET, fs::Permissions::from_mode(0o600))?;
    for stream in listener.incoming() {
        let stream = stream?;
        let shared = shared.clone();
        std::thread::spawn(move || {
            if let Err(err) = client(stream, shared) { log::debug!("remote screen viewer closed: {err:#}"); }
        });
    }
    Ok(())
}

fn encoder() -> Result<Encoder> {
    Encoder::with_api_config(codec_api()?, EncoderConfig::new()
        .usage_type(UsageType::CameraVideoRealTime).profile(Profile::Baseline)
        .complexity(Complexity::Low).num_threads(1).max_frame_rate(FrameRate::from_hz(30.0))
        .scene_change_detect(false).adaptive_quantization(false).background_detection(false).rate_control_mode(RateControlMode::Off)
        .skip_frames(false).qp(QpRange::new(18, 24)).intra_frame_period(IntraFramePeriod::from_num_frames(60)))
        .context("create screen H.264 encoder")
}

fn client(mut stream: UnixStream, shared: Arc<Shared>) -> Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut request = String::new();
    let mut reader = BufReader::new(stream.try_clone()?);
    reader.by_ref().take(8192).read_line(&mut request)?;
    let mut header_bytes = request.len();
    let mut content_length = None;
    let mut range = None;
    let mut line = String::new();
    loop {
        line.clear();
        if header_bytes >= 8192 || reader.by_ref().take((8192 - header_bytes) as u64).read_line(&mut line)? == 0 { bail!("incomplete screen stream request"); }
        header_bytes += line.len();
        if line == "\r\n" || line == "\n" { break; }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") { content_length = Some(value.trim().parse::<u64>()?); }
            if name.eq_ignore_ascii_case("range") { range = Some(value.trim().to_string()); }
            if name.eq_ignore_ascii_case("transfer-encoding") { bail!("screen media requires Content-Length"); }
        }
    }
    let parts: Vec<_> = request.split_whitespace().take(2).collect();
    if parts.len() == 2 && parts[1].split('?').next() == Some("/devtools") {
        return crate::devtools::serve(&shared, parts[0], parts[1], content_length, &mut reader, &mut stream);
    }
    if parts.len() == 2 && (parts[1] == "/media" || parts[1].starts_with("/media/")) {
        stream.set_read_timeout(Some(Duration::from_secs(30)))?;
        stream.set_write_timeout(Some(Duration::from_secs(30)))?;
        return crate::media_store::serve(&shared.media_directory(), parts[0], parts[1], content_length, range.as_deref(), &mut reader, &mut stream);
    }
    if parts != ["GET", "/h264"] {
        stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    }
    let Some(_viewer) = shared.remote.viewer() else {
        stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    };
    let mut encoder = encoder()?;
    let controls = shared.get_key("controls");
    let controls: Vec<String> = serde_json::from_str(&controls).unwrap_or_default();
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.onekvm.screen.h264\r\nCache-Control: private, no-store\r\nX-Accel-Buffering: no\r\nX-OneKVM-Screen-Controls: {}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n", controls.join(","))?;
    shared.wake.notify();
    let start = Instant::now();
    let mut next_encode = start;
    let mut sequence = 0;
    let mut dimensions = (0, 0);
    let mut rgb = Vec::new();
    loop {
        std::thread::sleep(next_encode.saturating_duration_since(Instant::now()));
        let Some(frame) = shared.remote.wait_frame(sequence, Duration::from_secs(1)) else {
            // A bounded heartbeat detects disconnected idle clients and releases their capture lease.
            packet(&mut stream, &[], 0, 0, 0, false, shared.is_blanked())?;
            continue;
        };
        sequence = frame.sequence;
        if dimensions != (frame.width, frame.height) {
            encoder = self::encoder()?;
            dimensions = (frame.width, frame.height);
        }
        let encoded_at = Instant::now();
        rgb565_to_rgb(&frame.pixels, &mut rgb);
        let yuv = YUVBuffer::from_rgb8_source(RgbSliceU8::new(&rgb, dimensions));
        let encoded = encoder.encode(&yuv)?.to_vec();
        if !encoded.is_empty() {
            let key = contains_idr(&encoded);
            packet(&mut stream, &encoded, start.elapsed().as_micros() as u64, frame.width as u16, frame.height as u16, key, shared.is_blanked())?;
        }
        next_encode = encoded_at + INTERVAL;
    }
}

fn rgb565_to_rgb(pixels: &[u16], rgb: &mut Vec<u8>) {
    rgb.clear();
    rgb.reserve(pixels.len() * 3);
    for &pixel in pixels {
        let (r, g, b) = ((pixel >> 11) as u8, ((pixel >> 5) & 63) as u8, (pixel & 31) as u8);
        rgb.extend_from_slice(&[(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]);
    }
}

fn contains_idr(bytes: &[u8]) -> bool {
    bytes.windows(4).any(|part| part[..3] == [0, 0, 1] && part[3] & 31 == 5)
}

// OKSF v1: magic, length u32, timestamp-us u64, width/height u16, key/blank flags, version, reserved.
fn packet(stream: &mut impl Write, payload: &[u8], timestamp: u64, width: u16, height: u16, key: bool, blanked: bool) -> Result<()> {
    let mut header = [0u8; 24];
    header[..4].copy_from_slice(b"OKSF");
    header[4..8].copy_from_slice(&(payload.len() as u32).to_be_bytes());
    header[8..16].copy_from_slice(&timestamp.to_be_bytes());
    header[16..18].copy_from_slice(&width.to_be_bytes());
    header[18..20].copy_from_slice(&height.to_be_bytes());
    header[20] = u8::from(key) | (u8::from(blanked) << 1);
    header[21] = 1;
    write!(stream, "{:x}\r\n", header.len() + payload.len())?;
    stream.write_all(&header)?;
    stream.write_all(payload)?;
    stream.write_all(b"\r\n")?;
    stream.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts_native_rgb565_and_detects_annex_b_idr() {
        let mut rgb = Vec::new();
        rgb565_to_rgb(&[0xf800, 0x07e0, 0x001f], &mut rgb);
        assert_eq!(rgb, [255, 0, 0, 0, 255, 0, 0, 0, 255]);
        assert!(contains_idr(&[0, 0, 0, 1, 0x65]));
        assert!(!contains_idr(&[0, 0, 1, 0x41]));
    }
    #[test]
    fn h264_screen_encoder_round_trips_pro_dimensions() {
        let rgb = vec![64; 320 * 172 * 3];
        let yuv = YUVBuffer::from_rgb8_source(RgbSliceU8::new(&rgb, (320, 172)));
        let mut enc = encoder().unwrap();
        let encoded = enc.encode(&yuv).unwrap().to_vec();
        assert!(contains_idr(&encoded));
        let mut decoder = openh264::decoder::Decoder::new().unwrap();
        let frame = decoder.decode(&encoded).unwrap().unwrap();
        assert_eq!(openh264::formats::YUVSource::dimensions(&frame), (320, 172));
    }
}
