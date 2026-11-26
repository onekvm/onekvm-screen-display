//! User-facing angles are relative to the panel's installed upright position.
//! The persisted angle remains physical, preserving existing installations.

#[derive(Debug)]
pub struct RotationProfile {
    offset: u16,
    pub angles: Vec<u16>,
}

impl Default for RotationProfile {
    fn default() -> Self {
        Self {
            offset: 0,
            angles: vec![0, 90, 180, 270],
        }
    }
}

impl RotationProfile {
    pub fn load() -> Self {
        std::fs::read("/usr/share/onekvm/machine.json")
            .ok()
            .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
            .map(|value| Self::from_json(&value))
            .unwrap_or_default()
    }

    fn from_json(machine: &serde_json::Value) -> Self {
        let screen = &machine["screen_display"];
        let offset = screen["rotation_offset"]
            .as_u64()
            .filter(|deg| matches!(deg, 0 | 90 | 180 | 270))
            .unwrap_or(0) as u16;
        let angles: Vec<u16> = [0, 90, 180, 270]
            .into_iter()
            .filter(|deg| {
                screen["rotations"].as_array().is_some_and(|values| {
                    values.iter().any(|v| v.as_u64() == Some(u64::from(*deg)))
                })
            })
            .collect();
        Self {
            offset,
            angles: if angles.is_empty() {
                Self::default().angles
            } else {
                angles
            },
        }
    }

    pub fn logical(&self, physical: u16) -> u16 {
        (physical + 360 - self.offset) % 360
    }

    pub fn physical(&self, logical: u16) -> Option<u16> {
        self.angles
            .contains(&logical)
            .then(|| (logical + self.offset) % 360)
    }

    pub fn restore(&self, saved: u16, default: u16) -> u16 {
        if self.angles.contains(&self.logical(saved)) {
            saved
        } else if self.angles.contains(&self.logical(default)) {
            default
        } else {
            self.physical(self.angles[0]).unwrap()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pro() -> RotationProfile {
        RotationProfile::from_json(&serde_json::json!({"screen_display": {
            "rotate": 270, "rotation_offset": 270, "rotations": [0, 180]
        }}))
    }

    #[test]
    fn pro_upright_and_flipped_share_landscape_axes() {
        let profile = pro();
        assert_eq!(profile.physical(0), Some(270));
        assert_eq!(profile.physical(180), Some(90));
        assert_eq!(profile.logical(270), 0);
        assert_eq!(profile.logical(90), 180);
        assert_eq!(profile.physical(90), None);
        assert_eq!(profile.physical(270), None);
        assert_eq!(profile.physical(u16::MAX), None);
    }

    #[test]
    fn saved_physical_angles_preserve_the_existing_orientation() {
        let profile = pro();
        assert_eq!(profile.restore(270, 270), 270);
        assert_eq!(profile.restore(90, 270), 90);
        assert_eq!(profile.restore(0, 270), 270);
        assert_eq!(profile.restore(180, 270), 270);
    }

    #[test]
    fn other_machines_keep_all_four_angles() {
        let profile = RotationProfile::from_json(&serde_json::json!({}));
        for deg in [0, 90, 180, 270] {
            assert_eq!(profile.physical(deg), Some(deg));
            assert_eq!(profile.logical(deg), deg);
        }
    }
}
