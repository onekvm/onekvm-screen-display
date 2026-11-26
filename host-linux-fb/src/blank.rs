//! Turn the panel backlight off after idle time. The framebuffer keeps its last frame.

use std::fs;
use std::thread;
use std::time::Duration;

use crate::shared::Shared;

pub fn spawn(shared: std::sync::Arc<Shared>) {
    thread::spawn(move || loop {
        let generation = shared.wake.generation();
        shared.tick_blank();
        shared.drive_jobs();
        if crate::mode::is_init() { shared.check_startup(); }
        shared.wake.wait(generation, shared.blank_delay());
    });
}

#[derive(Clone, Debug)]
pub struct PanelNodes {
    pub blank: std::path::PathBuf,
    pub backlight: std::path::PathBuf,
}

impl PanelNodes {
    pub fn live() -> Self {
        Self {
            blank: "/sys/class/graphics/fb0/blank".into(),
            backlight: "/sys/class/backlight".into(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlankStep {
    Hold,
    Blank,
    Wake,
}

/// `seconds == 0` is never: no timer, and a panel that is already off wakes.
pub fn decide_blank(seconds: u32, idle: Duration, blanked: bool) -> BlankStep {
    if seconds == 0 {
        return if blanked {
            BlankStep::Wake
        } else {
            BlankStep::Hold
        };
    }
    if !blanked && idle >= Duration::from_secs(u64::from(seconds)) {
        BlankStep::Blank
    } else {
        BlankStep::Hold
    }
}

pub fn decide_input(blanked: bool) -> BlankStep {
    if blanked {
        BlankStep::Wake
    } else {
        BlankStep::Hold
    }
}

pub fn apply_idle(
    nodes: &PanelNodes,
    seconds: u32,
    idle: Duration,
    blanked: &mut bool,
    brightness_pct: i32,
) {
    match decide_blank(seconds, idle, *blanked) {
        BlankStep::Hold => {}
        BlankStep::Blank => {
            *blanked = true;
            commit_blank(nodes);
        }
        BlankStep::Wake => {
            *blanked = false;
            commit_wake(nodes, brightness_pct);
        }
    }
}

pub fn apply_input(nodes: &PanelNodes, blanked: &mut bool, brightness_pct: i32) {
    if decide_input(*blanked) == BlankStep::Wake {
        *blanked = false;
        commit_wake(nodes, brightness_pct);
    }
}

pub fn blank_panel() {
    commit_blank(&PanelNodes::live());
}

pub fn wake_panel(brightness_pct: i32) {
    commit_wake(&PanelNodes::live(), brightness_pct);
}

pub fn commit_blank(nodes: &PanelNodes) {
    let _ = fs::write(&nodes.blank, "1\n");
    write_backlight(&nodes.backlight, 0);
}

pub fn commit_wake(nodes: &PanelNodes, brightness_pct: i32) {
    let _ = fs::write(&nodes.blank, "0\n");
    let pct = brightness_pct.clamp(5, 100);
    let Ok(dir) = fs::read_dir(&nodes.backlight) else {
        return;
    };
    for ent in dir.flatten() {
        let path = ent.path();
        let max = fs::read_to_string(path.join("max_brightness"))
            .ok()
            .and_then(|text| text.trim().parse::<i32>().ok())
            .unwrap_or(100)
            .max(1);
        let val = 1 + (pct - 5) * (max - 1) / 95;
        let _ = fs::write(path.join("brightness"), format!("{val}\n"));
        break;
    }
}

fn write_backlight(dir: &std::path::Path, value: i32) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let _ = fs::write(ent.path().join("brightness"), format!("{value}\n"));
        break;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn fixture() -> (std::path::PathBuf, PanelNodes) {
        let root = std::env::temp_dir().join(format!(
            "onekvm-blank-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let backlight = root.join("backlight");
        let panel = backlight.join("panel");
        fs::create_dir_all(&panel).unwrap();
        fs::write(panel.join("max_brightness"), "100\n").unwrap();
        fs::write(panel.join("brightness"), "80\n").unwrap();
        fs::write(root.join("blank"), "0\n").unwrap();
        let nodes = PanelNodes {
            blank: root.join("blank"),
            backlight,
        };
        (root, nodes)
    }

    fn blank_text(nodes: &PanelNodes) -> String {
        fs::read_to_string(&nodes.blank).unwrap()
    }

    fn light(nodes: &PanelNodes) -> String {
        fs::read_to_string(nodes.backlight.join("panel/brightness")).unwrap()
    }

    #[test]
    fn never_does_not_blank_and_wakes() {
        let (root, nodes) = fixture();
        let mut blanked = false;
        apply_idle(&nodes, 0, Duration::from_secs(3600), &mut blanked, 40);
        assert!(!blanked);
        assert_eq!(blank_text(&nodes).trim(), "0");
        blanked = true;
        fs::write(&nodes.blank, "1\n").unwrap();
        apply_idle(&nodes, 0, Duration::from_secs(3600), &mut blanked, 40);
        assert!(!blanked);
        assert_eq!(blank_text(&nodes).trim(), "0");
        assert_ne!(light(&nodes).trim(), "0");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn idle_blanks_then_input_wakes_and_resets() {
        let (root, nodes) = fixture();
        let mut blanked = false;
        apply_idle(&nodes, 15, Duration::from_secs(14), &mut blanked, 40);
        assert!(!blanked);
        assert_eq!(blank_text(&nodes).trim(), "0");
        apply_idle(&nodes, 15, Duration::from_secs(15), &mut blanked, 40);
        assert!(blanked);
        assert_eq!(blank_text(&nodes).trim(), "1");
        assert_eq!(light(&nodes).trim(), "0");
        apply_input(&nodes, &mut blanked, 40);
        assert!(!blanked);
        assert_eq!(blank_text(&nodes).trim(), "0");
        assert_ne!(light(&nodes).trim(), "0");
        apply_idle(&nodes, 15, Duration::ZERO, &mut blanked, 40);
        assert!(!blanked);
        assert_eq!(blank_text(&nodes).trim(), "0");
        let _ = fs::remove_dir_all(root);
    }
}
