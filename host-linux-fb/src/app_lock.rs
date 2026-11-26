//! Local launcher PIN, separate from Web authentication. Home is always public.
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct State {
    hash: Option<String>,
    timeout: u64,
    unlocked: bool,
    pending: String,
    failures: u32,
    blocked_until: Option<Instant>,
    result: String,
}
pub struct AppLock {
    path: PathBuf,
    state: Mutex<State>,
    busy: AtomicBool,
}

fn valid_pin(pin: &str) -> bool {
    (4..=8).contains(&pin.len()) && pin.bytes().all(|b| b.is_ascii_digit())
}
fn hasher() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19 * 1024, 2, 1, None).expect("PIN hash parameters"),
    )
}
fn hash_pin(pin: &str) -> Result<String, String> {
    let mut salt = [0u8; 16];
    File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut salt))
        .map_err(|e| e.to_string())?;
    let salt = SaltString::encode_b64(&salt).map_err(|e| e.to_string())?;
    hasher()
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}
fn verify_pin(pin: &str, hash: &str) -> bool {
    valid_pin(pin)
        && PasswordHash::new(hash)
            .is_ok_and(|h| hasher().verify_password(pin.as_bytes(), &h).is_ok())
}
fn check_pin(s: &mut State, pin: &str, now: Instant) -> bool {
    if s.blocked_until.is_some_and(|until| now < until) {
        s.result = "error:wait".into();
        return false;
    }
    if !s.hash.as_ref().is_some_and(|hash| verify_pin(pin, hash)) {
        s.failures += 1;
        if s.failures >= 5 {
            s.blocked_until = Some(now + Duration::from_secs(30));
            s.failures = 0;
        }
        s.result = "error:pin".into();
        return false;
    }
    s.failures = 0;
    s.blocked_until = None;
    true
}

impl AppLock {
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join("app-lock.json");
        let (hash, timeout) = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                Ok(v) if v.get("hash").is_some_and(|h| h.is_null() || h.is_string()) => (
                    v["hash"].as_str().map(str::to_owned),
                    v["timeout"].as_u64().unwrap_or(60).clamp(15, 3600),
                ),
                _ => (Some("invalid".into()), 60), // Corruption must not silently disable the lock.
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (None, 60),
            Err(_) => (Some("invalid".into()), 60),
        };
        Self {
            path,
            state: Mutex::new(State {
                hash,
                timeout,
                unlocked: false,
                pending: String::new(),
                failures: 0,
                blocked_until: None,
                result: String::new(),
            }),
            busy: AtomicBool::new(false),
        }
    }
    pub fn begin(&self) -> bool {
        !self.busy.swap(true, Ordering::AcqRel)
    }
    pub fn finish(&self) {
        self.busy.store(false, Ordering::Release);
    }
    pub fn authorized(&self) -> bool {
        let s = self.state.lock().unwrap();
        s.hash.is_none() || (s.unlocked && s.pending.is_empty())
    }
    pub fn route(&self, requested: &str) -> String {
        let mut s = self.state.lock().unwrap();
        if requested == "shell" {
            s.unlocked = false;
            s.pending.clear();
            s.result.clear();
            return requested.into();
        }
        if s.hash.is_some() && !s.unlocked {
            // Authentication opens the launcher, never an individual App.
            s.pending = "launcher".into();
            s.result.clear();
            "settings".into()
        } else {
            requested.into()
        }
    }
    /// Revoke idle authorization without requiring a guest frame or navigation.
    pub fn expire(&self, idle: Duration) -> bool {
        let mut s = self.state.lock().unwrap();
        if s.hash.is_none() || idle < Duration::from_secs(s.timeout)
            || (!s.unlocked && s.pending.is_empty()) {
            return false;
        }
        s.unlocked = false;
        s.pending.clear();
        s.result.clear();
        true
    }
    pub fn json(&self) -> String {
        let s = self.state.lock().unwrap();
        let wait = s
            .blocked_until
            .map(|until| {
                until
                    .saturating_duration_since(Instant::now())
                    .as_millis()
                    .div_ceil(1000) as u64
            })
            .unwrap_or(0);
        json!({"enabled": s.hash.is_some(), "timeout": s.timeout, "pending": s.pending, "result": s.result, "wait": wait, "busy": self.busy.load(Ordering::Acquire)}).to_string()
    }
    pub fn unlock(&self, pin: &str) -> Option<String> {
        let mut s = self.state.lock().unwrap();
        if s.pending.is_empty() || !check_pin(&mut s, pin, Instant::now()) {
            return None;
        }
        s.unlocked = true;
        s.result = "ok".into();
        Some(std::mem::take(&mut s.pending))
    }
    pub fn configure(&self, raw: &str) {
        if raw.len() > 1024 {
            return;
        }
        let result = self.configure_inner(raw);
        self.state.lock().unwrap().result = match result {
            Ok(()) => "ok".into(),
            Err(e) => format!("error:{e}"),
        };
    }
    fn configure_inner(&self, raw: &str) -> Result<(), String> {
        let v: Value = serde_json::from_str(raw).map_err(|_| "invalid".to_string())?;
        let mut s = self.state.lock().unwrap();
        if s.hash.is_some() && (!s.unlocked || !s.pending.is_empty()) {
            return Err("locked".into());
        }
        let operation = v["operation"].as_str().unwrap_or("");
        let mut hash = s.hash.clone();
        let mut timeout = s.timeout;
        match operation {
            "timeout" => {
                timeout = v["timeout"]
                    .as_u64()
                    .filter(|n| (15..=3600).contains(n))
                    .ok_or("invalid")?
            }
            "set" | "disable" => {
                if s.hash.is_some()
                    && !check_pin(&mut s, v["current"].as_str().unwrap_or(""), Instant::now())
                {
                    return Err("pin".into());
                }
                hash = if operation == "disable" {
                    None
                } else {
                    let pin = v["pin"]
                        .as_str()
                        .filter(|p| valid_pin(p))
                        .ok_or("invalid")?;
                    Some(hash_pin(pin)?)
                };
            }
            _ => return Err("invalid".into()),
        }
        let body = json!({"hash": hash, "timeout": timeout}).to_string();
        let tmp = self.path.with_extension("json.tmp");
        let save = || -> std::io::Result<()> {
            let mut f = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&tmp)?;
            f.write_all(body.as_bytes())?;
            f.sync_all()?;
            fs::rename(&tmp, &self.path)?;
            if let Some(dir) = self.path.parent() {
                File::open(dir)?.sync_all()?;
            }
            Ok(())
        };
        save().map_err(|_| "save".to_string())?;
        s.hash = hash;
        s.timeout = timeout;
        s.unlocked = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn pin_validation_and_salted_hashes() {
        for pin in ["", "123", "123456789", "abcd", "１２３４"] {
            assert!(!valid_pin(pin));
        }
        let a = hash_pin("012345").unwrap();
        let b = hash_pin("012345").unwrap();
        assert_ne!(a, b);
        assert!(verify_pin("012345", &a));
        assert!(!verify_pin("012346", &a));
    }
    #[test]
    fn launcher_entry_timeout_configuration_and_rate_limit() {
        let dir = std::env::temp_dir().join(format!("onekvm-app-lock-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let lock = AppLock::load(&dir);
        assert_eq!(lock.route("stream"), "stream");
        lock.configure(r#"{"operation":"set","pin":"1234"}"#);
        assert!(lock.authorized());
        assert_eq!(lock.route("shell"), "shell");
        assert_eq!(lock.route("stream"), "settings");
        assert!(!lock.authorized());
        assert!(lock.unlock("9999").is_none());
        assert_eq!(lock.unlock("1234"), Some("launcher".into()));
        assert!(lock.authorized());
        // Apps share the authorization obtained at the list entrance.
        assert_eq!(lock.route("stream"), "stream");
        assert_eq!(lock.route("settings"), "settings");
        assert_eq!(lock.route("launcher"), "launcher");
        assert!(!lock.expire(Duration::from_secs(59)));
        assert!(lock.expire(Duration::from_secs(60)));
        assert!(!lock.authorized());
        assert_eq!(lock.route("launcher"), "settings");
        assert_eq!(lock.unlock("1234"), Some("launcher".into()));
        lock.configure(r#"{"operation":"timeout","timeout":120}"#);
        assert!(!lock.expire(Duration::from_secs(60)));
        let body = fs::read_to_string(&lock.path).unwrap();
        assert!(!body.contains("1234"));
        assert_eq!(
            fs::metadata(&lock.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let reloaded = AppLock::load(&dir);
        assert!(!reloaded.authorized());
        assert_eq!(reloaded.route("settings"), "settings");
        for _ in 0..5 {
            assert!(reloaded.unlock("9999").is_none());
        }
        assert!(reloaded.unlock("1234").is_none());
        assert!(
            serde_json::from_str::<Value>(&reloaded.json()).unwrap()["wait"]
                .as_u64()
                .unwrap()
                > 0
        );
        lock.configure(r#"{"operation":"disable","current":"9999"}"#);
        assert_eq!(lock.state.lock().unwrap().hash.is_some(), true);
        lock.configure(r#"{"operation":"disable","current":"1234"}"#);
        assert!(lock.state.lock().unwrap().hash.is_none());
        assert_eq!(lock.route("launcher"), "launcher");
        fs::remove_file(&lock.path).unwrap();
        fs::remove_dir(&dir).unwrap();
    }
    #[test]
    fn idle_timeout_locks_without_guest_frames_and_survives_input_reset() {
        let dir = std::env::temp_dir().join(format!("onekvm-idle-lock-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let lock = AppLock::load(&dir);
        assert!(!lock.expire(Duration::from_secs(3600)));
        lock.configure(r#"{"operation":"set","pin":"1234"}"#);
        lock.configure(r#"{"operation":"timeout","timeout":15}"#);
        assert!(!lock.expire(Duration::from_secs(14)));
        assert!(lock.authorized());
        // Idle maintenance still runs while guest execution is suspended.
        assert!(lock.expire(Duration::from_secs(15)));
        assert!(!lock.authorized());
        // Waking resets input idle, but cannot restore the old authorization.
        assert!(!lock.expire(Duration::ZERO));
        assert!(!lock.authorized());
        assert_eq!(lock.route("launcher"), "settings");
        assert_eq!(lock.unlock("1234"), Some("launcher".into()));
        // An expired PIN prompt must also be cancelled without a guest frame.
        lock.route("shell");
        lock.route("launcher");
        assert!(lock.expire(Duration::from_secs(15)));
        assert!(lock.unlock("1234").is_none());
        assert!(!lock.expire(Duration::from_secs(16)));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn returning_home_cancels_entry_and_locks_the_next_visit() {
        let dir = std::env::temp_dir().join(format!("onekvm-launcher-lock-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let lock = AppLock::load(&dir);
        lock.configure(r#"{"operation":"set","pin":"1234"}"#);
        lock.route("shell");
        assert_eq!(lock.route("launcher"), "settings");
        assert_eq!(serde_json::from_str::<Value>(&lock.json()).unwrap()["pending"], "launcher");
        lock.route("shell");
        assert!(lock.unlock("1234").is_none());
        assert_eq!(lock.route("launcher"), "settings");
        assert_eq!(lock.unlock("1234"), Some("launcher".into()));
        assert!(lock.authorized());
        lock.route("shell");
        assert!(!lock.authorized());
        assert_eq!(lock.route("launcher"), "settings");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn corrupt_configuration_fails_closed() {
        let dir =
            std::env::temp_dir().join(format!("onekvm-app-lock-corrupt-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("app-lock.json"), "invalid json").unwrap();
        let lock = AppLock::load(&dir);
        assert!(!lock.authorized());
        assert_eq!(lock.route("stream"), "settings");
        assert!(lock.unlock("1234").is_none());
        fs::remove_file(&lock.path).unwrap();
        fs::remove_dir(&dir).unwrap();
    }
}
