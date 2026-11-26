//! Register the managed framebuffer service for display + HID.
//! A private legacy token remains for older Core versions.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::sync::Mutex;

pub const EXT_ID: &str = "screen-display";
static REGISTRATION: Mutex<()> = Mutex::new(());
const AUTH_DIR: &str = "/run/onekvm/extension-auth";

pub fn ensure(data_dir: &Path) -> io::Result<(String, String)> {
    let _registration = REGISTRATION.lock().unwrap();
    ensure_at(data_dir, Path::new(AUTH_DIR))
}

fn private_write(path: &Path, body: &str) -> io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    file.write_all(body.as_bytes())
}

fn ensure_at(data_dir: &Path, auth_dir: &Path) -> io::Result<(String, String)> {
    let token_path = data_dir.join("media-token");
    let token = match fs::read_to_string(&token_path) {
        Ok(text)
            if text.trim().len() == 64 && text.trim().bytes().all(|b| b.is_ascii_hexdigit()) =>
        {
            text.trim().to_string()
        }
        _ => {
            let mut raw = [0u8; 32];
            File::open("/dev/urandom")?.read_exact(&mut raw)?;
            let next = raw.iter().map(|b| format!("{b:02x}")).collect::<String>();
            private_write(&token_path, &next)?;
            next
        }
    };
    fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600))?;
    fs::create_dir_all(auth_dir)?;
    let body = format!(
        "{{\"id\":\"{EXT_ID}\",\"token\":\"{token}\",\"unit\":\"onekvm-device-screen-display.service\",\"capabilities\":[\"video.display\",\"hid\"]}}\n"
    );
    let auth_path = auth_dir.join(format!("{EXT_ID}.json"));
    private_write(&auth_path, &body)?;
    Ok((EXT_ID.to_string(), token))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_names_the_device_unit_and_limits_capabilities() {
        let dir = std::env::temp_dir().join(format!("display-auth-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let auth_dir = dir.join("auth");
        let first = ensure_at(&dir, &auth_dir).unwrap();
        let second = ensure_at(&dir, &auth_dir).unwrap();
        assert_eq!(first, second);
        let path = auth_dir.join("screen-display.json");
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["unit"], "onekvm-device-screen-display.service");
        assert_eq!(
            value["capabilities"],
            serde_json::json!(["video.display", "hid"])
        );
        for path in [path, dir.join("media-token")] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
