//! Local API used by the init screen. NFS boot refuses address changes that would drop the lab link.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, Value as ZValue};

pub fn global_ipv6() -> String {
    let Ok(text) = fs::read_to_string("/proc/net/if_inet6") else {
        return String::new();
    };
    for line in text.lines() {
        let mut cols = line.split_whitespace();
        let Some(addr) = cols.next() else { continue };
        let Some(prefix) = cols.nth(1) else { continue };
        let Some(scope) = cols.next() else { continue };
        if scope != "00" || addr.len() != 32 {
            continue;
        }
        let prefix = u32::from_str_radix(prefix, 16).unwrap_or(0);
        return format!("{}/{}", format_v6(addr), prefix);
    }
    String::new()
}

pub fn wifi_present() -> bool {
    fs::metadata("/sys/class/net/wlan0").is_ok()
}

struct CachedLink {
    at: Instant,
    ssid: String,
    ip: String,
}

fn link_cache() -> &'static Mutex<Option<CachedLink>> {
    static CACHE: Mutex<Option<CachedLink>> = Mutex::new(None);
    &CACHE
}

/// Associated SSID and the IPv4 on wlan0. Cached so the NIC card can poll.
pub fn wifi_link() -> (String, String) {
    if let Ok(guard) = link_cache().lock() {
        if let Some(link) = guard.as_ref() {
            if link.at.elapsed() < Duration::from_secs(1) {
                return (link.ssid.clone(), link.ip.clone());
            }
        }
    }
    let ip = iface_ipv4("wlan0");
    let ssid = live_ssid();
    if let Ok(mut guard) = link_cache().lock() {
        *guard = Some(CachedLink {
            at: Instant::now(),
            ssid: ssid.clone(),
            ip: ip.clone(),
        });
    }
    (ssid, ip)
}

fn remember_wifi(ssid: &str) {
    let ip = iface_ipv4("wlan0");
    if let Ok(mut guard) = link_cache().lock() {
        *guard = Some(CachedLink {
            at: Instant::now(),
            ssid: ssid.to_string(),
            ip,
        });
    }
}

fn live_ssid() -> String {
    let Ok(conn) = Connection::system() else {
        return String::new();
    };
    let Ok(iface) = station_proxy(&conn) else {
        return String::new();
    };
    current_ssid(&conn, &iface)
}

pub fn iface_ipv4(name: &str) -> String {
    onekvm_net_address::display_ipv4(Some(name)).map(|ip| ip.to_string()).unwrap_or_default()
}

/// `eth` is a physical NIC that is not Wi-Fi. `wifi` is a client radio.
/// The retired setup AP and loopback are not choices. The managed hotspot
/// has its own role so Settings never opens the station scanner for it.
pub fn net_link_kind(name: &str, wireless: bool, physical: bool) -> Option<&'static str> {
    if name.is_empty() || name == "lo" || name == "ap0" {
        return None;
    }
    if name == "onekvm-ap0" {
        return Some("ap");
    }
    if wireless {
        return Some("wifi");
    }
    if physical {
        return Some("eth");
    }
    None
}

/// NICs the init screen can configure. Wired names come first.
pub fn net_links() -> String {
    let Ok(entries) = fs::read_dir("/sys/class/net") else {
        return "[]".into();
    };
    let mut links = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let wireless = path.join("wireless").exists() || path.join("phy80211").exists();
        let physical = path.join("device").exists();
        let Some(kind) = net_link_kind(&name, wireless, physical) else {
            continue;
        };
        links.push((kind, name));
    }
    links.sort_by_key(|(kind, name)| (match *kind { "eth" => 0, "wifi" => 1, _ => 2 }, name.clone()));
    let rows: Vec<Value> = links
        .into_iter()
        .map(|(kind, name)| json!({"name": name, "kind": kind}))
        .collect();
    Value::Array(rows).to_string()
}

pub fn wifi_scan() -> String {
    if !wifi_present() {
        return "[]".into();
    }
    // The HTTP API redirects to HTTPS and then requires a login. The panel
    // has neither curl nor a session, so that path returned instantly and the
    // list stayed empty. Ask wpa_supplicant directly.
    match scan_wifi_dbus() {
        Ok(body) => body,
        Err(err) => json!({"error": err}).to_string(),
    }
}

pub fn hotspot_command(action: &str, payload: &str) -> Result<String, String> {
    if !matches!(action, "ap-status" | "ap" | "ap-config") {
        return Err("invalid hotspot action".into());
    }
    if action != "ap-status" && nfs_root() {
        return Err("nfs".into());
    }
    crate::bus::with_core(
        "org.onekvm.Core1.Management", "/org/onekvm/Core1/Management",
        |proxy| proxy.call("Wifi", &(action, payload)).map_err(Into::into),
    ).map_err(|error| {
        log::warn!("screen hotspot {action}: {error:#}");
        error.to_string()
    })
}

struct ApHit {
    ssid: String,
    signal: i32,
    security: String,
    band: String,
    generation: u8,
}

/// One row per name. Bands and WPA2/WPA3 are kept; the stronger signal wins.
pub(crate) fn format_scan(hits: &[ApHit], current: &str) -> String {
    let mut best: Vec<ApHit> = Vec::new();
    for hit in hits {
        let ssid = hit.ssid.trim();
        if ssid.is_empty() {
            continue;
        }
        if let Some(row) = best.iter_mut().find(|row| row.ssid == ssid) {
            if hit.signal > row.signal {
                row.signal = hit.signal;
            }
            row.security = union_security(&row.security, &hit.security);
            if hit.generation > row.generation {
                row.generation = hit.generation;
            }
            if !hit.band.is_empty() && !row.band.split(',').any(|band| band == hit.band) {
                if row.band.is_empty() {
                    row.band = hit.band.clone();
                } else {
                    row.band = format!("{},{}", row.band, hit.band);
                }
            }
        } else {
            best.push(ApHit {
                ssid: ssid.to_string(),
                signal: hit.signal,
                security: hit.security.clone(),
                band: hit.band.clone(),
                generation: hit.generation,
            });
        }
    }
    best.sort_by(|a, b| b.signal.cmp(&a.signal).then_with(|| a.ssid.cmp(&b.ssid)));
    let rows: Vec<Value> = best
        .into_iter()
        .map(|row| {
            let mut bands: Vec<&str> = row
                .band
                .split(',')
                .filter(|band| !band.is_empty())
                .collect();
            bands.sort_by_key(|band| match *band {
                "2.4" => 0,
                "5" => 1,
                _ => 2,
            });
            bands.dedup();
            let generation = generation_label(row.generation, bands.contains(&"6"));
            json!({
                "ssid": row.ssid,
                "secure": row.security != "open" && row.security != "owe",
                "security": row.security,
                "bands": bands,
                "generation": generation,
                "connected": !current.is_empty() && row.ssid == current,
            })
        })
        .collect();
    Value::Array(rows).to_string()
}

fn generation_label(generation: u8, six: bool) -> String {
    if generation == 0 {
        return String::new();
    }
    if six && generation == 6 {
        return "Wi-Fi 6E".into();
    }
    format!("Wi-Fi {generation}")
}

fn union_security(left: &str, right: &str) -> String {
    let has2 = left == "wpa2" || right == "wpa2" || left == "wpa2-wpa3" || right == "wpa2-wpa3";
    let has3 = left == "wpa3" || right == "wpa3" || left == "wpa2-wpa3" || right == "wpa2-wpa3";
    if has2 && has3 {
        return "wpa2-wpa3".into();
    }
    let rank = |item: &str| match item {
        "wpa3" => 4,
        "wpa2" => 3,
        "wpa" => 2,
        "wep" => 1,
        "owe" => 1,
        _ => 0,
    };
    if rank(left) >= rank(right) {
        left.to_string()
    } else {
        right.to_string()
    }
}

/// Privacy is only "encrypted or not". RSN AKMs say WPA2, WPA3, or both.
pub fn wifi_security(privacy: bool, ies: &[u8]) -> &'static str {
    let mut wpa = false;
    let mut wpa2 = false;
    let mut wpa3 = false;
    let mut owe = false;
    let mut offset = 0;
    while offset + 2 <= ies.len() {
        let id = ies[offset];
        let length = ies[offset + 1] as usize;
        offset += 2;
        if offset + length > ies.len() {
            break;
        }
        let data = &ies[offset..offset + length];
        offset += length;
        if id == 48 {
            let (v2, v3, is_owe) = rsn_akm(data);
            wpa2 |= v2;
            wpa3 |= v3;
            owe |= is_owe;
        } else if id == 221 && is_wpa1(data) {
            wpa = true;
        }
    }
    if owe && !wpa2 && !wpa3 && !wpa {
        return "owe";
    }
    if wpa2 && wpa3 {
        "wpa2-wpa3"
    } else if wpa3 {
        "wpa3"
    } else if wpa2 {
        "wpa2"
    } else if wpa {
        "wpa"
    } else if privacy {
        "wep"
    } else {
        "open"
    }
}

fn rsn_akm(data: &[u8]) -> (bool, bool, bool) {
    if data.len() < 8 {
        return (true, false, false);
    }
    let mut offset = 6;
    if offset + 2 > data.len() {
        return (true, false, false);
    }
    let pairwise = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
    offset += 2 + pairwise * 4;
    if offset + 2 > data.len() {
        return (true, false, false);
    }
    let count = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
    offset += 2;
    let mut wpa2 = false;
    let mut wpa3 = false;
    let mut owe = false;
    for _ in 0..count {
        if offset + 4 > data.len() {
            break;
        }
        match data[offset + 3] {
            8 | 9 | 11 => wpa3 = true,
            18 => owe = true,
            _ => wpa2 = true,
        }
        offset += 4;
    }
    if !wpa2 && !wpa3 && !owe {
        wpa2 = true;
    }
    (wpa2, wpa3, owe && !wpa2 && !wpa3)
}

fn is_wpa1(data: &[u8]) -> bool {
    data.len() >= 4 && data[0] == 0x00 && data[1] == 0x50 && data[2] == 0xf2 && data[3] == 0x01
}

pub fn wifi_generation(ies: &[u8]) -> u8 {
    let mut generation = 0;
    let mut offset = 0;
    while offset + 2 <= ies.len() {
        let id = ies[offset];
        let length = ies[offset + 1] as usize;
        offset += 2;
        if offset + length > ies.len() {
            break;
        }
        let data = &ies[offset..offset + length];
        let candidate = match (id, data.first()) {
            (45, _) => Some(4),
            (191, _) => Some(5),
            (255, Some(35)) => Some(6),
            (255, Some(108)) => Some(7),
            _ => None,
        };
        if let Some(number) = candidate {
            generation = generation.max(number);
        }
        offset += length;
    }
    generation
}

fn band_of(mhz: u16) -> &'static str {
    if (2400..2500).contains(&mhz) {
        "2.4"
    } else if (4900..5900).contains(&mhz) {
        "5"
    } else if (5925..7125).contains(&mhz) {
        "6"
    } else {
        ""
    }
}

/// `{"error":"..."}` from a failed scan. A network list is not an error.
pub fn scan_failure(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    value
        .get("error")
        .and_then(|item| item.as_str())
        .map(str::to_string)
}

fn scan_wifi_dbus() -> Result<String, String> {
    let conn = Connection::system().map_err(|err| err.to_string())?;
    let iface = station_proxy(&conn)?;
    let mut options = HashMap::new();
    options.insert("Type", ZValue::from("active"));
    let started = iface.call::<_, _, ()>("Scan", &(options,)).is_ok();
    // Scan() returns before the radio finishes. Wait so the panel can show
    // the spinner, then read whatever BSSs wpa_supplicant has.
    thread::sleep(if started {
        Duration::from_secs(3)
    } else {
        Duration::from_millis(200)
    });
    let paths: Vec<OwnedObjectPath> = iface.get_property("BSSs").map_err(|err| err.to_string())?;
    let mut hits = Vec::new();
    for path in paths {
        let bss = Proxy::new(&conn, WPA_SERVICE, &path, "fi.w1.wpa_supplicant1.BSS")
            .map_err(|err| err.to_string())?;
        let ssid: Vec<u8> = match bss.get_property("SSID") {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if ssid.is_empty() {
            continue;
        }
        let Ok(ssid) = String::from_utf8(ssid) else {
            continue;
        };
        let signal = bss
            .get_property::<i16>("Signal")
            .map(i32::from)
            .unwrap_or(-100);
        let secure: bool = bss.get_property("Privacy").unwrap_or(true);
        let mhz: u16 = bss.get_property("Frequency").unwrap_or(0);
        let ies: Vec<u8> = bss.get_property("IEs").unwrap_or_default();
        hits.push(ApHit {
            ssid,
            signal,
            security: wifi_security(secure, &ies).to_string(),
            band: band_of(mhz).to_string(),
            generation: wifi_generation(&ies),
        });
    }
    if hits.is_empty() && !started {
        return Err("scan".into());
    }
    Ok(format_scan(&hits, &current_ssid(&conn, &iface)))
}

fn current_ssid(conn: &Connection, iface: &Proxy<'_>) -> String {
    let Ok(state) = iface.get_property::<String>("State") else {
        return String::new();
    };
    if state != "completed" {
        return String::new();
    }
    let Ok(path) = iface.get_property::<OwnedObjectPath>("CurrentBSS") else {
        return String::new();
    };
    if path.as_str() == "/" {
        return String::new();
    }
    let Ok(bss) = Proxy::new(conn, WPA_SERVICE, &path, "fi.w1.wpa_supplicant1.BSS") else {
        return String::new();
    };
    let Ok(bytes) = bss.get_property::<Vec<u8>>("SSID") else {
        return String::new();
    };
    String::from_utf8(bytes).unwrap_or_default()
}

fn station_proxy(conn: &Connection) -> Result<Proxy<'_>, String> {
    let root =
        Proxy::new(conn, WPA_SERVICE, WPA_ROOT, WPA_SERVICE).map_err(|err| err.to_string())?;
    let path: OwnedObjectPath = match root.call("GetInterface", &("wlan0",)) {
        Ok(path) => path,
        Err(_) => {
            let mut options = HashMap::new();
            options.insert("Ifname", ZValue::from("wlan0"));
            root.call("CreateInterface", &(options,))
                .map_err(|err| format!("scan: {err}"))?
        }
    };
    Proxy::new(conn, WPA_SERVICE, path, WPA_INTERFACE).map_err(|err| err.to_string())
}

const WPA_SERVICE: &str = "fi.w1.wpa_supplicant1";
const WPA_ROOT: &str = "/fi/w1/wpa_supplicant1";
const WPA_INTERFACE: &str = "fi.w1.wpa_supplicant1.Interface";

pub fn wifi_connect_body(ssid: &str, password: &str) -> String {
    json!({"ssid": ssid, "password": password}).to_string()
}

pub fn wifi_connect(ssid: &str, password: &str) -> Result<(), String> {
    if ssid.trim().is_empty() {
        return Err("ssid".into());
    }
    connect_wifi_dbus(ssid.trim(), password)
}

fn connect_wifi_dbus(ssid: &str, password: &str) -> Result<(), String> {
    let conn = Connection::system().map_err(|err| err.to_string())?;
    let iface = station_proxy(&conn)?;
    let existing: Vec<OwnedObjectPath> = iface.get_property("Networks").unwrap_or_default();
    for path in existing {
        let _: () = iface
            .call("RemoveNetwork", &(path,))
            .map_err(|err| format!("connect: {err}"))?;
    }
    let mut settings = HashMap::new();
    settings.insert("ssid", ZValue::from(ssid.as_bytes()));
    settings.insert(
        "key_mgmt",
        ZValue::from(if password.is_empty() {
            "NONE"
        } else {
            "WPA-PSK SAE"
        }),
    );
    if !password.is_empty() {
        settings.insert("psk", ZValue::from(password));
        settings.insert("ieee80211w", ZValue::from(1i32));
    }
    let path: OwnedObjectPath = iface
        .call("AddNetwork", &(settings,))
        .map_err(|err| format!("connect: {err}"))?;
    for _ in 0..3 {
        iface
            .call::<_, _, ()>("SelectNetwork", &(path.clone(),))
            .map_err(|_| "wifi".to_string())?;
        if wait_associated(&conn, &iface, ssid, 6) {
            remember_wifi(ssid);
            return Ok(());
        }
    }
    Err("wifi".into())
}

fn wait_associated(conn: &Connection, iface: &Proxy<'_>, ssid: &str, seconds: u64) -> bool {
    for _ in 0..seconds {
        thread::sleep(Duration::from_secs(1));
        let Ok(state) = iface.get_property::<String>("State") else {
            continue;
        };
        if state != "completed" {
            continue;
        }
        let Ok(path) = iface.get_property::<OwnedObjectPath>("CurrentBSS") else {
            continue;
        };
        if path.as_str() == "/" {
            continue;
        }
        let Ok(bss) = Proxy::new(conn, WPA_SERVICE, &path, "fi.w1.wpa_supplicant1.BSS") else {
            continue;
        };
        let Ok(bytes) = bss.get_property::<Vec<u8>>("SSID") else {
            continue;
        };
        if String::from_utf8(bytes).ok().as_deref() == Some(ssid) {
            return true;
        }
    }
    false
}

pub fn nfs_root_cmdline(cmdline: &str) -> bool {
    cmdline
        .split_whitespace()
        .any(|arg| arg == "onekvm.nfsroot=1")
        || cmdline.contains("onekvm.nfsroot=1")
}

pub fn nfs_root() -> bool {
    nfs_root_cmdline(&fs::read_to_string("/proc/cmdline").unwrap_or_default())
}

/// True when first-run auth has already stored an account.
pub fn auth_configured_config(text: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    value
        .pointer("/auth/users")
        .and_then(|users| users.as_array())
        .is_some_and(|users| !users.is_empty())
}

pub fn auth_configured_now() -> bool {
    fs::read_to_string("/etc/onekvm/config.json")
        .map(|text| auth_configured_config(&text))
        .unwrap_or(false)
}

pub fn ipv6_with_prefix(addr: &str, prefix: u64) -> String {
    let prefix = prefix.min(128);
    if addr.contains('/') {
        addr.to_string()
    } else {
        format!("{addr}/{prefix}")
    }
}

/// Write the setup marker only after auth succeeds. HTTP 409 and
/// "already configured" count as success. A short password never writes it.
pub fn commit_auth(
    dir: &std::path::Path,
    password: &str,
    http: Result<(), String>,
) -> Result<(), String> {
    let n = password.chars().count();
    if !(8..=128).contains(&n) {
        return Err("short".into());
    }
    match http {
        Ok(()) => {}
        Err(err) if err.contains("409") || err.contains("already configured") => {}
        Err(err) => return Err(err),
    }
    if crate::shared::write_setup_complete(dir) {
        Ok(())
    } else {
        Err("marker".into())
    }
}

pub fn apply_network(spec: &Value) -> Result<(), String> {
    let cmdline = fs::read_to_string("/proc/cmdline").unwrap_or_default();
    apply_network_with_cmdline(spec, &cmdline)
}

pub fn apply_network_with_cmdline(spec: &Value, cmdline: &str) -> Result<(), String> {
    if nfs_root_cmdline(cmdline) {
        return Err("nfs".into());
    }
    crate::network_config::apply(spec)
}

const AP_IFACE: &str = "ap0";
#[derive(Clone, Debug, PartialEq, Eq)]
struct ApIpv4 {
    dhcp_enabled: bool,
    address: std::net::Ipv4Addr,
    prefix: u8,
    pool_offset: u32,
    pool_size: u32,
}

impl ApIpv4 {
    // Match Core's saved schema. Reject invalid settings rather than resetting its subnet.
    fn from_settings(settings: &Value) -> Result<Self, String> {
        let Some(network) = settings.get("network") else {
            return Ok(Self {
                address: std::net::Ipv4Addr::new(192, 168, 77, 1),
                prefix: 24,
                dhcp_enabled: true,
                pool_offset: 100,
                pool_size: 100,
            });
        };
        let parse = |value: &str| {
            value
                .parse::<std::net::Ipv4Addr>()
                .map_err(|_| "invalid AP IPv4 address".to_string())
        };
        let value = network["address"].as_str().ok_or("missing AP address")?;
        let (host, prefix) = value.split_once('/').ok_or("missing AP prefix")?;
        if prefix.is_empty() || !prefix.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("invalid AP prefix".into());
        }
        let address = parse(host)?;
        let prefix: u8 = prefix.parse().map_err(|_| "invalid AP prefix")?;
        if !(8..=30).contains(&prefix) {
            return Err("invalid AP prefix".into());
        }
        let mask = u32::MAX << (32 - prefix);
        let subnet = u32::from(address) & mask;
        let broadcast = subnet | !mask;
        if !std::net::Ipv4Addr::from(subnet).is_private()
            || !std::net::Ipv4Addr::from(broadcast).is_private()
            || u32::from(address) <= subnet
            || u32::from(address) >= broadcast
        {
            return Err("invalid private AP subnet".into());
        }
        let dhcp_enabled = match network.get("dhcp_enabled") {
            None => true,
            Some(value) => value.as_bool().ok_or("invalid AP DHCP enabled flag")?,
        };
        if !dhcp_enabled {
            return Ok(Self {
                address,
                prefix,
                dhcp_enabled,
                pool_offset: 0,
                pool_size: 0,
            });
        }
        let start = u32::from(parse(
            network["dhcp_start"].as_str().ok_or("missing DHCP start")?,
        )?);
        let end = u32::from(parse(
            network["dhcp_end"].as_str().ok_or("missing DHCP end")?,
        )?);
        if start <= subnet
            || end >= broadcast
            || start > end
            || (start..=end).contains(&u32::from(address))
        {
            return Err("invalid AP DHCP range".into());
        }
        Ok(Self {
            address,
            prefix,
            dhcp_enabled,
            pool_offset: start - subnet,
            pool_size: end - start + 1,
        })
    }

    fn cidr(&self) -> String {
        format!("{}/{}", self.address, self.prefix)
    }
}

fn init_ap_network() -> Result<ApIpv4, String> {
    let settings = match fs::read_to_string(AP_SETTINGS_PATH) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|_| "invalid AP settings")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Null,
        Err(error) => return Err(error.to_string()),
    };
    ApIpv4::from_settings(&settings)
}
/// DHCP option 114 points here. The page it opens is the web UI.
const PORTAL_PORT: u16 = 2080;
const SETUP_HOST: &str = "local-setup.onekvm.org";
const WEB_URL: &str = "http://local-setup.onekvm.org/";
const AP_PASSWORD_PATH: &str = "/data/onekvm/wifi-ap-password";
const AP_SETTINGS_PATH: &str = "/data/onekvm/wifi-ap-settings.json";
const AP_CONFIG_PATH: &str = "/run/onekvm/hostapd.conf";
const AP_NETWORK_PATH: &str = "/run/systemd/network/80-onekvm-ap.network";
const AP_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// Select only a legal channel on this PHY, respecting a saved band/channel.
fn init_ap_channel(settings: &Value, sta: Option<u8>, channels: &[u8]) -> Result<u8, String> {
    let saved = settings.get("channel").and_then(Value::as_u64);
    let band = settings
        .get("band")
        .and_then(Value::as_str)
        .or_else(|| saved.map(|channel| if channel > 14 { "5" } else { "2.4" }));
    if band.is_some_and(|band| band != "2.4" && band != "5") {
        return Err("unsupported AP band".into());
    }
    let allowed: Vec<u8> = channels
        .iter()
        .copied()
        .filter(|channel| band.is_none_or(|band| band == if *channel > 14 { "5" } else { "2.4" }))
        .collect();
    if let Some(channel) = saved.filter(|channel| *channel != 0) {
        return allowed
            .iter()
            .copied()
            .find(|candidate| u64::from(*candidate) == channel)
            .ok_or_else(|| "saved AP channel is unavailable on this radio".into());
    }
    sta.filter(|channel| allowed.contains(channel))
        .or_else(|| allowed.iter().copied().find(|channel| *channel == 6))
        .or_else(|| allowed.first().copied())
        .ok_or_else(|| "no usable AP channels on this radio".into())
}

fn parse_ap_channels(info: &str) -> Vec<u8> {
    let mut channels = Vec::new();
    for line in info.lines() {
        if line.contains("(disabled)")
            || line.contains("(no IR)")
            || line.contains("(radar detection)")
        {
            continue;
        }
        let Some((frequency, rest)) = line
            .trim()
            .strip_prefix("* ")
            .and_then(|line| line.split_once(" MHz ["))
        else {
            continue;
        };
        let Some(mhz) = frequency
            .parse::<f64>()
            .ok()
            .filter(|value| value.fract() == 0.0)
            .map(|value| value as u32)
        else {
            continue;
        };
        let Some(channel) = rest
            .split(']')
            .next()
            .and_then(|value| value.parse::<u8>().ok())
        else {
            continue;
        };
        let valid = ((1..=13).contains(&channel) && mhz == 2407 + 5 * u32::from(channel))
            || ([36, 40, 44, 48, 149, 153, 157, 161, 165, 169, 173, 177].contains(&channel)
                && mhz == 5000 + 5 * u32::from(channel));
        if valid && !channels.contains(&channel) {
            channels.push(channel);
        }
    }
    channels.sort_unstable();
    channels
}

fn detect_ap_channels() -> Result<Vec<u8>, String> {
    let phy = fs::read_link("/sys/class/net/wlan0/phy80211").map_err(|error| error.to_string())?;
    let phy = phy
        .file_name()
        .ok_or("missing wireless PHY")?
        .to_string_lossy();
    Ok(parse_ap_channels(&run_quiet("iw", &["phy", &phy, "info"])?))
}

pub fn init_ap_ssid() -> String {
    fs::read_to_string(AP_SETTINGS_PATH)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("ssid")?
                .as_str()
                .map(str::trim)
                .map(str::to_string)
        })
        .filter(|ssid| !ssid.is_empty() && ssid.len() <= 32 && !ssid.chars().any(char::is_control))
        .unwrap_or_else(|| "OneKVM".to_string())
}

pub fn init_ap_password() -> String {
    fs::read_to_string(AP_PASSWORD_PATH)
        .ok()
        .map(|raw| raw.trim().to_string())
        .filter(|password| {
            (8..=63).contains(&password.len()) && !password.chars().any(char::is_control)
        })
        .unwrap_or_default()
}

fn render_init_ap(ssid: &str, password: &str, channel: u8) -> String {
    let band = if channel > 14 {
        "hw_mode=a\nieee80211n=1\n"
    } else {
        "hw_mode=g\n"
    };
    format!(
        "interface={AP_IFACE}\ndriver=nl80211\nssid={ssid}\n{band}channel={channel}\nwpa=2\nwpa_key_mgmt=WPA-PSK\nrsn_pairwise=CCMP\nwpa_passphrase={password}\nctrl_interface=/run/hostapd\n"
    )
}

fn run_quiet(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "{program}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn hostapd_running() -> bool {
    fs::read_dir("/proc").ok().is_some_and(|entries| {
        entries.flatten().any(|entry| {
            let Ok(command) = fs::read(entry.path().join("cmdline")) else {
                return false;
            };
            let Some(program) = command.split(|byte| *byte == 0).next() else {
                return false;
            };
            std::path::Path::new(std::str::from_utf8(program).unwrap_or(""))
                .file_name()
                .is_some_and(|name| name == "hostapd")
        })
    })
}

fn sta_channel() -> Option<u8> {
    let text = run_quiet("iw", &["dev", "wlan0", "info"]).ok()?;
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("channel ") else {
            continue;
        };
        let mhz: u32 = rest
            .split('(')
            .nth(1)?
            .split_whitespace()
            .next()?
            .parse()
            .ok()?;
        if !(2400..=5895).contains(&mhz) {
            return None;
        }
        return rest.split_whitespace().next()?.parse().ok();
    }
    None
}

fn load_or_create_ap_password() -> Result<String, String> {
    let existing = init_ap_password();
    if !existing.is_empty() {
        return Ok(existing);
    }
    let mut random = [0u8; 12];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut random))
        .map_err(|error| error.to_string())?;
    let password: String = random
        .iter()
        .map(|byte| AP_ALPHABET[(*byte as usize) % AP_ALPHABET.len()] as char)
        .collect();
    let _ = fs::create_dir_all("/data/onekvm");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(AP_PASSWORD_PATH)
        .map_err(|error| error.to_string())?;
    file.write_all(password.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(password)
}

pub fn init_ap_on_air() -> bool {
    fs::metadata(format!("/sys/class/net/{AP_IFACE}")).is_ok() && hostapd_running()
}

fn bring_up_ap(ssid: &str, password: &str, channel: u8) -> Result<(), String> {
    let _ = fs::create_dir_all("/run/onekvm");
    let _ = fs::create_dir_all("/run/systemd/network");
    let network = init_ap_network()?;
    fs::write(AP_NETWORK_PATH, ap_dhcp_network_for(&network)).map_err(|error| error.to_string())?;
    if fs::metadata(format!("/sys/class/net/{AP_IFACE}")).is_err() {
        run_quiet(
            "iw",
            &["dev", "wlan0", "interface", "add", AP_IFACE, "type", "__ap"],
        )?;
    }
    let _ = run_quiet("ip", &["link", "set", AP_IFACE, "up"]);
    let _ = run_quiet("networkctl", &["reload"]);
    let _ = run_quiet("networkctl", &["reconfigure", AP_IFACE]);
    fs::write(AP_CONFIG_PATH, render_init_ap(ssid, password, channel))
        .map_err(|error| error.to_string())?;
    let _ = fs::set_permissions(AP_CONFIG_PATH, fs::Permissions::from_mode(0o600));
    if hostapd_running() {
        let _ = run_quiet("killall", &["hostapd"]);
        thread::sleep(Duration::from_millis(200));
    }
    run_quiet("hostapd", &["-B", AP_CONFIG_PATH])?;
    for _ in 0..25 {
        if hostapd_running() {
            let _ = run_quiet("ip", &["addr", "replace", &network.cidr(), "dev", AP_IFACE]);
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err("hostapd did not stay up".into())
}

/// DHCP for the init AP. Option 114 names the captive API; that API sends clients to the web UI.
fn ap_dhcp_network_for(network: &ApIpv4) -> String {
    let address = network.address;
    let cidr = network.cidr();
    if !network.dhcp_enabled {
        return format!("[Match]\nName={AP_IFACE}\n\n[Network]\nAddress={cidr}\nDHCPServer=no\nIPv6AcceptRA=no\nLinkLocalAddressing=no\n");
    }
    let offset = network.pool_offset;
    let size = network.pool_size;
    format!(
        "[Match]\nName={AP_IFACE}\n\n[Network]\nAddress={cidr}\nDHCPServer=yes\nIPv6AcceptRA=no\nLinkLocalAddressing=no\n\n[DHCPServer]\nPoolOffset={offset}\nPoolSize={size}\nEmitDNS=yes\nDNS={address}\nSendOption=114:string:http://{address}:{PORTAL_PORT}/captive-portal\n"
    )
}

pub fn captive_portal_json() -> String {
    format!(r#"{{"captive":true,"user-portal-url":"{WEB_URL}"}}"#)
}

/// Phones that speak RFC 8908 get the API. Anyone else is sent straight to the web UI.
pub fn captive_http_response(head: &str) -> String {
    let json = head
        .to_ascii_lowercase()
        .contains("application/captive+json");
    if json {
        let body = captive_portal_json();
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/captive+json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
            body.len()
        )
    } else {
        format!("HTTP/1.1 302 Found\r\nLocation: {WEB_URL}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    }
}

fn dns_qname(query: &[u8], at: usize) -> Option<(String, usize)> {
    let mut i = at;
    let mut name = String::new();
    while i < query.len() {
        let len = query[i] as usize;
        if len == 0 {
            return Some((name, i + 1));
        }
        if len > 63 || i + 1 + len > query.len() {
            return None;
        }
        if !name.is_empty() {
            name.push('.');
        }
        name.push_str(&String::from_utf8_lossy(&query[i + 1..i + 1 + len]).to_ascii_lowercase());
        i += 1 + len;
    }
    None
}

/// Public DNS publishes `local-setup.onekvm.org` as 0.0.0.0. This resolver
/// answers that name, and every other A query, with the AP address.
pub fn setup_a_record(name: &str) -> [u8; 4] {
    let _setup = name.trim_end_matches('.').eq_ignore_ascii_case(SETUP_HOST);
    init_ap_network()
        .map(|network| network.address.octets())
        .unwrap_or([192, 168, 77, 1])
}

/// Answer an A query with the AP address. Other types get an empty NOERROR so the client falls back.
pub fn dns_reply(query: &[u8]) -> Option<Vec<u8>> {
    if query.len() < 12 || query.len() > 512 {
        return None;
    }
    if u16::from_be_bytes([query[4], query[5]]) == 0 {
        return None;
    }
    let (name, next) = dns_qname(query, 12)?;
    if next + 4 > query.len() {
        return None;
    }
    let qtype = u16::from_be_bytes([query[next], query[next + 1]]);
    let qclass = u16::from_be_bytes([query[next + 2], query[next + 3]]);
    let mut out = query[..next + 4].to_vec();
    out[2] = 0x84 | (query[2] & 0x01);
    out[3] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 0;
    out[11] = 0;
    if qtype == 1 && qclass == 1 {
        let answer = setup_a_record(&name);
        out[7] = 1;
        out.extend_from_slice(&[
            0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1e, 0x00, 0x04,
        ]);
        out.extend_from_slice(&answer);
    }
    Some(out)
}

fn publish_ap_dhcp() -> Result<(), String> {
    let network = init_ap_network()?;
    let _ = fs::create_dir_all("/run/systemd/network");
    fs::write(AP_NETWORK_PATH, ap_dhcp_network_for(&network)).map_err(|error| error.to_string())?;
    let _ = run_quiet("networkctl", &["reload"]);
    let _ = run_quiet("networkctl", &["reconfigure", AP_IFACE]);
    let _ = run_quiet("ip", &["addr", "replace", &network.cidr(), "dev", AP_IFACE]);
    Ok(())
}

fn serve_portal_dns() -> Result<(), String> {
    let address = init_ap_network()?.address;
    let socket = UdpSocket::bind((address, 53)).map_err(|error| error.to_string())?;
    socket
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    let mut buf = [0u8; 512];
    loop {
        if init_ap_network()?.address != address {
            return Ok(());
        }
        let Ok((n, peer)) = socket.recv_from(&mut buf) else {
            continue;
        };
        if let Some(reply) = dns_reply(&buf[..n]) {
            let _ = socket.send_to(&reply, peer);
        }
    }
}

fn serve_portal_http() -> Result<(), String> {
    let address = init_ap_network()?.address;
    let listener = TcpListener::bind((address, PORTAL_PORT)).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    loop {
        if init_ap_network()?.address != address {
            return Ok(());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(accepted) => accepted,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(error) => return Err(error.to_string()),
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        let mut buf = [0u8; 2048];
        let n = stream.read(&mut buf).unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]);
        let _ = stream.write_all(captive_http_response(&head).as_bytes());
    }
}

fn start_captive_portal() {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    thread::spawn(|| loop {
        if serve_portal_dns().is_err() {
            thread::sleep(Duration::from_secs(2));
        }
    });
    thread::spawn(|| loop {
        if serve_portal_http().is_err() {
            thread::sleep(Duration::from_secs(2));
        }
    });
}

/// Start the OneKVM access point when this board has a Wi-Fi radio.
/// A joined station may supply a legal channel within the saved AP band.
/// Clients are told to open the web UI.
pub fn ensure_init_ap() -> Result<(), String> {
    if !wifi_present() {
        return Ok(());
    }
    if !init_ap_on_air() {
        let channels = detect_ap_channels()?;
        let settings = match fs::read_to_string(AP_SETTINGS_PATH) {
            Ok(raw) => serde_json::from_str(&raw).map_err(|_| "invalid AP settings")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Null,
            Err(error) => return Err(error.to_string()),
        };
        let channel = init_ap_channel(&settings, sta_channel(), &channels)?;
        let password = load_or_create_ap_password()?;
        let ssid = init_ap_ssid();
        // A fixed saved channel must not be silently changed. Auto/default can retry
        // another legal channel in the selected band, without assuming 2.4 GHz.
        if let Err(error) = bring_up_ap(&ssid, &password, channel) {
            let fixed = settings
                .get("channel")
                .and_then(Value::as_u64)
                .is_some_and(|value| value != 0);
            let fallback = channels
                .iter()
                .copied()
                .find(|candidate| *candidate != channel && (*candidate > 14) == (channel > 14));
            if fixed || fallback.is_none() {
                return Err(error);
            }
            let _ = run_quiet("killall", &["hostapd"]);
            thread::sleep(Duration::from_millis(200));
            bring_up_ap(&ssid, &password, fallback.unwrap())?;
        }
    }
    publish_ap_dhcp()?;
    start_captive_portal();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_api_ports_accept_grouped_and_legacy_files() {
        for config in [
            json!({"network":{"http_port":8080,"https_port":8443}}),
            json!({"network":{"http":{"port":8080},"tls":{"port":8443}}}),
            json!({"network":{"http_port":80,"https_port":443,"http":{"port":8080},"tls":{"port":8443}}}),
        ] {
            assert_eq!(configured_api_port(&config, "http"), 8080);
            assert_eq!(configured_api_port(&config, "https"), 8443);
        }
        for config in [
            Value::Null,
            json!({"network":{"http":{"port":0},"tls":{"port":65536}}}),
            json!({"network":{"http":{"port":"8080"},"tls":{"port":-1}}}),
        ] {
            assert_eq!(configured_api_port(&config, "http"), 80);
            assert_eq!(configured_api_port(&config, "https"), 443);
        }
    }

    #[test]
    fn nfs_cmdline_refuses_static_and_vlan() {
        let spec = json!({
            "parent": "eth0",
            "vlan_id": 10,
            "ipv4_mode": "static",
            "ipv4_address": "192.168.1.10/24",
            "ipv4_gateway": "192.168.1.1",
            "ipv6_mode": "static",
            "ipv6_address": "2001:db8::10",
            "ipv6_prefix": 64,
            "ipv6_gateway": "2001:db8::1"
        });
        let err =
            apply_network_with_cmdline(&spec, "root=/dev/nfs onekvm.nfsroot=1 rw").unwrap_err();
        assert_eq!(err, "nfs");
    }

    fn rsn_ie(akms: &[u8]) -> Vec<u8> {
        let count = (akms.len() / 4) as u16;
        let mut data = vec![1, 0, 0x00, 0x0f, 0xac, 4, 1, 0, 0x00, 0x0f, 0xac, 4];
        data.extend_from_slice(&count.to_le_bytes());
        data.extend_from_slice(akms);
        let mut ie = vec![48, data.len() as u8];
        ie.extend(data);
        ie
    }

    #[test]
    fn format_scan_keeps_bands_and_wpa_generation() {
        let wpa2 = rsn_ie(&[0x00, 0x0f, 0xac, 0x02]);
        let both = rsn_ie(&[0x00, 0x0f, 0xac, 0x02, 0x00, 0x0f, 0xac, 0x08]);
        let wpa3 = rsn_ie(&[0x00, 0x0f, 0xac, 0x08]);
        assert_eq!(wifi_security(true, &wpa2), "wpa2");
        assert_eq!(wifi_security(true, &wpa3), "wpa3");
        assert_eq!(wifi_security(true, &both), "wpa2-wpa3");
        assert_eq!(wifi_security(false, &[]), "open");
        assert_eq!(wifi_security(true, &[]), "wep");
        assert_eq!(wifi_generation(&[45, 1, 0, 191, 1, 0, 255, 1, 35]), 6);
        let body = format_scan(
            &[
                ApHit {
                    ssid: "Lab".into(),
                    signal: -70,
                    security: "wpa2".into(),
                    band: "2.4".into(),
                    generation: 4,
                },
                ApHit {
                    ssid: "Lab".into(),
                    signal: -40,
                    security: "wpa3".into(),
                    band: "5".into(),
                    generation: 6,
                },
                ApHit {
                    ssid: "  ".into(),
                    signal: -20,
                    security: "open".into(),
                    band: "".into(),
                    generation: 0,
                },
                ApHit {
                    ssid: "Cafe".into(),
                    signal: -55,
                    security: "open".into(),
                    band: "2.4".into(),
                    generation: 4,
                },
            ],
            "Lab",
        );
        let rows: Vec<Value> = serde_json::from_str(&body).unwrap();
        assert_eq!(rows[0]["ssid"], "Lab");
        assert_eq!(rows[0]["security"], "wpa2-wpa3");
        assert_eq!(rows[0]["generation"], "Wi-Fi 6");
        assert_eq!(rows[0]["bands"], json!(["2.4", "5"]));
        assert_eq!(rows[0]["secure"], true);
        assert_eq!(rows[0]["connected"], true);
        assert_eq!(rows[1]["ssid"], "Cafe");
        assert_eq!(rows[1]["security"], "open");
        assert_eq!(rows[1]["connected"], false);
        assert_eq!(rows.len(), 2);
        assert_eq!(scan_failure(r#"{"error":"scan"}"#).as_deref(), Some("scan"));
        assert_eq!(scan_failure(&body), None);
    }

    #[test]
    fn net_link_kind_keeps_real_nics() {
        assert_eq!(net_link_kind("lo", false, false), None);
        assert_eq!(net_link_kind("ap0", true, true), None);
        assert_eq!(net_link_kind("onekvm-ap0", true, true), Some("ap"));
        assert_eq!(net_link_kind("eth0", false, true), Some("eth"));
        assert_eq!(net_link_kind("wlan0", true, true), Some("wifi"));
        assert_eq!(net_link_kind("docker0", false, false), None);
    }

    #[test]
    fn wifi_connect_body_is_only_ssid_and_password() {
        let body: Value = serde_json::from_str(&wifi_connect_body("hidden net", "secret")).unwrap();
        let obj = body.as_object().unwrap();
        assert_eq!(obj.len(), 2);
        assert_eq!(obj.get("ssid").and_then(|v| v.as_str()), Some("hidden net"));
        assert_eq!(obj.get("password").and_then(|v| v.as_str()), Some("secret"));
    }

    #[test]
    fn ipv6_prefix_is_stored_on_the_address() {
        assert_eq!(ipv6_with_prefix("2001:db8::10", 64), "2001:db8::10/64");
        assert_eq!(ipv6_with_prefix("2001:db8::10/48", 64), "2001:db8::10/48");
        assert_eq!(ipv6_with_prefix("2001:db8::10", 200), "2001:db8::10/128");
    }

    fn marker_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "onekvm-auth-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn marker_ok(dir: &std::path::Path) -> bool {
        fs::read_to_string(dir.join("setup-complete"))
            .map(|text| text.trim() == "ok")
            .unwrap_or(false)
    }

    #[test]
    fn short_password_and_failed_auth_do_not_write_marker() {
        let dir = marker_dir();
        let err = commit_auth(&dir, "short", Ok(())).unwrap_err();
        assert_eq!(err, "short");
        assert!(!marker_ok(&dir));
        let err = commit_auth(&dir, "long-enough", Err("core down".into())).unwrap_err();
        assert_eq!(err, "core down");
        assert!(!marker_ok(&dir));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn captive_portal_respects_disabled_dhcp() {
        let settings = json!({"network": {"address":"10.42.3.129/25", "dhcp_enabled":false, "dhcp_start":"192.168.77.100", "dhcp_end":"192.168.77.199"}});
        let network = ApIpv4::from_settings(&settings).unwrap();
        let unit = ap_dhcp_network_for(&network);
        assert!(unit.contains("Address=10.42.3.129/25\nDHCPServer=no\n"));
        assert!(!unit.contains("[DHCPServer]"));
        assert!(!unit.contains("SendOption"));
        assert!(ApIpv4::from_settings(
            &json!({"network":{"address":"8.8.8.1/24", "dhcp_enabled":false}})
        )
        .is_err());
        assert!(ApIpv4::from_settings(
            &json!({"network":{"address":"10.42.3.129/25", "dhcp_enabled":"false"}})
        )
        .is_err());
    }

    #[test]
    fn captive_dhcp_preserves_configured_subnet() {
        let settings = json!({"network": {"address":"10.42.3.129/25", "dhcp_start":"10.42.3.150", "dhcp_end":"10.42.3.200"}});
        let network = ApIpv4::from_settings(&settings).unwrap();
        let unit = ap_dhcp_network_for(&network);
        assert!(unit.contains("Address=10.42.3.129/25\n"));
        assert!(unit.contains("PoolOffset=22\nPoolSize=51\n"));
        assert!(unit.contains("DNS=10.42.3.129\n"));
        assert!(unit.contains("http://10.42.3.129:2080/captive-portal"));
        let invalid = json!({"network": {"address":"10.42.3.129/25", "dhcp_start":"10.42.3.129", "dhcp_end":"10.42.3.200"}});
        assert!(ApIpv4::from_settings(&invalid).is_err());
        assert!(ApIpv4::from_settings(&json!({"network":{}})).is_err());
    }

    #[test]
    fn captive_portal_opens_the_web_ui() {
        let unit = ap_dhcp_network_for(&ApIpv4::from_settings(&Value::Null).unwrap());
        assert!(unit.contains("EmitDNS=yes\nDNS=192.168.77.1\n"));
        assert!(unit.contains("SendOption=114:string:http://192.168.77.1:2080/captive-portal\n"));
        let api = captive_portal_json();
        assert_eq!(
            api,
            r#"{"captive":true,"user-portal-url":"http://local-setup.onekvm.org/"}"#
        );
        let json = captive_http_response(
            "GET /captive-portal HTTP/1.1\r\nAccept: application/captive+json\r\n\r\n",
        );
        assert!(json.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(json.contains("application/captive+json"));
        assert!(json.contains(r#""user-portal-url":"http://local-setup.onekvm.org/""#));
        let page = captive_http_response("GET / HTTP/1.1\r\nAccept: text/html\r\n\r\n");
        assert!(
            page.starts_with("HTTP/1.1 302 Found\r\nLocation: http://local-setup.onekvm.org/\r\n")
        );
        let query = b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x0blocal-setup\x06onekvm\x03org\x00\x00\x01\x00\x01";
        let (asked, _) = dns_qname(query, 12).unwrap();
        assert_eq!(asked, "local-setup.onekvm.org");
        assert_eq!(setup_a_record(&asked), [192, 168, 77, 1]);
        let reply = dns_reply(query).unwrap();
        assert_eq!(&reply[0..2], &query[0..2]);
        assert_eq!(reply[7], 1);
        assert_eq!(&reply[reply.len() - 4..], &[192, 168, 77, 1]);
        assert_ne!(&reply[reply.len() - 4..], &[0, 0, 0, 0]);
        let aaaa = b"\x00\x01\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x0blocal-setup\x06onekvm\x03org\x00\x00\x1c\x00\x01";
        let empty = dns_reply(aaaa).unwrap();
        assert_eq!(empty[7], 0);
        assert!(!empty.windows(4).any(|b| b == [192, 168, 77, 1]));
    }

    #[test]
    fn ap_uses_only_the_available_band_and_channels() {
        assert_eq!(init_ap_channel(&Value::Null, None, &[1, 3]).unwrap(), 1);
        assert_eq!(
            init_ap_channel(&Value::Null, Some(64), &[36, 40]).unwrap(),
            36
        );
        assert_eq!(
            init_ap_channel(&Value::Null, Some(40), &[36, 40]).unwrap(),
            40
        );
        assert_eq!(init_ap_channel(&Value::Null, None, &[1, 6, 36]).unwrap(), 6);
        assert!(init_ap_channel(&Value::Null, None, &[]).is_err());
        assert!(init_ap_channel(&json!({"channel":6,"band":"2.4"}), None, &[36]).is_err());
        assert_eq!(
            init_ap_channel(&json!({"channel":0,"band":"5"}), Some(6), &[6, 36]).unwrap(),
            36
        );
        assert_eq!(
            init_ap_channel(&json!({"channel":0,"band":"2.4"}), Some(36), &[6, 36]).unwrap(),
            6
        );
        assert_eq!(parse_ap_channels("* 2412 MHz [1] (20 dBm)\n* 2422 MHz [3] (20 dBm)\n* 5180 MHz [36] (20 dBm)\n* 5955 MHz [1] (20 dBm)\n* 5975 MHz [5] (20 dBm)\n* 5260 MHz [52] (radar detection)\n* 2437 MHz [6] (no IR)"), [1, 3, 36]);
        assert!(parse_ap_channels(
            "* 5955 MHz [1] (20 dBm)\n* 2484 MHz [14] (20 dBm)\n* 5260 MHz [52] (20 dBm)"
        )
        .is_empty());
    }

    #[test]
    fn auth_config_is_configured_only_when_users_exist() {
        assert!(!auth_configured_config("{}"));
        assert!(!auth_configured_config(r#"{"auth":{"users":[]}}"#));
        assert!(auth_configured_config(
            r#"{"auth":{"users":[{"username":"admin"}]}}"#
        ));
    }

    #[test]
    fn account_setup_uses_the_selected_username() {
        let body = auth_setup_body("  operator-105  ", "long-enough", "zh", "UTC").unwrap();
        let value: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(value["username"], "operator-105");
        assert_eq!(value["password"], "long-enough");
        assert_eq!(value["system"]["language"], "zh");
        assert_eq!(value["system"]["timezone"], "UTC");
    }

    #[test]
    fn account_setup_rejects_a_missing_or_oversized_username() {
        for username in ["", "  ", &"u".repeat(65)] {
            assert_eq!(auth_setup_body(username, "long-enough", "en", "UTC"), Err("username".into()));
        }
        assert!(auth_setup_body(&"u".repeat(64), "long-enough", "en", "UTC").is_ok());
    }

    #[test]
    fn auth_api_retries_only_startup_failures() {
        for error in [
            "0 connection failed",
            "503 service unavailable",
            "504 gateway timeout",
            "api unreachable",
            "Connection refused (os error 111)",
        ] {
            assert!(api_retryable(error), "{error}");
        }
        for error in [
            "400 invalid request",
            "401 authentication required",
            "409 authentication is already configured",
            "500 save authentication settings",
        ] {
            assert!(!api_retryable(error), "{error}");
        }
    }

    #[test]
    fn success_and_already_configured_write_marker() {
        let dir = marker_dir();
        commit_auth(&dir, "long-enough", Ok(())).unwrap();
        assert!(marker_ok(&dir));
        fs::remove_file(dir.join("setup-complete")).unwrap();
        commit_auth(&dir, "long-enough", Err("409 already configured".into())).unwrap();
        assert!(marker_ok(&dir));
        fs::remove_file(dir.join("setup-complete")).unwrap();
        commit_auth(&dir, "long-enough", Err("already configured".into())).unwrap();
        assert!(marker_ok(&dir));
        let _ = fs::remove_dir_all(dir);
    }
}

fn auth_setup_body(
    username: &str,
    password: &str,
    language: &str,
    timezone: &str,
) -> Result<String, String> {
    let username = username.trim();
    if username.is_empty() || username.len() > 64 {
        return Err("username".into());
    }
    Ok(json!({
        "username": username,
        "password": password,
        "hostname": "onekvm",
        "system": {"language": language, "timezone": timezone, "ntp": true}
    })
    .to_string())
}

pub fn auth_setup(
    username: &str,
    password: &str,
    language: &str,
    timezone: &str,
) -> Result<(), String> {
    let body = auth_setup_body(username, password, language, timezone)?;
    match api("POST", "/api/auth/setup", Some(&body)) {
        Ok(_) => Ok(()),
        Err(err) if err.contains("409") || err.contains("already configured") => Ok(()),
        Err(err) => Err(err),
    }
}

fn api(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    let use_curl = Command::new("curl").arg("--version").output().is_ok();
    let mut last = None;
    // Factory reset starts the framebuffer process and Core as separate
    // systemd units.  Keep the init screen usable during that short startup
    // window, while returning validation errors immediately.
    for delay in [0, 250, 500, 750, 1000, 1500] {
        if delay != 0 {
            thread::sleep(Duration::from_millis(delay));
        }
        let result = if use_curl {
            api_curl(method, path, body)
        } else {
            api_tcp(method, path, body)
        };
        match result {
            Ok(value) => return Ok(value),
            Err(error) if api_retryable(&error) => last = Some(error),
            Err(error) => return Err(error),
        }
    }
    Err(last.unwrap_or_else(|| "api unreachable".into()))
}

fn api_retryable(error: &str) -> bool {
    let code = error.split_whitespace().next().unwrap_or_default();
    matches!(code, "0" | "502" | "503" | "504")
        || error.contains("Connection refused")
        || error.contains("connection refused")
        || error == "api unreachable"
}

fn api_curl(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    for (scheme, insecure) in [("http", false), ("https", true)] {
        let url = format!("{scheme}://127.0.0.1:{}{path}", api_port(scheme));
        let mut cmd = Command::new("curl");
        cmd.args([
            "-sS",
            "--noproxy",
            "*",
            "--max-time",
            "8",
            "-w",
            "\n%{http_code}",
            "-X",
            method,
        ]);
        if insecure {
            cmd.arg("-k");
        }
        if let Some(body) = body {
            cmd.args(["-H", "content-type: application/json", "--data", body]);
        }
        cmd.arg(&url);
        let output = cmd.output().map_err(|err| err.to_string())?;
        let text = String::from_utf8_lossy(&output.stdout);
        let (payload, code) = split_status(&text);
        if code == 0 {
            continue;
        }
        if (200..300).contains(&code) {
            return Ok(payload);
        }
        if code == 404 && scheme == "http" {
            continue;
        }
        return Err(format!("{code} {payload}"));
    }
    Err("api unreachable".into())
}

fn split_status(text: &str) -> (String, u16) {
    let Some((body, code)) = text.rsplit_once('\n') else {
        return (text.to_string(), 0);
    };
    (body.to_string(), code.trim().parse().unwrap_or(0))
}

pub(crate) fn configured_api_port(config: &Value, scheme: &str) -> u16 {
    let path = if scheme == "https" {
        "/network/tls/port"
    } else {
        "/network/http/port"
    };
    config
        .pointer(path)
        .or_else(|| config.get("network")?.get(format!("{scheme}_port")))
        .and_then(Value::as_u64)
        .filter(|port| (1..=65535).contains(port))
        .unwrap_or(if scheme == "https" { 443 } else { 80 }) as u16
}

fn api_port(scheme: &str) -> u16 {
    let config = fs::read("/etc/onekvm/config.json").ok().and_then(|raw| serde_json::from_slice::<Value>(&raw).ok());
    configured_api_port(config.as_ref().unwrap_or(&Value::Null), scheme)
}

fn api_tcp(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    let mut stream = TcpStream::connect_timeout(&format!("127.0.0.1:{}", api_port("http")).parse().expect("loopback address"), Duration::from_secs(3))
        .map_err(|err| { log::warn!("local setup API connection: {err}"); "api unreachable".to_string() })?;
    stream.set_read_timeout(Some(Duration::from_secs(8))).ok();
    let body = body.unwrap_or("");
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|err| { log::warn!("local setup API write: {err}"); "api unreachable".to_string() })?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).map_err(|err| {
        log::warn!("local setup API response: {err}");
        if matches!(err.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) { "api timeout" } else { "api unreachable" }.to_string()
    })?;
    let text = String::from_utf8_lossy(&buf);
    http_result(&text)
}

fn http_result(text: &str) -> Result<String, String> {
    let status = text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    let payload = text
        .split("\r\n\r\n")
        .nth(1)
        .unwrap_or("")
        .trim()
        .to_string();
    if (200..300).contains(&status) {
        Ok(payload)
    } else {
        Err(format!("{status} {payload}"))
    }
}

fn format_v6(hex: &str) -> String {
    let mut groups = Vec::new();
    for i in (0..32).step_by(4) {
        groups.push(u16::from_str_radix(&hex[i..i + 4], 16).unwrap_or(0));
    }
    let mut best = (0, 0);
    let mut run = (0, 0);
    for (i, group) in groups.iter().enumerate() {
        if *group == 0 {
            if run.1 == 0 {
                run.0 = i;
            }
            run.1 += 1;
            if run.1 > best.1 {
                best = run;
            }
        } else {
            run = (0, 0);
        }
    }
    if best.1 < 2 {
        return groups
            .iter()
            .map(|g| format!("{g:x}"))
            .collect::<Vec<_>>()
            .join(":");
    }
    let head = groups[..best.0]
        .iter()
        .map(|g| format!("{g:x}"))
        .collect::<Vec<_>>()
        .join(":");
    let tail = groups[best.0 + best.1..]
        .iter()
        .map(|g| format!("{g:x}"))
        .collect::<Vec<_>>()
        .join(":");
    if head.is_empty() && tail.is_empty() {
        "::".into()
    } else if head.is_empty() {
        format!("::{tail}")
    } else if tail.is_empty() {
        format!("{head}::")
    } else {
        format!("{head}::{tail}")
    }
}
