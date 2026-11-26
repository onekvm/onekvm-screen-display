//! Model defaults are used only before a layout has been saved.
use serde_json::{json, Value};

pub fn settings() -> Value {
    std::fs::read("/usr/share/onekvm/machine.json")
        .ok()
        .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok())
        .map(|machine| for_machine(&machine))
        .unwrap_or_else(|| json!({}))
}

pub(crate) fn for_machine(machine: &Value) -> Value {
    let preset = match (machine["machine"].as_str(), machine["variant"].as_str()) {
        (Some("nanokvm-pro"), Some("Desk")) => include_str!("../../src/shared/default-layouts/nanokvm-pro-desk.json"),
        (Some("nanokvm-go"), _) => include_str!("../../src/shared/default-layouts/nanokvm-go.json"),
        (Some("picokvm"), _) => include_str!("../../src/shared/default-layouts/picokvm.json"),
        _ => return json!({}),
    };
    let layout: Value = serde_json::from_str(preset).unwrap();
    let background: Value = serde_json::from_str(include_str!("../../src/shared/default-background.json")).unwrap();
    let media = json!({"v": 1, "assets": {"screen-default-background": {
        "v": 1, "format": "image", "name": "Apurv Das · Unsplash",
        "width": background["width"], "height": background["height"],
        "frames": [background["pixels"]], "durations": [100]
    }}});
    json!({"layout_json": layout.to_string(), "background_image": background.to_string(), "media_assets": media.to_string()})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_defaults_are_not_applied_to_other_models() {
        for machine in [json!({}), json!({"machine":"nanokvm"}), json!({"machine":"nanokvm-pro","variant":"PCIe"})] {
            assert_eq!(for_machine(&machine), json!({}));
        }
    }

    #[test]
    fn go_layout_omits_ethernet_and_shows_cpu_and_video() {
        let defaults = for_machine(&json!({"machine":"nanokvm-go"}));
        let layout: Value = serde_json::from_str(defaults["layout_json"].as_str().unwrap()).unwrap();
        let widgets = layout["home_widgets"].as_array().unwrap();
        assert_eq!(widgets.len(), 16);
        assert!(widgets.iter().all(|item| item["status"] != "eth"));
        let metrics: Vec<_> = widgets.iter().filter_map(|item| item["metric"].as_str()).collect();
        assert_eq!(metrics, ["cpu"]);
        assert!(widgets.iter().any(|item| item["text"] == "{resolution}"));
        assert_eq!(layout["dashboard_clock"]["scale"], 1.5);
        crate::background::BackgroundImage::parse(defaults["background_image"].as_str().unwrap()).unwrap().unwrap();
    }

    #[test]
    fn picokvm_layout_has_no_wifi_and_puts_ethernet_and_hdmi_on_their_cards() {
        let defaults = for_machine(&json!({"machine":"picokvm"}));
        let layout: Value = serde_json::from_str(defaults["layout_json"].as_str().unwrap()).unwrap();
        let widgets = layout["home_widgets"].as_array().unwrap();
        assert_eq!(widgets.len(), 16);
        assert!(widgets.iter().all(|item| item["status"] != "wifi"));
        let status: Vec<_> = widgets.iter().filter_map(|item| item["status"].as_str()).collect();
        assert_eq!(status, ["hid", "live", "eth", "hdmi"]);
        assert!(widgets.iter().any(|item| item["text"] == "{ip}"));
        assert!(widgets.iter().any(|item| item["text"] == "{resolution}"));
        assert_eq!(layout["dashboard_clock"]["scale"], 1.5);
        assert_eq!(layout["background_asset"], "screen-default-background");
        crate::background::BackgroundImage::parse(defaults["background_image"].as_str().unwrap()).unwrap().unwrap();
    }

    #[test]
    fn desk_layout_has_editable_background_and_live_values() {
        let defaults = for_machine(&json!({"machine":"nanokvm-pro","variant":"Desk"}));
        let layout: Value = serde_json::from_str(defaults["layout_json"].as_str().unwrap()).unwrap();
        let assets: Value = serde_json::from_str(defaults["media_assets"].as_str().unwrap()).unwrap();
        assert_eq!(layout["dashboard_clock"]["scale"], 1.5);
        assert_eq!(layout["clock_format"], "12h");
        assert_eq!(layout["home_widgets"].as_array().unwrap().len(), 15);
        assert!(layout["home_widgets"].as_array().unwrap().iter().any(|item| item["text"] == "{ip}"));
        assert!(assets["assets"].get(layout["background_asset"].as_str().unwrap()).is_some());
        assert_eq!(assets["assets"].as_object().unwrap().len(), 1);
        crate::background::BackgroundImage::parse(defaults["background_image"].as_str().unwrap()).unwrap().unwrap();
    }
}
