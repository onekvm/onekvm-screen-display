use serde_json::Value;

const MAX_JSON_BYTES: usize = 900_000;
const MAX_SIDE: usize = 1024;
const MAX_PIXELS: usize = 512 * 512;

#[derive(Debug)]
pub struct BackgroundImage {
    width: usize,
    height: usize,
    pixels: Vec<u16>,
    encoded: crate::file_blob::FileBlob,
}

impl BackgroundImage {
    pub fn parse(raw: &str) -> Result<Option<Self>, String> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Ok(None);
        }
        if raw.len() > MAX_JSON_BYTES {
            return Err("background image payload is too large".into());
        }

        let value: Value = serde_json::from_str(raw)
            .map_err(|err| format!("invalid background image JSON: {err}"))?;
        let version = value.get("v").and_then(Value::as_u64);
        if version != Some(1) {
            return Err("unsupported background image version".into());
        }
        let width = dimension(&value, "width")?;
        let height = dimension(&value, "height")?;
        let count = width
            .checked_mul(height)
            .filter(|count| *count <= MAX_PIXELS)
            .ok_or_else(|| "background image dimensions are too large".to_string())?;
        let encoded_pixels = value
            .get("pixels")
            .and_then(Value::as_str)
            .ok_or_else(|| "background image pixels are missing".to_string())?;
        let bytes = decode_base64(encoded_pixels)?;
        let expected = count
            .checked_mul(2)
            .ok_or_else(|| "background image dimensions are too large".to_string())?;
        if bytes.len() != expected {
            return Err(format!(
                "background image has {} pixel bytes; expected {expected}",
                bytes.len()
            ));
        }
        let pixels = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let encoded = serde_json::json!({
            "v": 1,
            "width": width,
            "height": height,
            "pixels": encoded_pixels,
        })
        .to_string();

        Ok(Some(Self {
            width,
            height,
            pixels,
            encoded: crate::file_blob::FileBlob::Owned(encoded.into_bytes()),
        }))
    }

    pub fn encoded(&self) -> &str {
        std::str::from_utf8(&self.encoded).expect("validated background JSON")
    }

    pub fn encoded_owned(&self) -> String {
        let value = self.encoded().to_owned();
        self.encoded.release_pages();
        value
    }

    pub fn map_metadata(&mut self, path: &std::path::Path) {
        let Ok(bytes) = crate::file_blob::FileBlob::open(path) else { return; };
        if &*bytes != &*self.encoded { return; }
        self.encoded = bytes;
        self.encoded.release_pages();
    }

    /// Center-crop like CSS `background-size: cover`, then scale with nearest
    /// neighbour so the browser preview and RGB565 panel keep the same framing.
    pub fn render_cover(&self, target: &mut [u16], width: usize, height: usize) -> bool {
        let Some(target_len) = width.checked_mul(height) else {
            return false;
        };
        if width == 0 || height == 0 || target.len() < target_len {
            return false;
        }
        if width == self.width && height == self.height {
            target[..target_len].copy_from_slice(&self.pixels);
            return true;
        }

        let (crop_x, crop_y, crop_w, crop_h) =
            if self.width.saturating_mul(height) > width.saturating_mul(self.height) {
                let crop_w = (self.height.saturating_mul(width) / height).max(1);
                (
                    (self.width.saturating_sub(crop_w)) / 2,
                    0,
                    crop_w,
                    self.height,
                )
            } else {
                let crop_h = (self.width.saturating_mul(height) / width).max(1);
                (
                    0,
                    (self.height.saturating_sub(crop_h)) / 2,
                    self.width,
                    crop_h,
                )
            };

        for y in 0..height {
            let source_y = crop_y + (y.saturating_mul(crop_h) / height).min(crop_h - 1);
            let source_row = source_y * self.width;
            let target_row = y * width;
            for x in 0..width {
                let source_x = crop_x + (x.saturating_mul(crop_w) / width).min(crop_w - 1);
                target[target_row + x] = self.pixels[source_row + source_x];
            }
        }
        true
    }
}

fn dimension(value: &Value, key: &str) -> Result<usize, String> {
    let dimension = value
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| (1..=MAX_SIDE).contains(value))
        .ok_or_else(|| format!("invalid background image {key}"))?;
    Ok(dimension)
}

pub(crate) fn decode_base64(encoded: &str) -> Result<Vec<u8>, String> {
    let bytes = encoded.as_bytes();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return Err("invalid background image base64 length".into());
    }
    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    let chunks = bytes.len() / 4;
    for (index, chunk) in bytes.chunks_exact(4).enumerate() {
        let last = index + 1 == chunks;
        let a = base64_value(chunk[0])?;
        let b = base64_value(chunk[1])?;
        let c = if chunk[2] == b'=' {
            None
        } else {
            Some(base64_value(chunk[2])?)
        };
        let d = if chunk[3] == b'=' {
            None
        } else {
            Some(base64_value(chunk[3])?)
        };
        if a > 63
            || b > 63
            || (!last && (c.is_none() || d.is_none()))
            || (c.is_none() && d.is_some())
        {
            return Err("invalid background image base64 padding".into());
        }
        output.push((a << 2) | (b >> 4));
        if let Some(c) = c {
            output.push((b << 4) | (c >> 2));
            if let Some(d) = d {
                output.push((c << 6) | d);
            }
        }
    }
    Ok(output)
}

fn base64_value(byte: u8) -> Result<u8, String> {
    match byte {
        b'A'..=b'Z' => Ok(byte - b'A'),
        b'a'..=b'z' => Ok(byte - b'a' + 26),
        b'0'..=b'9' => Ok(byte - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err("invalid background image base64 data".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::BackgroundImage;

    #[test]
    fn bundled_default_is_a_valid_rgb565_background() {
        let image = BackgroundImage::parse(include_str!("../../src/shared/default-background.json"))
            .unwrap().unwrap();
        let mut pixels = vec![0; 320 * 172];
        assert!(image.render_cover(&mut pixels, 320, 172));
        assert!(pixels.iter().any(|pixel| *pixel != 0));
    }

    #[test]
    fn parses_rgb565_little_endian_pixels() {
        let image = BackgroundImage::parse(r#"{"v":1,"width":2,"height":1,"pixels":"AQACAA=="}"#)
            .unwrap()
            .unwrap();
        let mut target = [0u16; 8];
        assert!(image.render_cover(&mut target, 4, 2));
        assert_eq!(target, [1, 1, 2, 2, 1, 1, 2, 2]);
    }

    #[test]
    fn rejects_wrong_pixel_length() {
        let error =
            BackgroundImage::parse(r#"{"v":1,"width":2,"height":1,"pixels":"AQA="}"#).unwrap_err();
        assert!(error.contains("expected 4"));
    }

    #[test]
    fn empty_payload_clears_the_image() {
        assert!(BackgroundImage::parse("  ").unwrap().is_none());
    }
}
