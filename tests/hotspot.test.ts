import { describe, expect, test } from "bun:test";
import { hotspotBody, hotspotChannels, hotspotDraft, hotspotRows, parseHotspot } from "../apps/settings/src/hotspot";

const status = {
  available: true, ap_interface: "onekvm-ap0", ap_enabled: true, ap_ssid: "OneKVM",
  ap_band: "2.4", ap_channel: 6, ap_channels: [1, 6, 11, 36],
  ap_network: { address: "192.168.77.1/24", dhcp_enabled: true, dhcp_start: "192.168.77.100", dhcp_end: "192.168.77.199" },
};
describe("hotspot editor", () => {
  test("never imports status credentials or station settings into the draft", () => {
    const parsed = parseHotspot(JSON.stringify({ ...status, ap_password: "secret", station_ssid: "Router" }))!;
    const draft = hotspotDraft(parsed);
    expect(draft.password).toBe("");
    expect(JSON.stringify(parsed)).not.toContain("secret");
    const payload = JSON.parse(hotspotBody(draft));
    expect(payload.action).toBe("ap-config");
    expect(payload.request).not.toHaveProperty("password");
    expect(payload.request).not.toHaveProperty("interface");
    expect(payload.request.network).toEqual(status.ap_network);
    draft.password = "newpassword";
    expect(JSON.parse(hotspotBody(draft)).request.password).toBe("newpassword");
  });
  test("channel choices follow the supported band and DHCP fields follow its switch", () => {
    const parsed = parseHotspot(JSON.stringify(status))!;
    expect(hotspotChannels(parsed, "5")).toEqual([0, 36]);
    expect(hotspotChannels(parsed, "2.4")).toEqual([0, 1, 6, 11]);
    const draft = hotspotDraft(parsed);
    expect(hotspotRows(draft)).toContain("dhcp_start");
    draft.dhcp_enabled = false;
    expect(hotspotRows(draft)).not.toContain("dhcp_start");
    expect(JSON.parse(hotspotBody(draft)).request.network.dhcp_start).toBe(status.ap_network.dhcp_start);
  });
  test("unavailable or malformed status cannot create an editor", () => {
    for (const raw of ["", "null", "[]", "{", '{"available":false}']) expect(parseHotspot(raw)).toBeNull();
  });
});
