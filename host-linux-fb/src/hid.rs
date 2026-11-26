//! Relative mouse through onekvm-server, same Unix HTTP as the RustDesk plugin
//! (`/run/onekvm/extension-control.sock` + `/api/hid/mouse`).

use std::io::{self, Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, Ordering};
use std::thread;
use std::time::Duration;

const CONTROL_SOCK: &str = "/run/onekvm/extension-control.sock";
const TICK_MS: u64 = 16;
const DEAD: i32 = 80;
const MIN_SPEED: f32 = 1.2;
const MAX_SPEED: f32 = 20.0;
const SPEED_MIN: i32 = 10;
const SPEED_MAX: i32 = 100;
const SPEED_DEFAULT: i32 = 40;

pub struct Hub {
    wanted: AtomicBool,
    wake: crate::wake::Wake,
    status: AtomicU8,
    x: AtomicI32,
    y: AtomicI32,
    buttons: AtomicU8,
    click: AtomicU8,
    speed: AtomicI32,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            wanted: AtomicBool::new(false),
            wake: crate::wake::Wake::default(),
            status: AtomicU8::new(0),
            x: AtomicI32::new(0),
            y: AtomicI32::new(0),
            buttons: AtomicU8::new(0),
            click: AtomicU8::new(0),
            speed: AtomicI32::new(SPEED_DEFAULT),
        }
    }

    pub fn set_wanted(&self, on: bool) {
        let changed = self.wanted.swap(on, Ordering::AcqRel) != on;
        if !on {
            self.x.store(0, Ordering::Relaxed);
            self.y.store(0, Ordering::Relaxed);
            self.buttons.store(0, Ordering::Relaxed);
            self.click.store(0, Ordering::Relaxed);
        }
        if changed {
            self.wake.notify();
        }
    }

    pub fn wanted(&self) -> bool {
        self.wanted.load(Ordering::Acquire)
    }

    pub fn ready(&self) -> bool {
        self.status.load(Ordering::Relaxed) == 1
    }

    pub fn failed(&self) -> bool {
        self.status.load(Ordering::Relaxed) == 2
    }

    pub fn set_axis(&self, x: i32, y: i32) {
        self.x.store(x.clamp(-1000, 1000), Ordering::Relaxed);
        self.y.store(y.clamp(-1000, 1000), Ordering::Relaxed);
    }

    pub fn set_buttons(&self, n: u8) {
        self.buttons.store(n & 3, Ordering::Relaxed);
    }

    pub fn pulse_click(&self, n: u8) {
        if n == 1 || n == 2 {
            self.click.store(n, Ordering::Relaxed);
        }
    }

    pub fn axis_x(&self) -> i32 {
        self.x.load(Ordering::Relaxed).clamp(-1000, 1000)
    }

    pub fn axis_y(&self) -> i32 {
        self.y.load(Ordering::Relaxed).clamp(-1000, 1000)
    }

    pub fn speed(&self) -> i32 {
        self.speed
            .load(Ordering::Relaxed)
            .clamp(SPEED_MIN, SPEED_MAX)
    }

    pub fn set_speed(&self, n: i32) {
        self.speed
            .store(n.clamp(SPEED_MIN, SPEED_MAX), Ordering::Relaxed);
    }

    fn axis(&self) -> (i32, i32) {
        (self.axis_x(), self.axis_y())
    }

    fn take_click(&self) -> u8 {
        self.click.swap(0, Ordering::Relaxed)
    }
}

pub fn spawn(hub: std::sync::Arc<Hub>, data_dir: std::path::PathBuf) {
    thread::Builder::new()
        .name("onekvm-stick".into())
        .spawn(move || pump(hub, data_dir))
        .expect("spawn stick hid");
}

fn pump(hub: std::sync::Arc<Hub>, data_dir: std::path::PathBuf) {
    let (id, token) = match crate::auth::ensure(&data_dir) {
        Ok(pair) => pair,
        Err(err) => {
            log::warn!("stick hid auth: {err}");
            return;
        }
    };
    let mut mouse = MouseState::default();
    loop {
        let generation = hub.wake.generation();
        let wanted = hub.wanted();
        let (ax, ay) = hub.axis();
        let (dx, dy) = velocity(ax, ay, hub.speed());
        let held = hub.buttons.load(Ordering::Relaxed);
        let click = hub.take_click();
        let result = mouse.update(wanted, held, click, dx, dy, |buttons, x, y| {
            send_mouse(&id, &token, buttons, x, y, 0)
        });
        match result {
            Ok(()) => {
                if wanted {
                    hub.status.store(1, Ordering::Relaxed);
                }
            }
            Err(err) => {
                hub.status.store(2, Ordering::Relaxed);
                log::debug!("stick hid: {err}");
                thread::sleep(Duration::from_millis(400));
                continue;
            }
        }
        if !wanted {
            // update() must release our buttons before the worker goes idle.
            // Failed releases keep retrying, even after leaving the App.
            hub.wake.wait(generation, None);
            continue;
        }
        thread::sleep(Duration::from_millis(TICK_MS));
    }
}

#[derive(Default)]
struct MouseState {
    active: bool,
    buttons: u8,
    uncertain: bool,
}

impl MouseState {
    fn update(
        &mut self,
        wanted: bool,
        held: u8,
        click: u8,
        dx: i8,
        dy: i8,
        mut send: impl FnMut(u8, i8, i8) -> io::Result<()>,
    ) -> io::Result<()> {
        if !wanted {
            self.active = false;
            if self.buttons != 0 || self.uncertain {
                self.report(0, 0, 0, &mut send)?;
            }
            return Ok(());
        }
        if !self.active || self.uncertain {
            self.report(0, 0, 0, &mut send)?;
            self.active = true;
        }
        if click != 0 {
            self.report(held | click, 0, 0, &mut send)?;
            self.report(held, dx, dy, &mut send)?;
        } else if dx != 0 || dy != 0 || held != self.buttons {
            // Zero is a release report when our last report held a button.
            self.report(held, dx, dy, &mut send)?;
        }
        Ok(())
    }

    fn report(
        &mut self,
        buttons: u8,
        x: i8,
        y: i8,
        send: &mut impl FnMut(u8, i8, i8) -> io::Result<()>,
    ) -> io::Result<()> {
        // A timed-out HTTP response does not prove the USB report was lost.
        // Recover with a release before sending more input or going idle.
        self.uncertain = true;
        send(buttons, x, y)?;
        self.buttons = buttons;
        self.uncertain = false;
        Ok(())
    }
}

fn velocity(x: i32, y: i32, scale: i32) -> (i8, i8) {
    let mag = ((x * x + y * y) as f32).sqrt();
    if mag < DEAD as f32 {
        return (0, 0);
    }
    let t = ((mag - DEAD as f32) / (1000.0 - DEAD as f32)).clamp(0.0, 1.0);
    let scale = scale.clamp(SPEED_MIN, SPEED_MAX) as f32 / 100.0;
    let speed = ((MIN_SPEED + t * t * (MAX_SPEED - MIN_SPEED)) * scale).max(1.0);
    let nx = (speed * x as f32 / mag).round() as i32;
    let ny = (speed * y as f32 / mag).round() as i32;
    (nx.clamp(-127, 127) as i8, ny.clamp(-127, 127) as i8)
}

fn send_mouse(id: &str, token: &str, buttons: u8, x: i8, y: i8, wheel: i8) -> io::Result<()> {
    let mut stream = UnixStream::connect(CONTROL_SOCK)?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    let body = format!(r#"{{"buttons":{buttons},"x":{x},"y":{y},"wheel":{wheel}}}"#);
    let req = format!(
        "POST /api/hid/mouse HTTP/1.1\r\nHost: unix\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAuthorization: Bearer {token}\r\nX-OneKVM-Extension: {id}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(req.as_bytes())?;
    let mut resp = Vec::new();
    stream.read_to_end(&mut resp)?;
    let ok = resp.starts_with(b"HTTP/1.1 2") || resp.starts_with(b"HTTP/1.0 2");
    if ok {
        return Ok(());
    }
    Err(io::Error::other(format!(
        "hid mouse {}",
        String::from_utf8_lossy(&resp)
            .lines()
            .next()
            .unwrap_or("empty")
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reports(state: &mut MouseState, wanted: bool, held: u8, click: u8) -> Vec<(u8, i8, i8)> {
        let mut reports = Vec::new();
        state
            .update(wanted, held, click, 0, 0, |buttons, x, y| {
                reports.push((buttons, x, y));
                Ok(())
            })
            .unwrap();
        reports
    }

    #[test]
    fn stationary_button_release_is_sent_and_repeated_clicks_still_work() {
        let mut mouse = MouseState::default();
        assert_eq!(
            reports(&mut mouse, true, 0, 1),
            [(0, 0, 0), (1, 0, 0), (0, 0, 0)]
        );
        for button in [1, 1, 2] {
            assert_eq!(reports(&mut mouse, true, button, 0), [(button, 0, 0)]);
            assert!(reports(&mut mouse, true, button, 0).is_empty());
            assert_eq!(reports(&mut mouse, true, 0, 0), [(0, 0, 0)]);
        }
        // Idle touchpad frames must not overwrite input from another channel.
        assert!(reports(&mut mouse, true, 0, 0).is_empty());
    }

    #[test]
    fn leaving_the_app_releases_only_our_pending_buttons() {
        let mut mouse = MouseState::default();
        assert!(reports(&mut mouse, false, 0, 0).is_empty());
        reports(&mut mouse, true, 1, 0);
        assert_eq!(reports(&mut mouse, false, 0, 0), [(0, 0, 0)]);
        assert!(reports(&mut mouse, false, 0, 0).is_empty());
        assert_eq!(
            reports(&mut mouse, true, 0, 1),
            [(0, 0, 0), (1, 0, 0), (0, 0, 0)]
        );
    }

    #[test]
    fn failed_press_is_released_even_after_leaving_the_app() {
        let mut mouse = MouseState::default();
        reports(&mut mouse, true, 0, 0);
        assert!(mouse
            .update(true, 1, 0, 0, 0, |_, _, _| Err(
                io::ErrorKind::TimedOut.into()
            ))
            .is_err());
        assert_eq!(reports(&mut mouse, false, 0, 0), [(0, 0, 0)]);
        assert!(reports(&mut mouse, false, 0, 0).is_empty());
    }

    #[test]
    fn failed_click_release_is_retried_before_next_input() {
        let mut mouse = MouseState::default();
        reports(&mut mouse, true, 0, 0);
        let mut calls = 0;
        assert!(mouse
            .update(true, 0, 1, 0, 0, |_, _, _| {
                calls += 1;
                if calls == 2 {
                    Err(io::ErrorKind::TimedOut.into())
                } else {
                    Ok(())
                }
            })
            .is_err());
        assert_eq!(
            reports(&mut mouse, true, 0, 1),
            [(0, 0, 0), (1, 0, 0), (0, 0, 0)]
        );
    }

    #[test]
    fn failed_exit_release_remains_pending_until_acknowledged() {
        let mut mouse = MouseState::default();
        reports(&mut mouse, true, 2, 0);
        assert!(mouse
            .update(false, 0, 0, 0, 0, |_, _, _| Err(
                io::ErrorKind::BrokenPipe.into()
            ))
            .is_err());
        assert_eq!(reports(&mut mouse, false, 0, 0), [(0, 0, 0)]);
        assert!(reports(&mut mouse, false, 0, 0).is_empty());
    }
}
