//! Guest-local QR encoding. No network, configuration or shared guest state.
use qrcodegen::{QrCode, QrCodeEcc};

pub fn encode(payload: &str) -> String {
    if payload.is_empty() || payload.len() > 1024 {
        return String::new();
    }
    let Ok(qr) = QrCode::encode_text(payload, QrCodeEcc::Medium) else {
        return String::new();
    };
    let size = qr.size();
    let mut runs = Vec::<[i32; 3]>::new();
    for y in 0..size {
        let mut x = 0;
        while x < size {
            if !qr.get_module(x, y) { x += 1; continue; }
            let start = x;
            while x < size && qr.get_module(x, y) { x += 1; }
            runs.push([start, y, x - start]);
        }
    }
    serde_json::json!({"size": size, "runs": runs}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_preserves_every_module_of_the_authorization_link() {
        let url = "https://login.netbird.io/activate?user_code=ABCD-EFGH";
        let expected = QrCode::encode_text(url, QrCodeEcc::Medium).unwrap();
        let result: serde_json::Value = serde_json::from_str(&encode(url)).unwrap();
        let size = result["size"].as_i64().unwrap() as i32;
        let mut modules = vec![false; (size * size) as usize];
        for run in result["runs"].as_array().unwrap() {
            let x = run[0].as_i64().unwrap() as i32;
            let y = run[1].as_i64().unwrap() as i32;
            let width = run[2].as_i64().unwrap() as i32;
            for dx in 0..width { modules[(y * size + x + dx) as usize] = true; }
        }
        for y in 0..size { for x in 0..size {
            assert_eq!(modules[(y * size + x) as usize], expected.get_module(x, y));
        }}
        assert_ne!(encode(url), encode("https://login.netbird.io/activate?user_code=OTHER"));
    }

    #[test]
    fn empty_and_oversized_requests_clear_the_code() {
        assert!(encode("").is_empty());
        assert!(encode(&"x".repeat(1025)).is_empty());
    }
}
