export interface Field {
  key: string;
  label: string;
  kind: "boolean" | "number" | "choice" | "text";
  min?: number; max?: number;
  choices?: string[];
}
const bool = (key: string, label: string): Field => ({ key, label, kind: "boolean" });
const num = (key: string, label: string, min: number, max: number): Field => ({ key, label, kind: "number", min, max });
const choice = (key: string, label: string, choices: string[]): Field => ({ key, label, kind: "choice", choices });
const text = (key: string, label: string): Field => ({ key, label, kind: "text" });
const scope = (prefix: string) => [choice(`${prefix}_scope`, "scope", ["ip", "subnet"]), num(`${prefix}_ipv4_prefix`, "ipv4", 1, 32), num(`${prefix}_ipv6_prefix`, "ipv6", 1, 128)];
export const groups = ["login", "api", "proxy", "other", "bans"] as const;
export type Group = typeof groups[number];
export const fields: Record<Exclude<Group, "bans">, Field[]> = {
  login: [bool("login_protection_enabled", "enabled"), bool("login_protection_block_weak_credentials", "weak"),
    num("login_protection_max_failures", "failures", 1, 100), num("login_protection_ban_duration_seconds", "duration", 1, 2592000), ...scope("login_protection")],
  api: [bool("api_protection_enabled", "enabled"), num("api_protection_max_failures", "paths", 1, 100),
    num("api_protection_window_seconds", "window", 1, 3600), num("api_protection_ban_duration_seconds", "duration", 1, 2592000),
    ...scope("api_protection"), num("api_protection_requests_per_second", "rate", 1, 1000), num("api_protection_burst", "burst", 1, 1000)],
  proxy: [bool("reverse_proxy.enabled", "enabled"), text("reverse_proxy.trusted_proxies", "trusted"),
    text("reverse_proxy.client_ip_header", "header"), bool("reverse_proxy.require_https", "https"), text("reverse_proxy.public_origin", "origin"),
    bool("reverse_proxy.security_headers_enabled", "headers"), choice("reverse_proxy.frame_options", "frame", ["off", "sameorigin", "deny"]),
    choice("reverse_proxy.referrer_policy", "referrer", ["strict-origin-when-cross-origin", "same-origin", "no-referrer"]),
    bool("reverse_proxy.hsts_enabled", "hsts"), num("reverse_proxy.hsts_max_age_seconds", "hstsAge", 0, 63072000), bool("reverse_proxy.hsts_include_subdomains", "subdomains")],
  other: [bool("server_disguise_enabled", "disguise"), bool("honeypot_enabled", "honeypot"), bool("crash_recovery_enabled", "recovery")],
};
export const banFields = [text("address", "address"), text("reason", "reason"), num("duration", "duration", 0, 2592000)];
export interface Ban { id: string; address: string; source: string; reason: string; expires_at: number | null }
export interface Snapshot { settings: Record<string, unknown>; bans: Ban[]; honeypot: { enabled: boolean; mysql?: { listening: boolean }; redis?: { listening: boolean } } }
export function parseSnapshot(value: unknown): Snapshot {
  const data = value as Snapshot;
  if (!data || !data.settings || typeof data.settings !== "object" || !Array.isArray(data.bans)) throw new Error("invalid security snapshot");
  for (const group of Object.values(fields)) for (const field of group) {
    const value = readField(data.settings, field.key);
    if (field.kind === "boolean" ? typeof value !== "boolean" : field.kind === "number" ? typeof value !== "number" :
      field.key.endsWith("trusted_proxies") ? !Array.isArray(value) : typeof value !== "string") throw new Error("invalid security field");
  }
  return { settings: data.settings, bans: data.bans.filter(ban => typeof ban.id === "string" && typeof ban.address === "string"), honeypot: data.honeypot || { enabled: false } };
}
export function readField(settings: Record<string, unknown>, key: string): unknown {
  const [parent, child] = key.split(".");
  return child ? (settings[parent] as Record<string, unknown> | undefined)?.[child] : settings[parent];
}
export function fieldText(value: unknown): string { return Array.isArray(value) ? value.join(",") : String(value ?? ""); }
export function fieldValue(field: Field, value: string): unknown {
  if (field.kind === "number") {
    const number = /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || number < field.min! || number > field.max!) throw new Error("invalid number");
    return number;
  }
  if (field.kind === "boolean") return value === "true";
  if (field.key.endsWith("trusted_proxies")) return value.split(/[,\s]+/).filter(Boolean);
  return value.trim();
}
export function patchField(field: Field, value: string): Record<string, unknown> {
  const [parent, child] = field.key.split(".");
  return { [parent]: child ? { [child]: fieldValue(field, value) } : fieldValue(field, value) };
}
export function activeBans(bans: Ban[], now = Date.now() / 1000): Ban[] { return bans.filter(ban => !ban.expires_at || ban.expires_at > now); }
