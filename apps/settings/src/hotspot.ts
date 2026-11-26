export type HotspotStatus = {
  available: boolean;
  ap_interface: string;
  ap_enabled: boolean;
  ap_ssid: string;
  ap_band: "2.4" | "5";
  ap_channel: number;
  ap_channels: number[];
  ap_network: { address: string; dhcp_enabled: boolean; dhcp_start: string; dhcp_end: string };
};

export type HotspotDraft = {
  ssid: string;
  password: string;
  band: "2.4" | "5";
  channel: number;
  address: string;
  dhcp_enabled: boolean;
  dhcp_start: string;
  dhcp_end: string;
};
export type HotspotField = keyof HotspotDraft;
export type HotspotRow = "enabled" | HotspotField | "apply";

export function parseHotspot(raw: string): HotspotStatus | null {
  try {
    const s = JSON.parse(raw);
    if (s?.available !== true || typeof s.ap_interface !== "string" || !s.ap_interface
      || typeof s.ap_ssid !== "string" || !s.ap_network || typeof s.ap_network.address !== "string"
      || !["2.4", "5"].includes(s.ap_band) || !Array.isArray(s.ap_channels)) return null;
    return {
      available: true, ap_interface: s.ap_interface, ap_enabled: s.ap_enabled === true,
      ap_ssid: s.ap_ssid, ap_band: s.ap_band, ap_channel: Number(s.ap_channel) || 0,
      ap_channels: s.ap_channels.filter((c: unknown) => typeof c === "number" && Number.isInteger(c) && c > 0),
      ap_network: {
        address: s.ap_network.address, dhcp_enabled: s.ap_network.dhcp_enabled === true,
        dhcp_start: String(s.ap_network.dhcp_start || ""), dhcp_end: String(s.ap_network.dhcp_end || ""),
      },
    };
  } catch { return null; }
}

export function hotspotDraft(status: HotspotStatus): HotspotDraft {
  return {
    ssid: status.ap_ssid, password: "", band: status.ap_band, channel: status.ap_channel,
    ...status.ap_network,
  };
}

export function hotspotRows(draft: HotspotDraft | null): HotspotRow[] {
  if (!draft) return [];
  return ["enabled", "ssid", "password", "band", "channel", "address", "dhcp_enabled",
    ...(draft.dhcp_enabled ? ["dhcp_start", "dhcp_end"] as const : []), "apply"];
}

export function hotspotChannels(status: HotspotStatus | null, band: string): number[] {
  return [0, ...(status?.ap_channels || []).filter(c => band === "5" ? c > 14 : c <= 14)];
}

export function hotspotBody(draft: HotspotDraft): string {
  return JSON.stringify({ action: "ap-config", request: {
    ssid: draft.ssid, ...(draft.password ? { password: draft.password } : {}),
    band: draft.band, channel: draft.channel,
    network: { address: draft.address.trim(), dhcp_enabled: draft.dhcp_enabled,
      dhcp_start: draft.dhcp_start.trim(), dhcp_end: draft.dhcp_end.trim() },
  } });
}
