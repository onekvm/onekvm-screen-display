//! The built-in media and keyboard Apps share Core's Web control logic.
use serde_json::Value;
use std::time::Duration;

pub fn call(interface: &str, action: &str, payload: &str) -> Result<Value, String> {
    let connection = zbus::blocking::connection::Builder::system()
        .and_then(|builder| builder.method_timeout(Duration::from_secs(25)).build())
        .map_err(|error| error.to_string())?;
    let proxy = zbus::blocking::Proxy::new(&connection, "org.onekvm.Core1", "/org/onekvm/Core1/Management", "org.onekvm.Core1.Management")
        .map_err(|error| error.to_string())?;
    let raw: String = proxy.call(interface, &(action, payload)).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}
