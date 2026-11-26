import { device } from "../shell/device";
import { registerTexture } from "@pocketjs/framework/vue-vapor";
import type { ScreenApp } from "../shell/types";

/** PocketJS bakes atlas glyphs from source literals. Plugin titles load at runtime. */
export const APP_TITLE_GLYPHS = "SettingsServicesSecurityStreamTouchpadVirtual mediaKeyboard设置服务安全屏幕串流触摸板虚拟媒体键盘設定服務螢幕串流觸控板虛擬媒體鍵盤";

function asApp(value: unknown): ScreenApp | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as {
    id?: unknown;
    title?: unknown;
    icon?: unknown;
    controls?: unknown;
  };
  if (typeof rec.id !== "string" || !rec.id || typeof rec.icon !== "string" || !rec.icon.trim() || "glyph" in rec) return null;
  return {
    id: rec.id,
    title: typeof rec.title === "string" && rec.title ? rec.title : rec.id,
    icon: rec.icon,
    controls: Array.isArray(rec.controls)
      ? rec.controls.filter((mode): mode is string => mode === "touch" || mode === "rotary")
      : [],
  };
}

export function parseRegisteredApps(raw: string): ScreenApp[] {
  // The host refreshes bundle-owned icons before advancing the catalog generation.
  const textures = (globalThis as { ui?: { __textures?: Record<string, number> } }).ui?.__textures;
  if (textures) for (const [key, handle] of Object.entries(textures)) {
    if (key.startsWith("app-icon:") && Number.isInteger(handle) && handle >= 0) registerTexture(key, handle);
  }
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const apps: ScreenApp[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (item && typeof item === "object" && Array.isArray(item.slots) && !item.slots.includes("app")) continue;
      const app = asApp(item);
      if (!app || seen.has(app.id)) continue;
      seen.add(app.id);
      apps.push(app);
    }
    return apps;
  } catch {
    return [];
  }
}

export function registeredApps(): ScreenApp[] {
  return parseRegisteredApps(device()?.get?.("apps") || "");
}

export function launcherApps(all: readonly ScreenApp[]): ScreenApp[] {
  let available: string[] = [];
  try {
    const parsed = JSON.parse(device()?.get?.("controls") || "[]") as unknown;
    if (Array.isArray(parsed)) available = parsed.filter((mode): mode is string => typeof mode === "string");
  } catch {
    /* no controls */
  }
  const supported = all.filter((app) => app.controls.length === 0 || app.controls.some((mode) => available.includes(mode)));
  let ids: string[] = [];
  let hidden: string[] = [];
  let explicit = false;
  try {
    const layout = JSON.parse(device()?.get?.("layout") || "{}") as {
      apps?: unknown;
      apps_hidden?: unknown;
    };
    if (Array.isArray(layout.apps)) {
      explicit = true;
      ids = layout.apps.filter((id): id is string => typeof id === "string");
    }
    if (Array.isArray(layout.apps_hidden)) {
      hidden = layout.apps_hidden.filter((id): id is string => typeof id === "string");
    }
  } catch {
    ids = [];
  }
  if (!explicit && hidden.length === 0) return [...supported];
  const hiddenSet = new Set(hidden);
  const map = new Map(supported.map((app) => [app.id, app]));
  const ordered: ScreenApp[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const app = map.get(id);
    if (!app || hiddenSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(app);
  }
  // Apps installed after the layout was saved still show up, until hidden.
  for (const app of supported) {
    if (seen.has(app.id) || hiddenSet.has(app.id)) continue;
    seen.add(app.id);
    ordered.push(app);
  }
  return ordered;
}
