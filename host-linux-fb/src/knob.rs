//! Desk rotary knob. Missing /dev/input keeps the host up and retries.

use std::io::ErrorKind;
use std::os::fd::AsRawFd;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

use evdev::{Device, EventSummary, KeyCode, RelativeAxisCode};

use crate::shared::Shared;

const HINT_AFTER: Duration = Duration::from_secs(2);
const HOME_AFTER: Duration = Duration::from_secs(5);

pub(crate) fn init_hold_due_ms(fires: u32) -> u64 {
    450 + u64::from(fires) * 130
}

pub(crate) fn release_is_click(hinted: bool, returned: bool, hold_fires: u32) -> bool {
    !(hinted || returned || hold_fires > 0)
}

pub(crate) fn should_return_home(init_mode: bool, elapsed: Duration) -> bool {
    !init_mode && elapsed >= HOME_AFTER
}

struct Pad {
    device: Device,
    path: PathBuf,
    down_at: Option<Instant>,
    hinted: bool,
    returned: bool,
    /// Backspaces already sent for this press. Init uses a short hold;
    /// the shell still treats a quick release as a click.
    hold_fires: u32,
    confirmation: bool,
}

pub fn spawn(shared: std::sync::Arc<Shared>) {
    // Detect controls before the Shell reads its first app catalog.
    let mut pads = open_pads(&shared);
    thread::spawn(move || loop {
        if pads.is_empty() {
            thread::sleep(Duration::from_secs(1));
            pads = open_pads(&shared);
            continue;
        }
        if !poll_pads(pads, &shared) {
            // Lost hardware must not leave a confirmation held down.
            shared.system_actions.set_pressed(false);
            shared.system_actions.hold(false);
            thread::sleep(Duration::from_millis(200));
        }
        pads = open_pads(&shared);
    });
}

fn open_pads(shared: &Shared) -> Vec<Pad> {
    let Ok(dir) = std::fs::read_dir("/dev/input") else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = dir.flatten().map(|ent| ent.path()).collect();
    paths.sort();
    let mut pads = Vec::new();
    for path in paths {
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !name.starts_with("event") {
            continue;
        }
        let Ok(device) = Device::open(&path) else {
            continue;
        };
        let rel = device
            .supported_relative_axes()
            .map(|axes| axes.contains(RelativeAxisCode::REL_X))
            .unwrap_or(false);
        let key = device
            .supported_keys()
            .map(|keys| keys.contains(KeyCode::KEY_ENTER))
            .unwrap_or(false);
        if !rel && !key {
            continue;
        }
        if device.set_nonblocking(true).is_err() {
            continue;
        }
        log::info!(
            "knob {} {}",
            path.display(),
            device.name().unwrap_or("input")
        );
        pads.push(Pad {
            device,
            path,
            down_at: None,
            hinted: false,
            returned: false,
            hold_fires: 0,
            confirmation: false,
        });
    }
    if !pads.is_empty() {
        shared.mark_knob_present();
    }
    pads
}

fn poll_pads(mut pads: Vec<Pad>, shared: &Shared) -> bool {
    loop {
        let mut dead = false;
        for pad in &mut pads {
            if !poll_one(pad, shared) {
                log::info!("knob dropped {}", pad.path.display());
                dead = true;
            }
        }
        if dead {
            return false;
        }
        // Only a held key needs a timeout. Idle encoders block in poll.
        let timeout = pads
            .iter()
            .filter_map(|pad| {
                if pad.confirmation {
                    return None;
                }
                let elapsed = pad.down_at?.elapsed();
                let due = if crate::mode::is_init() {
                    Duration::from_millis(init_hold_due_ms(pad.hold_fires))
                } else if pad.returned {
                    return None;
                } else if pad.hinted {
                    HOME_AFTER
                } else {
                    HINT_AFTER
                };
                Some(due.saturating_sub(elapsed))
            })
            .min();
        let timeout_ms = timeout
            .map(|d| d.as_millis().saturating_add(1).min(i32::MAX as u128) as i32)
            .unwrap_or(-1);
        let mut fds: Vec<libc::pollfd> = pads
            .iter()
            .map(|pad| libc::pollfd {
                fd: pad.device.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            })
            .collect();
        let rc = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as _, timeout_ms) };
        if rc < 0 && std::io::Error::last_os_error().kind() != ErrorKind::Interrupted {
            log::warn!("knob poll: {}", std::io::Error::last_os_error());
            return false;
        }
        if fds
            .iter()
            .any(|fd| fd.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0)
        {
            return false;
        }
    }
}

fn poll_one(pad: &mut Pad, shared: &Shared) -> bool {
    match pad.device.fetch_events() {
        Ok(events) => {
            for ev in events {
                match ev.destructure() {
                    EventSummary::RelativeAxis(_, RelativeAxisCode::REL_X, value) => {
                        shared.push_knob(-value);
                    }
                    EventSummary::Key(_, KeyCode::KEY_ENTER, 1) => {
                        pad.confirmation = shared.system_actions.preparing();
                        shared.system_actions.set_pressed(true);
                        if pad.confirmation {
                            shared.note_input();
                        }
                        pad.down_at = Some(Instant::now());
                        pad.hinted = false;
                        pad.returned = false;
                        pad.hold_fires = 0;
                    }
                    EventSummary::Key(_, KeyCode::KEY_ENTER, 0) => {
                        shared.system_actions.set_pressed(false);
                        if pad.confirmation {
                            pad.down_at = None;
                            pad.confirmation = false;
                            shared.note_input();
                            shared.push_knob_click();
                            continue;
                        }
                        if !pad.returned
                            && pad.down_at.is_some_and(|t0| {
                                should_return_home(crate::mode::is_init(), t0.elapsed())
                            })
                        {
                            pad.returned = true;
                            shared.set_hint("");
                            shared.set_shell_page(0);
                            shared.set_launch("shell");
                        }
                        let was_held = !release_is_click(pad.hinted, pad.returned, pad.hold_fires);
                        pad.down_at = None;
                        if pad.hinted && !pad.returned {
                            shared.set_hint("");
                        }
                        pad.hinted = false;
                        pad.returned = false;
                        pad.hold_fires = 0;
                        if !was_held {
                            shared.push_knob_click();
                        }
                    }
                    _ => {}
                }
            }
        }
        Err(err) if err.kind() == ErrorKind::WouldBlock => {}
        Err(err) => {
            log::debug!("knob {}: {err}", pad.path.display());
            return false;
        }
    }
    if pad.confirmation {
        return true;
    }
    if crate::mode::is_init() {
        if let Some(t0) = pad.down_at {
            let elapsed = t0.elapsed();
            let due_ms = init_hold_due_ms(pad.hold_fires);
            if elapsed >= Duration::from_millis(due_ms) {
                pad.hold_fires = pad.hold_fires.saturating_add(1);
                shared.push_knob_hold();
            }
        }
        return true;
    }
    if let Some(t0) = pad.down_at {
        let elapsed = t0.elapsed();
        if !pad.returned && elapsed >= HOME_AFTER {
            return_home(pad, shared);
        } else if !pad.hinted && elapsed >= HINT_AFTER {
            pad.hinted = true;
            shared.set_hint_for(
                crate::locale::knob_hold_hint(&shared.language()),
                Duration::from_secs(4),
            );
        }
    }
    true
}

fn return_home(pad: &mut Pad, shared: &Shared) {
    pad.returned = true;
    shared.set_hint("");
    shared.set_shell_page(0);
    shared.set_launch("shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_hold_backspaces_and_does_not_go_home() {
        assert_eq!(init_hold_due_ms(0), 450);
        assert_eq!(init_hold_due_ms(1), 580);
        assert!(!release_is_click(false, false, 1));
        assert!(release_is_click(false, false, 0));
        assert!(!should_return_home(true, Duration::from_secs(30)));
        assert!(!should_return_home(false, Duration::from_secs(4)));
        assert!(should_return_home(false, HOME_AFTER));
    }
}
