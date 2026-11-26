//! Exercise the compiled Shell in QuickJS, including Vapor's scope ownership.
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use pocket_mod::{
    qjs::{qjs, Function},
    Guest,
};
use pocket_ui_surface::UiSurface;

#[test]
#[ignore = "requires make shell-app; runs the generated Shell in QuickJS"]
fn catalog_rebuilds_release_page_scopes() -> anyhow::Result<()> {
    let (guest, surface, keys) = shell_fixture(r##"{"face":"screen-display/minimal","clock_enabled":false,"home_widgets":[{"id":"label","widget":"screen-display/text","text":"TEST","width":64,"height":24,"x":50,"y":50}]}"##)?;
    let mut warmed = 0;
    for cycle in 0..80 {
        {
            let mut keys = keys.lock().unwrap();
            keys.insert("appsGen".into(), cycle.to_string());
            keys.insert(
                "surfaceHome".into(),
                if cycle % 2 == 0 { "example/home" } else { "" }.into(),
            );
        }
        for _ in 0..3 {
            guest.frame(0)?;
            surface.tick();
            surface.with_ui(|ui| {
                ui.draw();
            });
        }
        let objects = guest.with(|ctx| unsafe {
            let runtime = qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            qjs::JS_RunGC(runtime);
            let mut usage = std::mem::zeroed::<qjs::JSMemoryUsage>();
            qjs::JS_ComputeMemoryUsage(runtime, &mut usage);
            usage.obj_count
        });
        if cycle == 15 {
            warmed = objects;
        }
        if cycle > 15 {
            assert!(objects < warmed * 3 / 2,
                "page objects grew after catalog rebuild {cycle}: warmed={warmed}, current={objects}");
        }
    }
    Ok(())
}

type ShellKeys = Arc<Mutex<BTreeMap<String, String>>>;

#[test]
#[ignore = "manual native/QuickJS memory breakdown"]
fn report_shell_memory_profile() -> anyhow::Result<()> {
    let layout = std::env::var("ONEKVM_PROFILE_LAYOUT").ok().map(std::fs::read_to_string).transpose()?.unwrap_or_else(|| r#"{"face":"screen-display/dashboard","clock_enabled":true,"home_widgets":[]}"#.into());
    let (guest, surface, keys) = shell_fixture(&layout)?;
    if let Ok(path) = std::env::var("ONEKVM_PROFILE_APPS") {
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
        let mut keys = keys.lock().unwrap();
        keys.insert("apps".into(), value["data"][0].as_str().unwrap().into());
        keys.insert("appsGen".into(), "2".into());
    }
    for _ in 0..4 {
        guest.frame(0)?;
        surface.tick();
        surface.with_ui(|ui| { ui.draw(); });
    }
    eprintln!("MEMORY {}", crate::memory_profile::allocations());
    eprintln!("GUEST {}", crate::memory_profile::guest(&guest,&surface,false));
    eprintln!("COLLECTED {}", crate::memory_profile::guest(&guest,&surface,true));
    Ok(())
}

fn shell_fixture(layout: &str) -> anyhow::Result<(Guest, UiSurface, ShellKeys)> {
    let dist = std::env::var_os("POCKETJS_DIST")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist"));
    let source = std::fs::read_to_string(dist.join("main.vue-vapor.js"))?;
    let pak = std::fs::read(dist.join("main.vue-vapor.pak"))?;
    let keys = Arc::new(Mutex::new(BTreeMap::<String, String>::from_iter([
        ("screenW".into(), "320".into()), ("screenH".into(), "172".into()),
        ("apps".into(), "[]".into()), ("faces".into(), "[]".into()),
        ("widgets".into(), "[]".into()), ("surfaceWidgets".into(), "[]".into()),
        ("layout".into(), layout.into()),
        ("shellCapturePage".into(), "-1".into()), ("controls".into(), "[\"touch\",\"rotary\"]".into()),
        ("touchOn".into(), "1".into()),
    ])));
    let guest = Guest::new()?;
    let surface = UiSurface::new((320.0, 172.0));
    surface.register_compositor_surface("screen-display/home");
    surface.feed_pak(&pak);
    let get = keys.clone();
    let set = keys.clone();
    guest.mount("onekvm", move |ctx, ns| {
        ns.set(
            "get",
            Function::new(ctx.clone(), move |key: String| {
                get.lock().unwrap().get(&key).cloned().unwrap_or_default()
            }),
        )?;
        ns.set(
            "set",
            Function::new(ctx.clone(), move |key: String, value: String| {
                set.lock().unwrap().insert(key, value);
            }),
        )?;
        Ok(())
    })?;
    surface.mount(&guest)?;
    guest.eval("shell", &source)?;
    Ok((guest, surface, keys))
}

#[test]
#[ignore = "requires make shell-app; runs the generated Shell in QuickJS"]
fn status_icons_share_and_release_native_textures() -> anyhow::Result<()> {
    let empty = r#"{"face":"screen-display/minimal","clock_enabled":false,"home_widgets":[]}"#;
    let (guest, surface, keys) = shell_fixture(empty)?;
    let live_textures = || surface.with_ui(|ui| {
        (0..ui.texture_slot_count()).filter(|slot| ui.texture_at(*slot as u32).is_some()).count()
    });
    let baseline = live_textures();
    let base_handles = surface.with_ui(|ui| {
        (0..ui.texture_slot_count()).filter_map(|slot| ui.texture_at(slot as u32).map(|(handle, _)| handle)).collect::<Vec<_>>()
    });
    for cycle in 0..40 {
        // Same source/color shares one upload, even across the full layout.
        // Each cycle also replaces the color so old variants cannot accumulate.
        let widgets: Vec<_> = (0..32).map(|id| serde_json::json!({
            "id": format!("icon-{id}"), "widget": "screen-display/status",
            "status": "eth", "status_style": "icon", "width": 28, "height": 28,
            "inactive": format!("#{:06x}", 0x102030 + cycle),
            "show_background": false, "show_border": false,
        })).collect();
        keys.lock().unwrap().insert("layout".into(), serde_json::json!({
            "face": "screen-display/minimal", "clock_enabled": false, "home_widgets": widgets,
        }).to_string());
        keys.lock().unwrap().insert("appsGen".into(), (cycle + 1).to_string());
        for _ in 0..3 {
            guest.frame(0)?;
            surface.tick();
            surface.with_ui(|ui| {
                ui.draw();
            });
        }
        assert_eq!(live_textures(), baseline + 1, "texture variants grew at cycle {cycle}");
        surface.with_ui(|ui| {
            let added: Vec<_> = (0..ui.texture_slot_count()).filter_map(|slot| ui.texture_at(slot as u32))
                .filter(|(handle, _)| !base_handles.contains(handle)).collect();
            assert_eq!(added.len(), 1);
            let texture = added[0].1;
            assert_eq!((texture.w, texture.h), (32, 32));
            let opaque = texture.pixels.chunks_exact(4).find(|pixel| pixel[3] == 255).unwrap();
            assert_eq!(opaque, &[0x10, 0x20, 0x30 + cycle as u8, 255], "status color did not update");
        });
    }
    keys.lock().unwrap().insert("layout".into(), empty.into());
    keys.lock().unwrap().insert("appsGen".into(), "removed".into());
    for _ in 0..3 { guest.frame(0)?; surface.tick(); }
    assert_eq!(live_textures(), baseline, "removed placements retained icon textures");
    Ok(())
}

#[test]
#[ignore = "requires make shell-app; exercises native pager page disposal"]
fn native_pager_releases_hidden_page_objects() -> anyhow::Result<()> {
    let (guest, surface, keys) = shell_fixture(r#"{"face":"screen-display/minimal","clock_enabled":false,"home_widgets":[]}"#)?;
    let apps: Vec<_> = (0..12).map(|i| serde_json::json!({
        "id": format!("test/{i}"), "title": format!("App {i}"),
        "icon": "settings.png", "slots": ["app"], "controls": ["touch", "rotary"],
    })).collect();
    {
        let mut keys = keys.lock().unwrap();
        keys.insert("apps".into(), serde_json::to_string(&apps)?);
        keys.insert("appsGen".into(), "2".into());
    }
    let paint = || -> anyhow::Result<i64> {
        for _ in 0..3 { guest.frame(0)?; surface.tick(); surface.with_ui(|ui| { ui.draw(); }); }
        Ok(guest.with(|ctx| unsafe {
            let runtime = qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            qjs::JS_RunGC(runtime);
            let mut usage = std::mem::zeroed::<qjs::JSMemoryUsage>();
            qjs::JS_ComputeMemoryUsage(runtime, &mut usage);
            usage.obj_count
        }))
    };
    let mut home = paint()?;
    let home_draw = surface.with_ui(|ui| ui.draw().words.clone());
    for cycle in 0..20 {
        keys.lock().unwrap().insert("shellCapturePage".into(), "1".into());
        let list = paint()?;
        assert!(list > home + 1000, "launcher was not mounted: {home} -> {list}");
        keys.lock().unwrap().insert("shellCapturePage".into(), "0".into());
        let restored = paint()?;
        if cycle == 0 { home = restored; }
        assert!(restored < home + 128, "hidden launcher retained objects at {cycle}: {home} -> {restored}");
        assert_eq!(surface.with_ui(|ui| ui.draw().words.clone()), home_draw);
    }
    Ok(())
}

#[test]
#[ignore = "requires make shell-app; verifies live bindings without node replacement"]
fn home_widget_updates_reuse_native_nodes() -> anyhow::Result<()> {
    let layout = |text: &str| serde_json::json!({
        "face":"screen-display/minimal", "clock_enabled":false,
        "home_widgets":[{"id":"label","widget":"screen-display/text","text":text,"width":80,"height":24,"x":50,"y":50}]
    }).to_string();
    let (guest, surface, keys) = shell_fixture(&layout("111"))?;
    for _ in 0..3 { guest.frame(0)?; surface.tick(); }
    let before = surface.with_ui(|ui| ui.draw().words.clone());
    guest.eval("node-counter", "globalThis.created = 0; const create = ui.createNode; ui.createNode = type => { globalThis.created++; return create(type); }; let time = Date.now(); Date.now = () => time += 1100;")?;
    keys.lock().unwrap().insert("layout".into(), layout("222"));
    for _ in 0..3 { guest.frame(0)?; surface.tick(); }
    assert_ne!(surface.with_ui(|ui| ui.draw().words.clone()), before);
    assert_eq!(guest.with(|ctx|ctx.globals().get::<_, i32>("created"))?, 0);
    Ok(())
}
