//! Live frames from onekvm-server, same Unix media socket as RustDesk.
//!
//! `video=display` delivers RGB565 over a shared-memory ring. The presenter
//! blits that layer and paints OneKVM overlays on top. Reconnect this path
//! after a server restart; local display never depends on an encoded stream.

use std::io::{self, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::net::UnixStream;
use std::ptr::NonNull;
use std::slice;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const MEDIA_SOCK: &str = "/run/onekvm/extension-media.sock";
const SNAP_W: i32 = 640;
const SNAP_H: i32 = 360;
const CODEC_RGB565: u8 = 4;
const RING_MAGIC: &[u8; 4] = b"OKVR";
const RING_HANDSHAKE: u8 = b'R';
const RING_VERSION: u32 = 1;
const RING_HEADER_SIZE: usize = 64;
const RING_SLOT_HEADER_SIZE: usize = 64;
const RING_STATE_READY: u32 = 2;
const RING_STATE_READING: u32 = 3;
const RING_STATE_FREE: u32 = 0;

pub struct RgbFrame {
    pub width: u32,
    pub height: u32,
    pub rgb565: Vec<u16>,
}

pub struct Hub {
    wanted: AtomicBool,
    wake: crate::wake::Wake,
    ready: AtomicBool,
    zoom: AtomicU8,
    pan_x: AtomicI32,
    pan_y: AtomicI32,
    frame_seq: AtomicU32,
    frame: Mutex<Option<RgbFrame>>,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            wanted: AtomicBool::new(false),
            wake: crate::wake::Wake::default(),
            ready: AtomicBool::new(false),
            zoom: AtomicU8::new(1),
            pan_x: AtomicI32::new(500),
            pan_y: AtomicI32::new(500),
            frame_seq: AtomicU32::new(0),
            frame: Mutex::new(None),
        }
    }

    pub fn set_wanted(&self, on: bool) {
        let changed = self.wanted.swap(on, Ordering::AcqRel) != on;
        if !on {
            self.ready.store(false, Ordering::Relaxed);
        }
        if changed {
            self.wake.notify();
        }
    }

    pub fn wanted(&self) -> bool {
        self.wanted.load(Ordering::Acquire)
    }

    pub fn ready(&self) -> bool {
        self.ready.load(Ordering::Relaxed)
    }

    pub fn zoom(&self) -> u8 {
        match self.zoom.load(Ordering::Relaxed) {
            2 => 2,
            4 => 4,
            _ => 1,
        }
    }

    pub fn set_zoom(&self, n: u8) {
        let n = if n >= 4 {
            4
        } else if n >= 2 {
            2
        } else {
            1
        };
        self.zoom.store(n, Ordering::Relaxed);
    }

    pub fn pan_x(&self) -> i32 {
        self.pan_x.load(Ordering::Relaxed).clamp(0, 1000)
    }

    pub fn pan_y(&self) -> i32 {
        self.pan_y.load(Ordering::Relaxed).clamp(0, 1000)
    }

    pub fn set_pan(&self, x: i32, y: i32) {
        self.pan_x.store(x.clamp(0, 1000), Ordering::Relaxed);
        self.pan_y.store(y.clamp(0, 1000), Ordering::Relaxed);
    }

    pub fn frame_seq(&self) -> u32 {
        self.frame_seq.load(Ordering::Relaxed)
    }

    pub fn blit(&self, dst: &mut [u16], dw: u32, dh: u32) {
        let guard = self.frame.lock().unwrap();
        let Some(frame) = guard.as_ref() else {
            dst.fill(0);
            return;
        };
        if frame.width == 0 || frame.height == 0 {
            dst.fill(0);
            return;
        }
        blit_view(
            dst,
            &frame.rgb565,
            frame.width,
            frame.height,
            dw,
            dh,
            self.zoom(),
            self.pan_x(),
            self.pan_y(),
        );
    }
}

pub fn spawn(hub: std::sync::Arc<Hub>, data_dir: std::path::PathBuf) {
    thread::Builder::new()
        .name("onekvm-stream".into())
        .spawn(move || pump(hub, data_dir))
        .expect("spawn stream pump");
}

fn pump(hub: std::sync::Arc<Hub>, data_dir: std::path::PathBuf) {
    let (id, token) = match crate::auth::ensure(&data_dir) {
        Ok(pair) => pair,
        Err(err) => {
            log::warn!("stream media auth: {err}");
            return;
        }
    };
    let mut live: Option<DisplaySession> = None;
    let mut last_frame = Instant::now();
    loop {
        let generation = hub.wake.generation();
        if !hub.wanted() {
            live = None;
            last_frame = Instant::now();
            hub.wake.wait(generation, None);
            continue;
        }
        if live.is_none() {
            // Start the grace period when opening the stream, including after
            // a long idle. VIN can take longer than one ring poll to wake.
            last_frame = Instant::now();
        }
        match pull_frame(&mut live, &id, &token, hub.wanted()) {
            Ok(frame) => {
                last_frame = Instant::now();
                *hub.frame.lock().unwrap() = Some(frame);
                hub.frame_seq.fetch_add(1, Ordering::Relaxed);
                hub.ready.store(true, Ordering::Relaxed);
            }
            Err(err)
                if err.kind() == io::ErrorKind::TimedOut
                    && hub.wanted()
                    && last_frame.elapsed() < Duration::from_secs(10) => {}
            Err(err) => {
                live = None;
                hub.ready.store(false, Ordering::Relaxed);
                log::debug!("stream media: {err}");
                thread::sleep(Duration::from_millis(800));
            }
        }
    }
}

struct DisplaySession {
    stream: UnixStream,
    ring: SharedRing,
}

fn pull_frame(
    live: &mut Option<DisplaySession>,
    id: &str,
    token: &str,
    wanted: bool,
) -> io::Result<RgbFrame> {
    if live.is_none() {
        *live = Some(connect_display(id, token)?);
        log::info!("stream using video=display shm-ring-v1 RGB565");
    }
    pull_display(live.as_mut().expect("display session"), wanted)
}

fn connect_display(id: &str, token: &str) -> io::Result<DisplaySession> {
    let mut stream = UnixStream::connect(MEDIA_SOCK)?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(5000)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
    let req = format!(
        "{{\"version\":1,\"extension_id\":\"{id}\",\"token\":\"{token}\",\"video\":\"display\",\"width\":{SNAP_W},\"height\":{SNAP_H},\"timeout_ms\":1000,\"transport\":\"shm-ring-v1\"}}\n"
    );
    stream.write_all(req.as_bytes())?;
    let ring = receive_shared_ring(&stream)?;
    Ok(DisplaySession { stream, ring })
}

fn pull_display(session: &mut DisplaySession, wanted: bool) -> io::Result<RgbFrame> {
    if !wanted {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "display not wanted",
        ));
    }
    loop {
        if let Some(frame) = take_ring_frame(&session.ring)? {
            if frame.codec != CODEC_RGB565 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "display is not rgb565",
                ));
            }
            return rgb565_frame(frame.width, frame.height, &frame.payload);
        }
        match wait_ring(&session.stream, session.ring.event_fd.as_raw_fd(), 200)? {
            RingWait::Closed => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "display ring closed",
                ));
            }
            RingWait::Ready => continue,
            RingWait::Timeout => {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "display ring wait"));
            }
        }
    }
}

struct SharedRing {
    _memory_fd: OwnedFd,
    event_fd: OwnedFd,
    memory: NonNull<u8>,
    size: usize,
    slot_count: usize,
    slot_capacity: usize,
    stride: usize,
}

unsafe impl Send for SharedRing {}

impl Drop for SharedRing {
    fn drop(&mut self) {
        unsafe {
            libc::munmap(self.memory.as_ptr().cast(), self.size);
        }
    }
}

struct RingFrame {
    codec: u8,
    width: u16,
    height: u16,
    payload: Vec<u8>,
}

enum RingWait {
    Ready,
    Timeout,
    Closed,
}

fn receive_shared_ring(stream: &UnixStream) -> io::Result<SharedRing> {
    let mut marker = 0_u8;
    let mut vector = libc::iovec {
        iov_base: (&mut marker as *mut u8).cast(),
        iov_len: 1,
    };
    let control_size = unsafe { libc::CMSG_SPACE((2 * std::mem::size_of::<libc::c_int>()) as _) };
    let mut control = vec![0_u8; control_size as usize];
    let mut message = unsafe { std::mem::zeroed::<libc::msghdr>() };
    message.msg_iov = &mut vector;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = control.len() as _;
    let received =
        unsafe { libc::recvmsg(stream.as_raw_fd(), &mut message, libc::MSG_CMSG_CLOEXEC) };
    if received < 0 {
        return Err(io::Error::last_os_error());
    }
    if received != 1 || marker != RING_HANDSHAKE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "display did not offer shm-ring-v1",
        ));
    }
    let header = unsafe { libc::CMSG_FIRSTHDR(&message) };
    if header.is_null()
        || unsafe { (*header).cmsg_level } != libc::SOL_SOCKET
        || unsafe { (*header).cmsg_type } != libc::SCM_RIGHTS
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "shared media ring descriptors are missing",
        ));
    }
    let mut descriptors = [-1; 2];
    unsafe {
        std::ptr::copy_nonoverlapping(
            libc::CMSG_DATA(header).cast::<libc::c_int>(),
            descriptors.as_mut_ptr(),
            descriptors.len(),
        );
    }
    let memory_fd = unsafe { OwnedFd::from_raw_fd(descriptors[0]) };
    let event_fd = unsafe { OwnedFd::from_raw_fd(descriptors[1]) };
    let mut status = unsafe { std::mem::zeroed::<libc::stat>() };
    if unsafe { libc::fstat(memory_fd.as_raw_fd(), &mut status) } != 0
        || status.st_size < RING_HEADER_SIZE as libc::off_t
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid shared media ring size",
        ));
    }
    let size = status.st_size as usize;
    let mapped = unsafe {
        libc::mmap(
            std::ptr::null_mut(),
            size,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_SHARED,
            memory_fd.as_raw_fd(),
            0,
        )
    };
    if mapped == libc::MAP_FAILED {
        return Err(io::Error::last_os_error());
    }
    let memory = NonNull::new(mapped.cast::<u8>()).expect("mmap returned a non-null mapping");
    let bytes = unsafe { slice::from_raw_parts(memory.as_ptr(), size) };
    let slot_count = read_le_u32(bytes, 8)? as usize;
    let slot_capacity = read_le_u32(bytes, 12)? as usize;
    let stride = read_le_u32(bytes, 16)? as usize;
    let header_length = read_le_u32(bytes, 20)? as usize;
    let valid = &bytes[..4] == RING_MAGIC
        && read_le_u32(bytes, 4)? == RING_VERSION
        && header_length == RING_HEADER_SIZE
        && (2..=16).contains(&slot_count)
        && slot_capacity > 0
        && stride >= RING_SLOT_HEADER_SIZE + slot_capacity
        && slot_count <= (size - header_length) / stride;
    if !valid {
        unsafe {
            libc::munmap(memory.as_ptr().cast(), size);
        }
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid shared media ring layout",
        ));
    }
    Ok(SharedRing {
        _memory_fd: memory_fd,
        event_fd,
        memory,
        size,
        slot_count,
        slot_capacity,
        stride,
    })
}

fn wait_ring(stream: &UnixStream, event_fd: i32, timeout_ms: i32) -> io::Result<RingWait> {
    let mut fds = [
        libc::pollfd {
            fd: event_fd,
            events: libc::POLLIN,
            revents: 0,
        },
        libc::pollfd {
            fd: stream.as_raw_fd(),
            events: libc::POLLIN | libc::POLLHUP,
            revents: 0,
        },
    ];
    let ready = unsafe { libc::poll(fds.as_mut_ptr(), 2, timeout_ms) };
    if ready < 0 {
        return Err(io::Error::last_os_error());
    }
    if ready == 0 {
        return Ok(RingWait::Timeout);
    }
    if fds[1].revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
        return Ok(RingWait::Closed);
    }
    if fds[1].revents & libc::POLLIN != 0 {
        let mut byte = 0_u8;
        let read = unsafe {
            libc::recv(
                stream.as_raw_fd(),
                (&mut byte as *mut u8).cast(),
                1,
                libc::MSG_DONTWAIT | libc::MSG_PEEK,
            )
        };
        if read == 0 {
            return Ok(RingWait::Closed);
        }
        if read > 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unexpected shared media control data",
            ));
        }
    }
    if fds[0].revents & libc::POLLIN != 0 {
        let mut notifications = 0_u64;
        let read = unsafe {
            libc::read(
                event_fd,
                (&mut notifications as *mut u64).cast(),
                std::mem::size_of::<u64>(),
            )
        };
        if read < 0 {
            let err = io::Error::last_os_error();
            if err.kind() == io::ErrorKind::WouldBlock {
                return Ok(RingWait::Ready);
            }
            return Err(err);
        }
        return Ok(RingWait::Ready);
    }
    Ok(RingWait::Timeout)
}

fn take_ring_frame(ring: &SharedRing) -> io::Result<Option<RingFrame>> {
    for attempt in 0..2 {
        let mut selected = None;
        let mut oldest_sequence = u64::MAX;
        for index in 0..ring.slot_count {
            let offset = RING_HEADER_SIZE + index * ring.stride;
            if ring_atomic(ring, offset).load(Ordering::Acquire) != RING_STATE_READY {
                continue;
            }
            let sequence = read_le_u64(ring_bytes(ring), offset + 8)?;
            if selected.is_none() || sequence < oldest_sequence {
                selected = Some(index);
                oldest_sequence = sequence;
            }
        }
        let Some(selected) = selected else {
            if attempt == 0 {
                ring_atomic(ring, 24).store(0, Ordering::Release);
                continue;
            }
            return Ok(None);
        };
        let offset = RING_HEADER_SIZE + selected * ring.stride;
        let state = ring_atomic(ring, offset);
        if state
            .compare_exchange(
                RING_STATE_READY,
                RING_STATE_READING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err()
        {
            continue;
        }
        let bytes = ring_bytes(ring);
        let payload_size = read_le_u32(bytes, offset + 4)? as usize;
        let width = read_le_u16(bytes, offset + 28)?;
        let height = read_le_u16(bytes, offset + 30)?;
        let codec = bytes[offset + 32];
        if payload_size == 0 || payload_size > ring.slot_capacity || width == 0 || height == 0 {
            state.store(RING_STATE_FREE, Ordering::Release);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid shared media ring frame",
            ));
        }
        let payload = bytes
            [offset + RING_SLOT_HEADER_SIZE..offset + RING_SLOT_HEADER_SIZE + payload_size]
            .to_vec();
        state.store(RING_STATE_FREE, Ordering::Release);
        return Ok(Some(RingFrame {
            codec,
            width,
            height,
            payload,
        }));
    }
    Ok(None)
}

fn ring_bytes(ring: &SharedRing) -> &[u8] {
    unsafe { slice::from_raw_parts(ring.memory.as_ptr(), ring.size) }
}

fn ring_atomic(ring: &SharedRing, offset: usize) -> &AtomicU32 {
    unsafe { &*ring.memory.as_ptr().add(offset).cast::<AtomicU32>() }
}

fn read_le_u16(bytes: &[u8], offset: usize) -> io::Result<u16> {
    bytes
        .get(offset..offset + 2)
        .and_then(|value| value.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "truncated media ring"))
}

fn read_le_u32(bytes: &[u8], offset: usize) -> io::Result<u32> {
    bytes
        .get(offset..offset + 4)
        .and_then(|value| value.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "truncated media ring"))
}

fn read_le_u64(bytes: &[u8], offset: usize) -> io::Result<u64> {
    bytes
        .get(offset..offset + 8)
        .and_then(|value| value.try_into().ok())
        .map(u64::from_le_bytes)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "truncated media ring"))
}

fn rgb565_frame(width: u16, height: u16, payload: &[u8]) -> io::Result<RgbFrame> {
    let w = u32::from(width);
    let h = u32::from(height);
    let need = (w as usize).saturating_mul(h as usize).saturating_mul(2);
    if w == 0 || h == 0 || payload.len() != need {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "bad rgb565 display",
        ));
    }
    let mut rgb565 = vec![0u16; (w * h) as usize];
    for (i, chunk) in payload.chunks_exact(2).enumerate() {
        rgb565[i] = u16::from_le_bytes([chunk[0], chunk[1]]);
    }
    Ok(RgbFrame {
        width: w,
        height: h,
        rgb565,
    })
}

fn blit_view(
    dst: &mut [u16],
    src: &[u16],
    sw: u32,
    sh: u32,
    dw: u32,
    dh: u32,
    zoom: u8,
    pan_x: i32,
    pan_y: i32,
) {
    let dw = dw.max(1);
    let dh = dh.max(1);
    if sw == 0 || sh == 0 || dst.len() < (dw * dh) as usize || src.len() < (sw * sh) as usize {
        let n = ((dw * dh) as usize).min(dst.len());
        dst[..n].fill(0);
        return;
    }
    let zoom = u32::from(zoom.max(1));
    if zoom == 1 && sw == dw && sh == dh {
        dst[..(dw * dh) as usize].copy_from_slice(&src[..(dw * dh) as usize]);
        return;
    }
    // Cover crop: vis is the source window that fills dest after zoom.
    let (vis_w, vis_h) = if (dw as u64) * (sh as u64) >= (dh as u64) * (sw as u64) {
        let vis_w = (sw / zoom).max(1).min(sw);
        let vis_h = (((dh as u64) * (vis_w as u64)) / (dw as u64)).max(1) as u32;
        (vis_w, vis_h.min(sh))
    } else {
        let vis_h = (sh / zoom).max(1).min(sh);
        let vis_w = (((dw as u64) * (vis_h as u64)) / (dh as u64)).max(1) as u32;
        (vis_w.min(sw), vis_h)
    };
    let ox = ((pan_x.clamp(0, 1000) as u64) * (sw.saturating_sub(vis_w) as u64) / 1000) as u32;
    let oy = ((pan_y.clamp(0, 1000) as u64) * (sh.saturating_sub(vis_h) as u64) / 1000) as u32;
    let mut sx = vec![0u32; dw as usize];
    for x in 0..dw {
        let sample = ox + (((x as u64) * (vis_w as u64) + (dw as u64) / 2) / (dw as u64)) as u32;
        sx[x as usize] = sample.min(sw - 1);
    }
    for y in 0..dh {
        let sy = oy + (((y as u64) * (vis_h as u64) + (dh as u64) / 2) / (dh as u64)) as u32;
        let sy = sy.min(sh - 1);
        let row = (sy * sw) as usize;
        let dst_row = (y * dw) as usize;
        for x in 0..dw {
            dst[dst_row + x as usize] = src[row + sx[x as usize] as usize];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_pixels_use_little_endian_and_reject_truncated_frames() {
        let frame = rgb565_frame(2, 1, &[0x00, 0xf8, 0xe0, 0x07]).unwrap();
        assert_eq!(frame.rgb565, [0xf800, 0x07e0]);
        assert!(rgb565_frame(2, 1, &[0, 0, 0]).is_err());
        assert!(rgb565_frame(0, 1, &[]).is_err());
    }

    #[test]
    fn display_wait_distinguishes_short_stall_from_disconnect() {
        let (client, server) = UnixStream::pair().unwrap();
        let event = unsafe {
            OwnedFd::from_raw_fd(libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC))
        };
        assert!(matches!(
            wait_ring(&client, event.as_raw_fd(), 5).unwrap(),
            RingWait::Timeout
        ));
        let notification = 1_u64;
        assert_eq!(
            unsafe { libc::write(event.as_raw_fd(), (&notification as *const u64).cast(), 8) },
            8
        );
        assert!(matches!(
            wait_ring(&client, event.as_raw_fd(), 5).unwrap(),
            RingWait::Ready
        ));
        drop(server);
        assert!(matches!(
            wait_ring(&client, event.as_raw_fd(), 5).unwrap(),
            RingWait::Closed
        ));
    }

    #[test]
    fn blit_cover_640x360_fills_240() {
        let mut src = vec![0u16; 640 * 360];
        src[180 * 640 + 320] = 0xabcd;
        let mut dst = vec![0u16; 240 * 240];
        blit_view(&mut dst, &src, 640, 360, 240, 240, 1, 500, 500);
        assert!(dst.iter().any(|p| *p == 0xabcd));
        assert_eq!(dst[120 * 240 + 120], 0xabcd);
    }

    #[test]
    fn blit_identity_copies() {
        let src: Vec<u16> = (0..(240 * 240)).map(|i| i as u16).collect();
        let mut dst = vec![0u16; 240 * 240];
        blit_view(&mut dst, &src, 240, 240, 240, 240, 1, 0, 0);
        assert_eq!(dst, src);
    }
}
