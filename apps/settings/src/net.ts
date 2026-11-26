import { t, type Lang, type MessageKey } from "./i18n";

/** Keep backend diagnostics in the host log; the panel needs a short action. */
export function networkApplyError(raw: string, lang: Lang): string {
  if (!raw) return "";
  const error = raw.toLowerCase();
  let key: MessageKey = "networkRetry";
  if (error === "nfs") key = "nfs";
  else if (error.includes("ssid")) key = "hotspotNameError";
  else if (error.includes("password")) key = "hotspotPasswordError";
  else if (error.includes("channel") || error.includes("band")) key = "hotspotChannelError";
  else if (error.includes("dhcp")) key = "hotspotDhcpError";
  else if (error.includes("gateway")) key = "networkGatewayError";
  else if (error.includes("dns")) key = "networkDnsError";
  else if (error.includes("vlan")) key = "networkVlanError";
  else if (error.includes("address") || error.includes("prefix")) key = "networkAddressError";
  else if (error.includes("timed out") || error.includes("timeout")) key = "networkTimeout";
  return t(key, {}, lang);
}

export type Nic = { name: string; kind: "eth" | "wifi" | "ap" };
export type Ap = {
  ssid: string;
  secure: boolean;
  connected: boolean;
  generation: string;
  bands: string[];
  security: string;
};

export function parseLinks(raw: string): Nic[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: Nic[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { name?: unknown; kind?: unknown };
      if (typeof rec.name !== "string" || !rec.name) continue;
      if (rec.kind !== "eth" && rec.kind !== "wifi" && rec.kind !== "ap") continue;
      out.push({ name: rec.name, kind: rec.kind });
    }
    return out;
  } catch {
    return [];
  }
}

const SECURITIES = new Set(["open", "wep", "wpa", "wpa2", "wpa3", "wpa2-wpa3", "owe"]);

export function parseAps(raw: string): Ap[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: Ap[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as {
        ssid?: unknown;
        secure?: unknown;
        security?: unknown;
        bands?: unknown;
        generation?: unknown;
        connected?: unknown;
      };
      if (typeof rec.ssid !== "string" || !rec.ssid.trim()) continue;
      const security = typeof rec.security === "string" && SECURITIES.has(rec.security) ? rec.security : "";
      const bands = Array.isArray(rec.bands)
        ? rec.bands.filter((band): band is string => typeof band === "string" && band.length > 0)
        : [];
      const secure = security ? security !== "open" && security !== "owe" : !!rec.secure;
      out.push({
        ssid: rec.ssid,
        secure,
        connected: rec.connected === true,
        generation: typeof rec.generation === "string" ? rec.generation : "",
        bands,
        security,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function securityTag(ap: Ap, lang: Lang): string {
  switch (ap.security) {
    case "open":
      return t("openNet", {}, lang);
    case "owe":
      return "OWE";
    case "wep":
      return "WEP";
    case "wpa":
      return "WPA";
    case "wpa2":
      return "WPA2";
    case "wpa3":
      return "WPA3";
    case "wpa2-wpa3":
      return "WPA2/WPA3";
    default:
      return ap.secure ? "" : t("openNet", {}, lang);
  }
}

export function apTags(ap: Ap, lang: Lang, radioGeneration = ""): string[] {
  const tags: string[] = [];
  if (radioGeneration) tags.push(radioGeneration);
  const bands = [...ap.bands].sort((a, b) => (a === "2.4" ? 0 : a === "5" ? 1 : 2) - (b === "2.4" ? 0 : b === "5" ? 1 : 2));
  for (const band of bands) {
    if (band === "2.4") tags.push("2.4G");
    else if (band === "5") tags.push("5G");
    else if (band === "6") tags.push("6G");
    else if (band) tags.push(band);
  }
  tags.push(ap.connected ? t("wifiOk", {}, lang) : securityTag(ap, lang));
  return tags.filter((tag) => tag !== "");
}

function ipv4Octets(raw: string): number[] | null {
  const parts = raw.trim().split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function maskPrefix(mask: string): number {
  const nums = ipv4Octets(mask);
  if (!nums) return 24;
  const bits = ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
  let prefix = 0;
  let zero = false;
  for (let i = 31; i >= 0; i--) {
    if ((bits >>> i) & 1) {
      if (zero) return 24;
      prefix += 1;
    } else {
      zero = true;
    }
  }
  return prefix;
}

export function wireBody(s: {
  parent: string;
  vlan: string;
  v4: string;
  ip: string;
  mask: string;
  gateway: string;
  v6: string;
  v6addr: string;
  v6prefix: string;
  v6gw: string;
  dns: string;
}): string {
  const vlan = Number(s.vlan);
  const prefix = Number(s.v6prefix);
  const ip = s.ip.trim();
  const address = ipv4Octets(ip) ? `${ip}/${maskPrefix(s.mask)}` : "";
  return JSON.stringify({
    parent: s.parent || "eth0",
    vlan_id: Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094 ? vlan : 0,
    ipv4_mode: s.v4 === "static" ? "static" : "dhcp",
    ipv4_address: address,
    ipv4_gateway: s.gateway.trim(),
    ipv6_mode: s.v6 === "static" ? "static" : "slaac",
    ipv6_address: s.v6addr.trim(),
    ipv6_prefix: Number.isFinite(prefix) ? Math.max(0, Math.min(128, Math.floor(prefix))) : 64,
    ipv6_gateway: s.v6gw.trim(),
    dns: s.dns.trim(),
  });
}

export function blankLabel(seconds: number, lang: Lang): string {
  if (seconds <= 0) return t("never", {}, lang);
  if (seconds === 30) return t("s30", {}, lang);
  if (seconds === 60) return t("m1", {}, lang);
  if (seconds === 300) return t("m5", {}, lang);
  return `${seconds}s`;
}
