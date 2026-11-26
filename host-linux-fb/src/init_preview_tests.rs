//! Render every first-run setup page, the Settings Wi-Fi connection prompts
//! and the model home layouts to PNG with the host's QuickJS guest, UiSurface
//! layout and RGB565 rasterizer. No framebuffer, D-Bus or network.
//!
//! ```sh
//! make shell-app init-app settings-app fallback-font
//! INIT_PREVIEW_OUT=/tmp/init-preview POCKETJS_DIST=$PWD/dist \
//!     cargo test --manifest-path host-linux-fb/Cargo.toml _preview -- --ignored --nocapture
//! ```
//!
//! `INIT_PREVIEW_PANELS` takes `machine:WxH` items separated by commas, and
//! `INIT_PREVIEW_LANGS` takes `zh`, `zh_tw` and `en`. Files are named
//! `<machine>-<W>x<H>-<lang>-<page>.png`; Settings pages start with `settings-`
//! and model home pages with `home-`. Home panels name a variant as
//! `machine/variant:WxH` and default to `HOME_PANELS`. Sized text, such as the
//! home clock, needs `fallback-font.bin` in `POCKETJS_DIST`.
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use pocket_mod::{qjs::Function, Guest};
use pocket_ui_surface::UiSurface;
use pocketjs_core::{raster, spec::ANALOG_CENTER};

const PANELS: &str = "nanokvm-go:284x240,nanokvm-go:240x284,picokvm:240x240,nanokvm-pro:172x320,nanokvm-pro:320x172";
/// Panels with a model home layout, in the orientation that layout targets.
const HOME_PANELS: &str = "nanokvm-pro/Desk:320x172,nanokvm-go:284x240,picokvm:240x240";
/// Same alphabet and length as the generated setup hotspot password.
const AP_SSID: &str = "OneKVM";
const AP_PASSWORD: &str = "ABCD2345EFGH";

type Keys = Arc<Mutex<BTreeMap<String, String>>>;

struct Sim {
    guest: Guest,
    surface: UiSurface,
    keys: Keys,
    width: usize,
    height: usize,
    seq: u32,
    out: PathBuf,
    prefix: String,
    /// Packed touch contact held down across frames, if any.
    held: Option<u32>,
}

impl Sim {
    fn boot(dist: &Path, machine: &str, width: usize, height: usize, lang: &str, extra: &[(&str, String)], out: &Path) -> anyhow::Result<Self> {
        Self::boot_bundle(dist, "init", false, machine, width, height, lang, extra, out)
    }

    /// `keep_writes` stores the page's own writes, as Settings expects for
    /// one-shot requests such as `settingsPage`.
    #[allow(clippy::too_many_arguments)]
    fn boot_bundle(dist: &Path, bundle: &str, keep_writes: bool, machine: &str, width: usize, height: usize, lang: &str, extra: &[(&str, String)], out: &Path) -> anyhow::Result<Self> {
        let source = std::fs::read_to_string(dist.join(bundle).join("main.vue-vapor.js"))?;
        let pak = std::fs::read(dist.join(bundle).join("main.vue-vapor.pak"))?;
        let mut map = BTreeMap::<String, String>::from_iter([
            ("machine", machine.to_string()),
            ("screenW", width.to_string()),
            ("screenH", height.to_string()),
            ("language", lang.to_string()),
            ("knobOn", "0".into()), ("knob", "0".into()), ("knobClick", "0".into()),
            ("knobHoldN", "0".into()), ("knobSeq", "0".into()),
            ("touchOn", "1".into()),
            // The longest dotted IPv4 form, so clipped addresses show up.
            ("ip", "192.168.100.200".into()),
            ("iface", "eth0".into()),
            ("wifi", "1".into()),
            ("nfs", "0".into()),
            ("links", r#"[{"kind":"eth","name":"eth0"},{"kind":"wifi","name":"wlan0"}]"#.into()),
            ("wifiScan", r#"[{"ssid":"Office","security":"wpa2","bands":["2.4","5"]},{"ssid":"Guest Lounge","security":"open","bands":["2.4"]},{"ssid":"Lab-5G","security":"wpa3","bands":["5"]}]"#.into()),
            ("wifiGeneration", "Wi-Fi 6".into()),
            ("setupBusy", "0".into()),
            ("setupError", "".into()),
            ("adbDebugStatus", r#"{"state":"off"}"#.into()),
            ("startupHealth", "".into()),
        ].map(|(key, value)| (key.to_string(), value)));
        for (key, value) in extra {
            map.insert(key.to_string(), value.clone());
        }
        let keys: Keys = Arc::new(Mutex::new(map));
        let guest = Guest::new()?;
        let surface = UiSurface::new((width as f32, height as f32));
        surface.set_tick_rate(60);
        surface.feed_pak(&pak);
        let get = keys.clone();
        let set = keys.clone();
        let sized = crate::sized_fonts::SizedFonts::new(surface.clone(), crate::sized_fonts::pak_density(&pak));
        guest.mount("onekvm", move |ctx, ns| {
            let sized = std::cell::RefCell::new(sized);
            // The device's sized text bridge; [] without an outline font.
            ns.set("font", Function::new(ctx.clone(), move |px: f64, text: String| -> Vec<f64> {
                sized.borrow_mut().request(px, &text).map_or_else(Vec::new, |(slot, m)| {
                    vec![slot as f64, m.line_height as f64, m.baseline as f64, m.cap_height as f64]
                })
            }))?;
            ns.set("get", Function::new(ctx.clone(), move |key: String| {
                get.lock().unwrap().get(&key).cloned().unwrap_or_default()
            }))?;
            // Writes are requests to the host; Init reads host state only.
            ns.set("set", Function::new(ctx.clone(), move |key: String, value: String| {
                if keep_writes {
                    set.lock().unwrap().insert(key, value);
                }
            }))?;
            Ok(())
        })?;
        surface.mount(&guest)?;
        guest.eval(bundle, &source)?;
        let prefix = format!("{machine}-{width}x{height}-{lang}");
        let mut sim = Self { guest, surface, keys, width, height, seq: 0, out: out.to_path_buf(), prefix, held: None };
        sim.frames(4)?;
        Ok(sim)
    }

    fn set(&self, key: &str, value: &str) {
        self.keys.lock().unwrap().insert(key.into(), value.into());
    }

    fn frames(&mut self, count: usize) -> anyhow::Result<()> {
        for _ in 0..count {
            match self.held {
                Some(contact) => self.guest.frame_with_touches(0, ANALOG_CENTER, &[contact])?,
                None => self.guest.frame(0)?,
            }
            self.surface.tick();
        }
        Ok(())
    }

    /// Finger down at, or moved to, (x, y). It stays down until `lift`.
    fn press(&mut self, x: u32, y: u32, frames: usize) -> anyhow::Result<()> {
        self.held = Some((y << 9) | x);
        self.frames(frames)
    }

    fn lift(&mut self) -> anyhow::Result<()> {
        self.held = None;
        self.frames(4)
    }

    /// One rotary event, read by the page on its next frame.
    fn knob(&mut self, delta: i32, click: bool, hold: bool) -> anyhow::Result<()> {
        self.seq += 1;
        self.set("knob", &delta.to_string());
        self.set("knobClick", if click { "1" } else { "0" });
        self.set("knobHoldN", if hold { "1" } else { "0" });
        self.set("knobSeq", &self.seq.to_string());
        self.frames(1)?;
        self.set("knob", "0");
        self.set("knobClick", "0");
        self.set("knobHoldN", "0");
        self.frames(40)
    }

    fn turn(&mut self, delta: i32) -> anyhow::Result<()> { self.knob(delta, false, false) }
    fn click(&mut self) -> anyhow::Result<()> { self.knob(0, true, false) }

    fn back(&mut self) -> anyhow::Result<()> {
        self.set("back", "1");
        self.frames(1)?;
        self.set("back", "0");
        self.frames(40)
    }

    /// Wait for page logic that follows the wall clock, such as a drawer choice.
    fn wait_ms(&mut self, ms: u64) -> anyhow::Result<()> {
        let until = std::time::Instant::now() + std::time::Duration::from_millis(ms);
        while std::time::Instant::now() < until {
            self.frames(1)?;
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
        self.frames(4)
    }

    fn shot(&mut self, name: &str) -> anyhow::Result<()> {
        // Paint without the rotary cursor: these panels are driven by touch.
        let knob = self.keys.lock().unwrap().get("knobOn").cloned().unwrap_or_default();
        self.set("knobOn", "0");
        // Let row colour transitions settle.
        self.frames(12)?;
        let mut pixels = vec![0u16; self.width * self.height];
        self.surface.with_ui(|ui| {
            let words = ui.draw().words.clone();
            raster::render_scaled_rgb565(ui, &words, &mut pixels, 1);
        });
        self.set("knobOn", &knob);
        let path = self.out.join(format!("{}-{name}.png", self.prefix));
        write_png(&path, self.width, self.height, &pixels)?;
        eprintln!("wrote {}", path.display());
        Ok(())
    }
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// RGB8 PNG with stored (uncompressed) deflate blocks.
fn write_png(path: &Path, width: usize, height: usize, pixels: &[u16]) -> anyhow::Result<()> {
    let mut raw = Vec::with_capacity(height * (width * 3 + 1));
    for row in pixels.chunks_exact(width) {
        raw.push(0);
        for pixel in row {
            let (r, g, b) = ((pixel >> 11) & 0x1f, (pixel >> 5) & 0x3f, pixel & 0x1f);
            raw.extend_from_slice(&[(r << 3 | r >> 2) as u8, (g << 2 | g >> 4) as u8, (b << 3 | b >> 2) as u8]);
        }
    }
    let mut zlib = vec![0x78, 0x01];
    let chunks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (index, block) in chunks.iter().enumerate() {
        zlib.push(u8::from(index + 1 == chunks.len()));
        let len = block.len() as u16;
        zlib.extend_from_slice(&len.to_le_bytes());
        zlib.extend_from_slice(&(!len).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for byte in &raw {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    zlib.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut file = std::io::BufWriter::new(std::fs::File::create(path)?);
    file.write_all(b"\x89PNG\r\n\x1a\n")?;
    let mut chunk = |kind: &[u8], data: &[u8]| -> std::io::Result<()> {
        file.write_all(&(data.len() as u32).to_be_bytes())?;
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        file.write_all(&body)?;
        file.write_all(&crc32(&body).to_be_bytes())
    };
    let mut header = Vec::new();
    header.extend_from_slice(&(width as u32).to_be_bytes());
    header.extend_from_slice(&(height as u32).to_be_bytes());
    header.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &header)?;
    chunk(b"IDAT", &zlib)?;
    chunk(b"IEND", &[])?;
    Ok(())
}

/// Bottom-right letter group (x, y, w, h) of a nine-key board, as pinned by
/// the keyboard geometry checks in src/init/flow.test.ts.
fn last_group(machine: &str, width: usize, height: usize) -> Option<(u32, u32, u32, u32)> {
    match (machine, width, height) {
        ("nanokvm-go", 284, 240) => Some((189, 141, 86, 43)),
        ("nanokvm-go", 240, 284) => Some((159, 167, 71, 52)),
        ("picokvm", 240, 240) => Some((161, 140, 74, 46)),
        _ => None,
    }
}

/// Keyboard board of a machine, from its packaged layout.
fn keyboard_board(machine: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../packaging/onekvm/layouts")
        .join(format!("{machine}.json"));
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|layout| layout["keyboard"].as_str().map(str::to_string))
        .unwrap_or_else(|| "grid".into())
}

const STARTING: &str = r#"{"state":"starting","code":"core-starting"}"#;

fn wifi_setup() -> String {
    let payload = format!("WIFI:T:WPA;S:{AP_SSID};P:{AP_PASSWORD};;");
    let mut value: serde_json::Value = serde_json::from_str(&crate::qr::encode(&payload)).unwrap();
    value["ssid"] = AP_SSID.into();
    value["password"] = AP_PASSWORD.into();
    value.to_string()
}

fn walk(dist: &Path, out: &Path, machine: &str, width: usize, height: usize, lang: &str) -> anyhow::Result<()> {
    let boot = |extra: &[(&str, String)]| Sim::boot(dist, machine, width, height, lang, extra, out);

    // Core still starting or failed. The stored device language is the one
    // under test, as if left over from an earlier setup.
    let mut sim = boot(&[("startupHealth", STARTING.into())])?;
    sim.shot("00-startup-starting")?;
    let mut sim = boot(&[("startupHealth", r#"{"state":"error","code":"core-failed"}"#.into())])?;
    sim.shot("00-startup-error")?;

    let mut sim = boot(&[("ip", String::new())])?;
    sim.shot("01-welcome-no-address")?;

    let mut sim = boot(&[("wifiSetup", wifi_setup())])?;
    sim.shot("02-welcome-hotspot-on")?;
    sim.turn(1)?;
    sim.shot("03-hotspot")?;

    let mut sim = boot(&[])?;
    sim.shot("04-welcome")?;
    sim.click()?;
    sim.shot("05-language")?;
    let row = match lang { "en" => 1, "zh_tw" => 2, _ => 0 };
    sim.turn(row)?;
    sim.click()?;
    sim.shot("06-screen-off")?;
    // After the language step the dialog follows the chosen language.
    sim.set("startupHealth", STARTING);
    sim.frames(8)?;
    sim.shot("06-startup-after-language")?;
    sim.set("startupHealth", r#"{"state":"ready","code":""}"#);
    sim.frames(8)?;
    sim.click()?;
    sim.shot("07-network")?;
    // Wired card: IPv4, IPv6, VLAN, DNS.
    sim.click()?;
    sim.shot("08-wired")?;
    sim.set("knobOn", "1");
    sim.click()?;
    sim.shot("09-ipv4-mode")?;
    sim.turn(1)?;
    sim.click()?;
    sim.wait_ms(400)?;
    sim.turn(1)?;
    sim.click()?;
    sim.set("knobOn", "0");
    sim.shot("10-ipv4-static")?;
    sim.click()?;
    sim.shot("11-keyboard-ipv4")?;
    sim.back()?;
    sim.back()?;
    // IPv6 static address, then the VLAN number. The drawer follows the wall
    // clock and the knob.
    sim.set("knobOn", "1");
    sim.turn(2)?;
    sim.click()?;
    sim.wait_ms(400)?;
    sim.turn(1)?;
    sim.click()?;
    sim.wait_ms(400)?;
    sim.set("knobOn", "0");
    sim.turn(1)?;
    sim.click()?;
    sim.shot("12-keyboard-ipv6")?;
    sim.back()?;
    sim.turn(3)?;
    sim.click()?;
    sim.shot("13-keyboard-number")?;
    sim.back()?;
    sim.back()?;
    // Wireless card, then continue to the account.
    sim.turn(1)?;
    sim.click()?;
    sim.shot("14-wireless")?;
    // The WPA3-only network is the third row.
    sim.turn(2)?;
    sim.click()?;
    sim.shot("14b-wireless-wpa3-only")?;
    sim.back()?;
    sim.back()?;
    sim.turn(2)?;
    sim.click()?;
    sim.shot("15-account")?;
    sim.click()?;
    sim.shot("16-keyboard-text")?;
    if let Some((x, y, w, h)) = last_group(machine, width, height) {
        // Hold the bottom-right group: the chip under the press point is
        // selected, then the nearest chip as the finger moves past either end
        // of the row. Release types it; a knob hold deletes it again.
        let mid = y + h / 2;
        sim.press(x + w / 2, mid, 30)?;
        sim.shot("16b-keyboard-hold")?;
        sim.press(4, mid, 4)?;
        sim.shot("16c-keyboard-hold-first")?;
        sim.press(width as u32 - 4, mid, 4)?;
        sim.shot("16d-keyboard-hold-last")?;
        sim.lift()?;
        sim.knob(0, false, true)?;
    }
    // The mode key sits fourth from the end on both boards. The grid steps to
    // symbols, then capitals; the nine-key board to digits, punctuation, then
    // capitals. Changing mode moves the cursor back to the first key.
    let pages: &[&str] = if keyboard_board(machine) == "nine" {
        &["17-keyboard-symbols", "17b-keyboard-punctuation", "18-keyboard-upper"]
    } else {
        &["17-keyboard-symbols", "18-keyboard-upper"]
    };
    for page in pages {
        sim.turn(100)?;
        sim.turn(-4)?;
        sim.click()?;
        sim.shot(page)?;
    }
    sim.back()?;
    // A password longer than the field, typed on the first key.
    sim.turn(1)?;
    sim.click()?;
    sim.shot("19a-keyboard-password-empty")?;
    for _ in 0..30 {
        sim.click()?;
    }
    sim.shot("19-keyboard-password")?;
    // The show button follows the last key in the rotary order.
    sim.turn(100)?;
    sim.click()?;
    sim.shot("19b-keyboard-password-shown")?;
    sim.back()?;
    sim.turn(2)?;
    sim.click()?;
    sim.shot("20-alert")?;
    sim.click()?;
    sim.set("setupBusy", "1");
    sim.frames(8)?;
    sim.shot("21-busy")?;
    Ok(())
}

/// Settings → Network → Wi-Fi: connect to a protected network, wait, then
/// fail, be refused and succeed. Network names and the password are placeholders.
fn settings_wifi_walk(dist: &Path, out: &Path, machine: &str, width: usize, height: usize, lang: &str) -> anyhow::Result<()> {
    let scan = r#"[{"ssid":"Office","security":"wpa2","bands":["2.4","5"]},{"ssid":"Lobby","security":"open","bands":["2.4"]}]"#;
    let joined = r#"[{"ssid":"Office","security":"wpa2","bands":["2.4","5"],"connected":true},{"ssid":"Lobby","security":"open","bands":["2.4"]}]"#;
    let extra = [
        ("settingsPage", "network".to_string()),
        ("links", r#"[{"kind":"wifi","name":"wlan0"}]"#.to_string()),
        ("wifiScan", scan.to_string()),
        ("rotate", "0".to_string()),
        ("rotations", "[0,180]".to_string()),
    ];
    // The first list row starts 50 px down; rows are 60 px, 4 px apart.
    let row = |index: u32| 80 + index * 64;
    // 32 characters, the longest SSID, for both the station and the hotspot.
    let long = "Conference Room Guest Network 5G";
    let hotspot = format!(r#"{{"available":true,"ap_interface":"onekvm-ap0","ap_enabled":true,"ap_ssid":"{long}","ap_band":"2.4","ap_channel":6,"ap_channels":[1,6,11]}}"#);
    let names = [
        ("settingsPage", "network".to_string()),
        ("links", r#"[{"kind":"eth","name":"eth0"},{"kind":"wifi","name":"wlan0"},{"kind":"ap","name":"onekvm-ap0"}]"#.to_string()),
        ("wifiSsid", long.to_string()),
        ("wifiAp", hotspot),
    ];
    let mut sim = Sim::boot_bundle(dist, "apps/settings", true, machine, width, height, lang, &names, out)?;
    sim.prefix = format!("{}-settings", sim.prefix);
    sim.frames(8)?;
    sim.shot("00-network-long-names")?;
    let connect = |shots: bool| -> anyhow::Result<Sim> {
        let mut sim = Sim::boot_bundle(dist, "apps/settings", true, machine, width, height, lang, &extra, out)?;
        sim.prefix = format!("{}-settings", sim.prefix);
        sim.frames(8)?;
        sim.press(width as u32 / 2, row(0), 3)?;
        sim.lift()?;
        // Opening the page asks the host for a scan; answer it.
        sim.set("wifiScan", scan);
        sim.frames(8)?;
        if shots {
            sim.shot("01-wifi-list")?;
        }
        sim.press(width as u32 / 2, row(0), 3)?;
        sim.lift()?;
        // Five characters on the first key, then Enter. In the rotary order
        // it is followed by X and the show button.
        for _ in 0..5 {
            sim.click()?;
        }
        if shots {
            sim.shot("02-wifi-password")?;
        }
        sim.turn(100)?;
        sim.turn(-2)?;
        sim.set("setupBusy", "1");
        sim.click()?;
        sim.frames(8)?;
        Ok(sim)
    };
    // When the attempt ends the page asks for a new scan; answer it.
    let finish = |sim: &mut Sim, error: &str, list: &str| -> anyhow::Result<()> {
        sim.set("setupError", error);
        sim.set("setupBusy", "0");
        sim.frames(4)?;
        sim.set("wifiScan", list);
        sim.frames(8)
    };
    let mut sim = connect(true)?;
    sim.shot("03-wifi-connecting")?;
    finish(&mut sim, "wifi", scan)?;
    sim.shot("04-wifi-failed")?;
    // Requests Core refuses before it starts connecting.
    for (page, code) in [("b", "wifi-busy"), ("c", "wifi-pending"), ("d", "wifi-ap-only"), ("e", "wifi-core"), ("f", "wifi-password")] {
        let mut sim = connect(false)?;
        finish(&mut sim, code, scan)?;
        sim.shot(&format!("04{page}-{code}"))?;
    }
    let mut sim = connect(false)?;
    finish(&mut sim, "", joined)?;
    sim.shot("05-wifi-connected")?;
    // OK sits at the bottom of the dialog, centred.
    sim.press(width as u32 / 2, (height as u32 + 140) / 2 - 30, 3)?;
    sim.lift()?;
    sim.shot("06-wifi-joined")?;
    // The same dialog after a network change: turn the hotspot off.
    let hotspot = r#"{"available":true,"ap_interface":"onekvm-ap0","ap_enabled":true,"ap_ssid":"OneKVM","ap_band":"2.4","ap_channel":6,"ap_channels":[1,6,11],"ap_network":{"address":"192.168.77.1/24","dhcp_enabled":true,"dhcp_start":"192.168.77.100","dhcp_end":"192.168.77.199"}}"#;
    let extra = [("settingsPage", "hotspot".to_string()), ("wifiAp", hotspot.to_string())];
    let mut sim = Sim::boot_bundle(dist, "apps/settings", true, machine, width, height, lang, &extra, out)?;
    sim.prefix = format!("{}-settings", sim.prefix);
    sim.frames(8)?;
    sim.set("setupBusy", "1");
    sim.press(width as u32 / 2, row(0), 3)?;
    sim.lift()?;
    sim.shot("07-network-applying")?;
    sim.set("setupBusy", "0");
    sim.frames(8)?;
    sim.shot("08-network-applied")?;
    // A WPA3-only network is refused before the password; a WPA2/WPA3 one
    // asks for it.
    let scan = r#"[{"ssid":"Studio","security":"wpa3","bands":["5"]},{"ssid":"Annex","security":"wpa2-wpa3","bands":["5"]}]"#;
    let extra = [("settingsPage", "network".to_string()), ("links", r#"[{"kind":"wifi","name":"wlan0"}]"#.to_string()), ("wifiScan", scan.to_string())];
    let mut sim = Sim::boot_bundle(dist, "apps/settings", true, machine, width, height, lang, &extra, out)?;
    sim.prefix = format!("{}-settings", sim.prefix);
    sim.frames(8)?;
    sim.press(width as u32 / 2, row(0), 3)?;
    sim.lift()?;
    sim.set("wifiScan", scan);
    sim.frames(8)?;
    sim.shot("09-wifi-wpa3-list")?;
    sim.press(width as u32 / 2, row(0), 3)?;
    sim.lift()?;
    sim.frames(4)?;
    sim.shot("10-wifi-wpa3-only")?;
    // OK in the dialog without a title.
    sim.press(width as u32 / 2, (height as u32 + 112) / 2 - 30, 3)?;
    sim.lift()?;
    sim.press(width as u32 / 2, row(1), 3)?;
    sim.lift()?;
    sim.frames(4)?;
    sim.shot("11-wifi-wpa2-wpa3-password")?;
    Ok(())
}

#[test]
#[ignore = "requires make settings-app; writes Settings Wi-Fi previews to INIT_PREVIEW_OUT"]
fn settings_preview() -> anyhow::Result<()> {
    let Some(out) = std::env::var_os("INIT_PREVIEW_OUT").map(PathBuf::from) else {
        anyhow::bail!("set INIT_PREVIEW_OUT to the output directory");
    };
    std::fs::create_dir_all(&out)?;
    let dist = std::env::var_os("POCKETJS_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist"));
    let panels = std::env::var("INIT_PREVIEW_PANELS").unwrap_or_else(|_| PANELS.into());
    let langs = std::env::var("INIT_PREVIEW_LANGS").unwrap_or_else(|_| "zh,en".into());
    for panel in panels.split(',').map(str::trim).filter(|item| !item.is_empty()) {
        let (machine, size) = panel.split_once(':').ok_or_else(|| anyhow::anyhow!("panel {panel}: machine:WxH"))?;
        let (w, h) = size.split_once('x').ok_or_else(|| anyhow::anyhow!("panel {panel}: machine:WxH"))?;
        for lang in langs.split(',').map(str::trim).filter(|item| !item.is_empty()) {
            settings_wifi_walk(&dist, &out, machine, w.parse()?, h.parse()?, lang)?;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires make init-app; writes setup page previews to INIT_PREVIEW_OUT"]
fn init_preview() -> anyhow::Result<()> {
    let Some(out) = std::env::var_os("INIT_PREVIEW_OUT").map(PathBuf::from) else {
        anyhow::bail!("set INIT_PREVIEW_OUT to the output directory");
    };
    std::fs::create_dir_all(&out)?;
    let dist = std::env::var_os("POCKETJS_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist"));
    let panels = std::env::var("INIT_PREVIEW_PANELS").unwrap_or_else(|_| PANELS.into());
    let langs = std::env::var("INIT_PREVIEW_LANGS").unwrap_or_else(|_| "zh,en".into());
    for panel in panels.split(',').map(str::trim).filter(|item| !item.is_empty()) {
        let (machine, size) = panel.split_once(':').ok_or_else(|| anyhow::anyhow!("panel {panel}: machine:WxH"))?;
        let (w, h) = size.split_once('x').ok_or_else(|| anyhow::anyhow!("panel {panel}: machine:WxH"))?;
        for lang in langs.split(',').map(str::trim).filter(|item| !item.is_empty()) {
            walk(&dist, &out, machine, w.parse()?, h.parse()?, lang)?;
        }
    }
    Ok(())
}

/// Live and idle device states for the home preview.
fn home_states() -> [(&'static str, serde_json::Value); 2] {
    [
        ("home-live", serde_json::json!({
            // The longest dotted IPv4 form, so clipped addresses show up.
            "network": {"ip": "192.168.100.200", "hostname": "onekvm-picokvm", "ethernet_connected": true, "wifi_connected": true},
            "video": {"active": true, "hdmi_connected": true, "input_width": 1920, "input_height": 1080, "actual_fps": 60, "session_count": 2},
            "hid": {"connected": true},
            "system": {"cpu_percent": 100},
        })),
        ("home-idle", serde_json::json!({
            "network": {"ip": "", "hostname": "onekvm-picokvm", "ethernet_connected": false, "wifi_connected": false},
            "video": {"active": false, "hdmi_connected": false, "session_count": 0},
            "hid": {"connected": false},
            "system": {"cpu_percent": 3},
        })),
    ]
}

/// The model's default home as the device paints it: home color, cover
/// background, then the Shell through the home compositor.
fn home_walk(dist: &Path, out: &Path, model: &str, width: usize, height: usize, lang: &str) -> anyhow::Result<()> {
    let (machine, variant) = model.split_once('/').map_or((model, None), |(machine, variant)| (machine, Some(variant)));
    let defaults = crate::default_layout::for_machine(&serde_json::json!({"machine": machine, "variant": variant}));
    let Some(layout) = defaults["layout_json"].as_str() else {
        eprintln!("skip {model}: no model home layout");
        return Ok(());
    };
    let background = crate::background::BackgroundImage::parse(defaults["background_image"].as_str().unwrap_or_default())
        .map_err(anyhow::Error::msg)?;
    for (page, system) in home_states() {
        let extra = [
            ("layout", layout.to_string()), ("system", system.to_string()),
            ("apps", "[]".to_string()), ("faces", "[]".to_string()), ("widgets", "[]".to_string()),
            ("surfaceWidgets", "[]".to_string()), ("shellCapturePage", "-1".to_string()),
            ("controls", r#"["touch"]"#.to_string()),
            ("backgroundImage", if background.is_some() { "1" } else { "0" }.to_string()),
        ];
        let mut sim = Sim::boot_bundle(dist, ".", false, machine, width, height, lang, &extra, out)?;
        sim.prefix = format!("{}-{width}x{height}-{lang}", model.replace('/', "-"));
        sim.frames(12)?;
        let mut pixels = vec![0u16; width * height];
        if let Some(image) = &background {
            image.render_cover(&mut pixels, width, height);
        }
        sim.surface.with_ui(|ui| {
            let words = ui.draw().words.clone();
            crate::home_compositor::render(ui, &words, &mut pixels, &mut Default::default(), |_, _| {});
        });
        let path = out.join(format!("{}-{page}.png", sim.prefix));
        write_png(&path, width, height, &pixels)?;
        eprintln!("wrote {}", path.display());
    }
    Ok(())
}

#[test]
#[ignore = "requires make shell-app; writes model home previews to INIT_PREVIEW_OUT"]
fn home_preview() -> anyhow::Result<()> {
    let Some(out) = std::env::var_os("INIT_PREVIEW_OUT").map(PathBuf::from) else {
        anyhow::bail!("set INIT_PREVIEW_OUT to the output directory");
    };
    std::fs::create_dir_all(&out)?;
    let dist = std::env::var_os("POCKETJS_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist"));
    let panels = std::env::var("INIT_PREVIEW_PANELS").unwrap_or_else(|_| HOME_PANELS.into());
    let langs = std::env::var("INIT_PREVIEW_LANGS").unwrap_or_else(|_| "zh,en".into());
    for panel in panels.split(',').map(str::trim).filter(|item| !item.is_empty()) {
        let (model, size) = panel.split_once(':').ok_or_else(|| anyhow::anyhow!("panel {panel}: machine:WxH"))?;
        let (w, h) = size.split_once('x').ok_or_else(|| anyhow::anyhow!("panel {panel}: machine:WxH"))?;
        for lang in langs.split(',').map(str::trim).filter(|item| !item.is_empty()) {
            home_walk(&dist, &out, model, w.parse()?, h.parse()?, lang)?;
        }
    }
    Ok(())
}
