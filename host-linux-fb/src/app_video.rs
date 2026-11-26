//! Live RGB565 plane for the CarPlay screen app.
//!
//! The plugin pushes tightly packed little-endian frames on a local socket.
//! The framebuffer loop blits them under the PocketJS guest while
//! `carplay/main` is in front.

use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const MAX_WIDTH: u32 = 1920;
const MAX_HEIGHT: u32 = 1080;

struct Frame {
    width: u32,
    height: u32,
    pixels: Vec<u16>,
}

pub struct Plane {
    wanted: AtomicBool,
    frame_seq: AtomicU32,
    frame: Mutex<Option<Frame>>,
}

impl Plane {
    pub fn new() -> Self {
        Self {
            wanted: AtomicBool::new(false),
            frame_seq: AtomicU32::new(0),
            frame: Mutex::new(None),
        }
    }

    pub fn set_wanted(&self, on: bool) {
        if self.wanted.swap(on, Ordering::AcqRel) == on {
            return;
        }
        if !on {
            self.frame.lock().expect("carplay frame").take();
            self.frame_seq.fetch_add(1, Ordering::Relaxed);
            clear_stamp();
        }
    }

    pub fn frame_seq(&self) -> u32 {
        self.frame_seq.load(Ordering::Relaxed)
    }

    pub fn push_rgb565(&self, width: u32, height: u32, bytes: &[u8]) -> Result<bool, &'static str> {
        let pixels = decode_rgb565(width, height, bytes)?;
        if !self.wanted.load(Ordering::Acquire) {
            return Ok(false);
        }
        *self.frame.lock().expect("carplay frame") = Some(Frame { width, height, pixels });
        self.frame_seq.fetch_add(1, Ordering::Relaxed);
        Ok(true)
    }

    pub fn blit(&self, dst: &mut [u16], dw: u32, dh: u32) {
        let guard = self.frame.lock().expect("carplay frame");
        let Some(frame) = guard.as_ref() else {
            dst.fill(0);
            return;
        };
        cover(dst, &frame.pixels, frame.width, frame.height, dw, dh);
    }
}

pub fn socket_path() -> PathBuf {
    std::env::var_os("ONEKVM_CARPLAY_VIDEO_SOCK")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/run/onekvm/carplay-video.sock"))
}

pub fn spawn(plane: Arc<Plane>) {
    thread::Builder::new()
        .name("onekvm-carplay-video".into())
        .spawn(move || {
            if let Err(err) = serve(plane) {
                log::warn!("carplay video: {err}");
            }
        })
        .expect("spawn carplay video");
}

fn serve(plane: Arc<Plane>) -> std::io::Result<()> {
    let path = socket_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o666))?;
    listener.set_nonblocking(false)?;
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
                if let Err(err) = read_frame(&plane, &mut stream) {
                    log::debug!("carplay video frame: {err}");
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(err) => {
                log::debug!("carplay video accept: {err}");
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
    Ok(())
}

fn read_frame(plane: &Plane, stream: &mut UnixStream) -> Result<(), String> {
    let mut header = [0u8; 12];
    stream.read_exact(&mut header).map_err(|err| err.to_string())?;
    let width = u32::from_le_bytes(header[0..4].try_into().unwrap());
    let height = u32::from_le_bytes(header[4..8].try_into().unwrap());
    let len = u32::from_le_bytes(header[8..12].try_into().unwrap()) as usize;
    if len > (MAX_WIDTH as usize) * (MAX_HEIGHT as usize) * 2 {
        return Err("frame is too large".into());
    }
    let mut bytes = vec![0u8; len];
    stream.read_exact(&mut bytes).map_err(|err| err.to_string())?;
    if plane.push_rgb565(width, height, &bytes).map_err(str::to_string)? {
        touch_stamp();
    }
    stream.write_all(b"ok\n").ok();
    Ok(())
}

fn stamp_path() -> PathBuf {
    socket_path().with_extension("stamp")
}

fn touch_stamp() {
    if cfg!(test) {
        return;
    }
    let path = stamp_path();
    if let Some(dir) = path.parent() {
        if !dir.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(dir);
        }
    }
    if std::fs::write(&path, b"1").is_ok() {
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644));
    }
}

fn clear_stamp() {
    if cfg!(test) {
        return;
    }
    let _ = std::fs::remove_file(stamp_path());
}

fn decode_rgb565(width: u32, height: u32, bytes: &[u8]) -> Result<Vec<u16>, &'static str> {
    if width == 0 || height == 0 || width > MAX_WIDTH || height > MAX_HEIGHT {
        return Err("frame size is out of range");
    }
    let count = (width as usize).saturating_mul(height as usize);
    if bytes.len() != count.saturating_mul(2) {
        return Err("frame length does not match its size");
    }
    let mut pixels = Vec::with_capacity(count);
    for pair in bytes.chunks_exact(2) {
        pixels.push(u16::from_le_bytes([pair[0], pair[1]]));
    }
    Ok(pixels)
}

fn cover(dst: &mut [u16], src: &[u16], sw: u32, sh: u32, dw: u32, dh: u32) {
    let dw = dw.max(1);
    let dh = dh.max(1);
    let dest_len = (dw as usize).saturating_mul(dh as usize);
    if sw == 0 || sh == 0 || dst.len() < dest_len || src.len() < (sw as usize) * (sh as usize) {
        let count = dest_len.min(dst.len());
        dst[..count].fill(0);
        return;
    }
    if sw == dw && sh == dh {
        dst[..dest_len].copy_from_slice(&src[..dest_len]);
        return;
    }
    let (vis_w, vis_h) = if (dw as u64) * (sh as u64) >= (dh as u64) * (sw as u64) {
        let vis_w = sw;
        let vis_h = (((dh as u64) * (vis_w as u64)) / (dw as u64)).max(1) as u32;
        (vis_w, vis_h.min(sh))
    } else {
        let vis_h = sh;
        let vis_w = (((dw as u64) * (vis_h as u64)) / (dh as u64)).max(1) as u32;
        (vis_w.min(sw), vis_h)
    };
    let ox = sw.saturating_sub(vis_w) / 2;
    let oy = sh.saturating_sub(vis_h) / 2;
    for y in 0..dh {
        let sy = oy + (((y as u64) * (vis_h as u64) + (dh as u64) / 2) / (dh as u64)) as u32;
        let sy = sy.min(sh - 1);
        let row = (sy * sw) as usize;
        let dst_row = (y * dw) as usize;
        for x in 0..dw {
            let sx = ox + (((x as u64) * (vis_w as u64) + (dw as u64) / 2) / (dw as u64)) as u32;
            dst[dst_row + x as usize] = src[row + sx.min(sw - 1) as usize];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_truncated_frame() {
        assert!(decode_rgb565(2, 1, &[0, 0xf8, 0]).is_err());
        assert!(decode_rgb565(0, 1, &[]).is_err());
    }

    #[test]
    fn stores_a_frame_only_while_the_app_is_open() {
        let plane = Plane::new();
        let bytes = [0x00, 0xf8, 0xe0, 0x07];
        plane.push_rgb565(2, 1, &bytes).unwrap();
        assert_eq!(plane.frame_seq(), 0);
        plane.set_wanted(true);
        plane.push_rgb565(2, 1, &bytes).unwrap();
        let mut dst = [0u16; 2];
        plane.blit(&mut dst, 2, 1);
        assert_eq!(dst, [0xf800, 0x07e0]);
        plane.set_wanted(false);
        plane.blit(&mut dst, 2, 1);
        assert_eq!(dst, [0, 0]);
    }

    #[test]
    fn cover_centers_a_wide_frame_on_a_short_panel() {
        let mut src = vec![0u16; 4 * 2];
        src[1 * 4 + 1] = 0xabcd;
        let mut dst = [0u16; 2 * 2];
        cover(&mut dst, &src, 4, 2, 2, 2);
        assert_eq!(dst[1 * 2 + 0], 0xabcd);
    }
}
