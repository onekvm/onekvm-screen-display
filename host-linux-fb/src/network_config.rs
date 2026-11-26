//! The physical panel uses Core's privileged local management bus. Network
//! edits must be committed together, then confirmed after Core applies them.
use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub fn apply(spec: &Value) -> Result<(), String> {
    crate::bus::with_core(
        "org.onekvm.Core1.Management",
        "/org/onekvm/Core1/Management",
        |proxy| {
            let raw: String = proxy.call("GetConfig", &())?;
            let current: Value = serde_json::from_str(&raw)?;
            let next = candidate(current.clone(), spec).map_err(anyhow::Error::msg)?;
            if next["network"] == current["network"] {
                return Ok(());
            }
            proxy.call::<_, _, ()>("CommitConfig", &(next.to_string(),))?;
            wait_for_apply(
                || {
                    let raw: String = proxy
                        .call("GetNetworkApplyStatus", &())
                        .map_err(|error| error.to_string())?;
                    serde_json::from_str(&raw).map_err(|error| error.to_string())
                },
                Duration::from_secs(30),
            )
            .map_err(anyhow::Error::msg)?;
            proxy.call::<_, _, ()>("ConfirmNetworkApply", &())?;
            Ok(())
        },
    )
    .map_err(|error| {
        log::warn!("screen network apply: {error:#}");
        error.to_string()
    })
}

fn wait_for_apply(
    mut status: impl FnMut() -> Result<Value, String>,
    timeout: Duration,
) -> Result<(), String> {
    let started = Instant::now();
    loop {
        let status = status()?;
        if status["pending"].as_bool() != Some(true) {
            return Err("network configuration was not applied".into());
        }
        if status["ready"].as_bool() == Some(true) {
            return Ok(());
        }
        if started.elapsed() >= timeout {
            return Err("network configuration apply timed out".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn candidate(mut config: Value, spec: &Value) -> Result<Value, String> {
    let parent = spec["parent"]
        .as_str()
        .filter(|name| !name.is_empty())
        .unwrap_or("eth0");
    let vlan = spec.get("vlan_id").and_then(Value::as_i64).unwrap_or(0);
    if !(0..=4094).contains(&vlan) {
        return Err("vlan".into());
    }
    let network = config
        .get_mut("network")
        .filter(|value| value.is_object())
        .ok_or("network configuration is unavailable")?;
    let primary = vlan == 0 && network["device"].as_str() == Some(parent);
    let target = if primary {
        &mut *network
    } else {
        let name = if vlan > 0 {
            format!("vlan{vlan}")
        } else {
            parent.to_string()
        };
        let interfaces = network
            .as_object_mut()
            .unwrap()
            .entry("interfaces")
            .or_insert(json!([]))
            .as_array_mut()
            .ok_or("invalid interface configuration")?;
        let index = match interfaces
            .iter()
            .position(|item| item["name"].as_str() == Some(&name))
        {
            Some(index) => index,
            None => {
                interfaces.push(if vlan > 0 {
                    json!({"name": name, "kind": "vlan", "parent": parent, "vlan_id": vlan})
                } else {
                    json!({"name": name, "kind": "physical"})
                });
                interfaces.len() - 1
            }
        };
        let target = &mut interfaces[index];
        if vlan > 0
            && (target["kind"] != "vlan" || target["parent"] != parent || target["vlan_id"] != vlan)
        {
            return Err("vlan".into());
        }
        target
    };
    let mode = spec["ipv4_mode"].as_str().unwrap_or("dhcp");
    if !matches!(mode, "dhcp" | "dhcp-static" | "static") {
        return Err("address".into());
    }
    target["ipv4_mode"] = json!(mode);
    if mode == "static" || mode == "dhcp-static" {
        target["ipv4_address"] = json!(spec["ipv4_address"].as_str().unwrap_or(""));
        target["ipv4_gateway"] = json!(spec["ipv4_gateway"].as_str().unwrap_or(""));
    }
    let mode = spec["ipv6_mode"].as_str().unwrap_or("slaac");
    if !matches!(mode, "slaac" | "dhcp" | "static" | "disabled") {
        return Err("address".into());
    }
    target["ipv6_mode"] = json!(mode);
    if primary {
        target["ipv6_enabled"] = json!(mode != "disabled");
    }
    if mode == "static" {
        let address = spec["ipv6_address"].as_str().unwrap_or("");
        let prefix = spec["ipv6_prefix"].as_u64().unwrap_or(64);
        if prefix > 128 {
            return Err("prefix".into());
        }
        target["ipv6_address"] = json!(if address.contains('/') {
            address.to_string()
        } else {
            format!("{address}/{prefix}")
        });
        target["ipv6_gateway"] = json!(spec["ipv6_gateway"].as_str().unwrap_or(""));
    }
    if let Some(dns) = spec["dns"].as_str().filter(|value| !value.is_empty()) {
        network["dns"] = json!([dns]);
        network["use_custom_dns"] = json!(true);
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Value {
        json!({"network": {"device":"eth0", "ipv4_mode":"dhcp", "ipv4_address":"", "ipv4_gateway":"", "ipv6_mode":"slaac", "ipv6_enabled":true, "interfaces":[{"name":"wlan0", "kind":"physical", "ipv4_mode":"dhcp", "ipv6_mode":"slaac", "route_metric":200}], "wifi":{"station":{"ssid":"keep"}}, "https_port":443}, "ssh":{"authorized_keys":["keep"]}, "auth":{"users":[]}})
    }

    #[test]
    fn stages_all_fields_together_and_preserves_unrelated_settings() {
        let before = config();
        let next = candidate(before.clone(), &json!({"parent":"eth0", "ipv4_mode":"static", "ipv4_address":"192.0.2.105/24", "ipv4_gateway":"192.0.2.1", "ipv6_mode":"static", "ipv6_address":"2001:db8::105", "ipv6_prefix":64, "ipv6_gateway":"2001:db8::1", "dns":"192.0.2.53"})).unwrap();
        assert_eq!(next["network"]["ipv4_address"], "192.0.2.105/24");
        assert_eq!(next["network"]["ipv4_gateway"], "192.0.2.1");
        assert_eq!(next["network"]["ipv6_address"], "2001:db8::105/64");
        assert_eq!(next["network"]["dns"], json!(["192.0.2.53"]));
        for key in ["interfaces", "wifi", "https_port"] {
            assert_eq!(next["network"][key], before["network"][key]);
        }
        assert_eq!(next["ssh"], before["ssh"]);
        assert_eq!(next["auth"], before["auth"]);
    }

    #[test]
    fn unchanged_settings_remain_a_noop() {
        assert_eq!(
            candidate(
                config(),
                &json!({"parent":"eth0", "ipv4_mode":"dhcp", "ipv6_mode":"slaac"})
            )
            .unwrap(),
            config()
        );
    }

    #[test]
    fn vlan_edits_are_idempotent_and_preserve_the_parent() {
        let spec = json!({"parent":"eth0", "vlan_id":42, "ipv4_mode":"static", "ipv4_address":"192.0.2.105/24", "ipv6_mode":"slaac"});
        let next = candidate(config(), &spec).unwrap();
        assert_eq!(next["network"]["ipv4_mode"], "dhcp");
        assert_eq!(next["network"]["interfaces"][1]["name"], "vlan42");
        assert_eq!(next["network"]["interfaces"][1]["parent"], "eth0");
        assert_eq!(candidate(next.clone(), &spec).unwrap(), next);
    }

    #[test]
    fn secondary_interface_keeps_primary_and_other_interface_options() {
        let next = candidate(config(), &json!({"parent":"wlan0", "ipv4_mode":"static", "ipv4_address":"192.0.2.15/24", "ipv6_mode":"slaac"})).unwrap();
        assert_eq!(next["network"]["device"], "eth0");
        assert_eq!(next["network"]["ipv4_mode"], "dhcp");
        assert_eq!(
            next["network"]["interfaces"][0]["ipv4_address"],
            "192.0.2.15/24"
        );
        assert_eq!(next["network"]["interfaces"][0]["route_metric"], 200);
    }

    #[test]
    fn rejects_invalid_vlan_and_preserves_the_input_configuration() {
        let original = config();
        assert_eq!(
            candidate(original.clone(), &json!({"vlan_id":4095})),
            Err("vlan".into())
        );
        assert_eq!(original, config());
    }

    #[test]
    fn waits_for_ready_before_confirmation() {
        let mut calls = 0;
        wait_for_apply(
            || {
                calls += 1;
                Ok(json!({"pending":true, "ready":calls == 2}))
            },
            Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(calls, 2);
    }

    #[test]
    fn failure_timeout_and_bus_errors_are_not_reported_as_success() {
        assert!(wait_for_apply(|| Ok(json!({"pending":false})), Duration::ZERO).is_err());
        assert!(wait_for_apply(
            || Ok(json!({"pending":true, "ready":false})),
            Duration::ZERO
        )
        .unwrap_err()
        .contains("timed out"));
        assert_eq!(
            wait_for_apply(|| Err("bus unavailable".into()), Duration::ZERO),
            Err("bus unavailable".into())
        );
    }
}
