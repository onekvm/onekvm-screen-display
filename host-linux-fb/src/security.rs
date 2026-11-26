//! Root-only Core security management for the packaged Security App.
use std::{sync::atomic::{AtomicU64, Ordering}, time::Duration};
use serde_json::Value;

static GENERATION: AtomicU64 = AtomicU64::new(1);
pub fn generation() -> u64 { GENERATION.load(Ordering::Relaxed) }
pub fn invalidate() { GENERATION.fetch_add(1, Ordering::Relaxed); }

pub fn call(action: &str, payload: &str) -> Result<Value, String> {
    let conn = zbus::blocking::connection::Builder::system()
        .and_then(|builder| builder.method_timeout(Duration::from_secs(25)).build())
        .map_err(|error| error.to_string())?;
    let proxy = zbus::blocking::Proxy::new(&conn, "org.onekvm.Core1", "/org/onekvm/Core1/Management", "org.onekvm.Core1.Management")
        .map_err(|error| error.to_string())?;
    let raw: String = proxy.call("Security", &(action, payload)).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}
