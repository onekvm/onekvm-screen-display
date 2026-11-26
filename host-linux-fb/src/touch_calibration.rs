//! Optional touch calibration from `/usr/share/onekvm/machine.json`
//! `screen_display.touch_calibration`: six numbers `[a, b, c, d, e, f]`, the
//! same matrix libinput uses. They act on the touch position normalized to
//! 0..1 by the device's axis maxima, before rotation:
//! `x' = a·x + b·y + c`, `y' = d·x + e·y + f`, where x and y follow the panel's
//! physical width and height. Without it, touch positions scale linearly.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TouchCalibration([f32; 6]);

impl Default for TouchCalibration {
    fn default() -> Self {
        Self([1.0, 0.0, 0.0, 0.0, 1.0, 0.0])
    }
}

impl TouchCalibration {
    pub fn load() -> Self {
        std::fs::read("/usr/share/onekvm/machine.json")
            .ok()
            .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
            .map(|value| Self::from_json(&value))
            .unwrap_or_default()
    }

    fn from_json(machine: &serde_json::Value) -> Self {
        let Some(values) = machine["screen_display"]["touch_calibration"].as_array() else {
            return Self::default();
        };
        let numbers: Vec<f32> = values
            .iter()
            .filter_map(|v| v.as_f64())
            .filter(|v| v.is_finite())
            .map(|v| v as f32)
            .collect();
        match <[f32; 6]>::try_from(numbers) {
            Ok(matrix) if values.len() == 6 => Self(matrix),
            _ => {
                log::warn!("ignoring screen_display.touch_calibration: expected six numbers");
                Self::default()
            }
        }
    }

    pub fn is_identity(&self) -> bool {
        *self == Self::default()
    }

    /// Panel pixel for device position (`x`, `y`) with axis maxima `max_x`,
    /// `max_y`, clamped to a `width` × `height` panel.
    pub fn panel_px(&self, x: i32, y: i32, max_x: i32, max_y: i32, width: i32, height: i32) -> (usize, usize) {
        let (px, py) = if self.is_identity() {
            (x * (width - 1) / max_x, y * (height - 1) / max_y)
        } else {
            let [a, b, c, d, e, f] = self.0;
            let (u, v) = (x as f32 / max_x as f32, y as f32 / max_y as f32);
            let (u, v) = (a * u + b * v + c, d * u + e * v + f);
            ((u * (width - 1) as f32).round() as i32, (v * (height - 1) as f32).round() as i32)
        };
        (px.clamp(0, width - 1) as usize, py.clamp(0, height - 1) as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine(calibration: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "screen_display": { "touch_calibration": calibration } })
    }

    #[test]
    fn missing_or_invalid_matrix_keeps_linear_scaling() {
        assert!(TouchCalibration::from_json(&serde_json::json!({})).is_identity());
        for bad in [
            serde_json::json!([1, 0, 0, 0, 1]),
            serde_json::json!([1, 0, 0, 0, 1, 0, 0]),
            serde_json::json!([1, 0, 0, 0, 1, "0"]),
            serde_json::json!("1 0 0 0 1 0"),
        ] {
            assert!(TouchCalibration::from_json(&machine(bad)).is_identity());
        }
    }

    #[test]
    fn identity_matches_integer_scaling_exactly() {
        let identity = TouchCalibration::default();
        for x in 0..=239 {
            for y in [0, 17, 133, 268, 295] {
                assert_eq!(
                    identity.panel_px(x, y, 239, 295, 240, 284),
                    ((x * 239 / 239) as usize, (y * 283 / 295) as usize)
                );
            }
        }
    }

    #[test]
    fn matrix_scales_skews_and_clamps() {
        // Device y reaches only 60% of the panel height, shifted by 10%, with
        // a little x in it; x is untouched.
        let calibration = TouchCalibration::from_json(&machine(serde_json::json!([1, 0, 0, 0.1, 1.5, -0.1])));
        assert!(!calibration.is_identity());
        assert_eq!(calibration.panel_px(0, 0, 100, 100, 101, 101), (0, 0));
        assert_eq!(calibration.panel_px(50, 40, 100, 100, 101, 101), (50, 55));
        assert_eq!(calibration.panel_px(100, 100, 100, 100, 101, 101), (100, 100));
        assert_eq!(calibration.panel_px(100, 0, 100, 100, 101, 101), (100, 0));
    }
}
