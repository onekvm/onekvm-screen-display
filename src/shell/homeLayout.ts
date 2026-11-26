import { createIpRotation } from "../shared/ipRotation";
import { normalizeClockFormat, type ClockFormat } from "../shared/clockFormat";
import { abgrColor } from "../shared/colors";
import { device, screenSize } from "./device";
import { dashboardClock, dashboardWidgets, isDashboardWidget, MAX_HOME_WIDGETS } from "../shared/dashboard";
import { CLOCK_WIDGET_ID, homeLayerOrder } from "../shared/homeLayers";
import {
  builtinHomeWidgetKind,
  homeWidgetSize,
  expandHomeWidgetTemplate,
  homeStatusActive,
  homeStatusStyle,
  homeMetricPercent,
  normalizeHomeWidgetStatus,
  type HomeStatusSource,
  type HomeWidgetKind,
} from "../shared/homeWidgets";

type Mode = "grid" | "free";
type Slot = { id: string; x: number; y: number };
export type Face = {
  id: string; dial: "ticks" | "plain"; background: number;
  modes: Mode[]; columns: number; rows: number; slots: Slot[];
};
export type PlacedWidget = {
  id: string;
  programmed: boolean;
  kind: HomeWidgetKind;
  text: string;
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
  accent: number;
  inactive: number;
  background: number;
  showBackground: boolean;
  showBorder: boolean;
  statusIcon: HomeStatusSource | null;
  statusCount: number | null;
  filled: boolean;
  active: boolean;
  statusImage: boolean;
  mediaSlot: number;
  fontSize: number;
  textAlign: string;
  radius: number;
  progress: number;
};
export type HomeLayout = { face: Face; clock: { x: number; y: number; scale: number }; clockFormat: ClockFormat; clockVisible: boolean; clockLayer: number; widgets: PlacedWidget[] };

const classic: Face = {
  id: "screen-display/classic", dial: "ticks", background: 0xff000000,
  modes: ["grid", "free"], columns: 4, rows: 4,
  slots: [
    { id: "bottom-left", x: 34, y: 88 },
    { id: "bottom-center", x: 50, y: 88 },
    { id: "bottom-right", x: 66, y: 88 },
  ],
};
const minimal: Face = {
  id: "screen-display/minimal", dial: "plain", background: 0xff0c0805,
  modes: ["grid", "free"], columns: 4, rows: 4, slots: [],
};
const dashboard: Face = { ...minimal, id: "screen-display/dashboard" };
const flip: Face = { ...minimal, id: "screen-display/flip" };
const digital: Face = { ...minimal, id: "screen-display/digital" };
const widgetChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.:%+-°/_ ";
const widgetKinds: HomeWidgetKind[] = ["text", "status", "line", "rect", "progress", "media", "external"];
const statusSources: HomeStatusSource[] = ["eth", "hdmi", "hid", "wifi", "live"];
const ipRotation = createIpRotation();
let homeRotationAt = Infinity;

export function homeRefreshAt(): number {
  return homeRotationAt;
}
let cpuSampleAt = 0;
let cpuSample: number | null = null;

function parse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}
function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
const color = abgrColor;

function registry(raw: string): Record<string, unknown>[] {
  const value = parse(raw);
  return Array.isArray(value) ? value.map(obj).filter((entry): entry is Record<string, unknown> => !!entry) : [];
}
function faceFrom(entry: Record<string, unknown>): Face | null {
  const data = obj(entry.data);
  if (typeof entry.id !== "string" || !data) return null;
  const modes = Array.isArray(data.modes)
    ? [...new Set(data.modes.flatMap((mode): Mode[] => mode === "fixed" ? ["free"] : mode === "grid" || mode === "free" ? [mode] : []))]
    : [];
  if (!modes.length) return null;
  const slotNames = new Set<string>();
  const slots = Array.isArray(data.slots) ? data.slots.flatMap((value): Slot[] => {
    const slot = obj(value);
    if (!slot || typeof slot.id !== "string" || !/^[a-z0-9_-]{1,31}$/.test(slot.id) || slotNames.has(slot.id)) return [];
    slotNames.add(slot.id);
    return [{ id: slot.id, x: num(slot.x, 50, 0, 100), y: num(slot.y, 50, 0, 100) }];
  }) : [];
  const grid = obj(data.grid);
  return {
    id: entry.id, dial: data.dial === "plain" ? "plain" : "ticks",
    background: color(data.background, 0xff000000),
    modes,
    columns: Math.floor(num(grid?.columns, 4, 1, 8)), rows: Math.floor(num(grid?.rows, 4, 1, 8)), slots,
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, 64) : fallback;
}

function statusSource(value: unknown): HomeStatusSource {
  return statusSources.includes(value as HomeStatusSource) ? value as HomeStatusSource : "hdmi";
}

function defaultText(kind: HomeWidgetKind, data: Record<string, unknown> | null): string {
  if (kind === "text") return "{ip}";
  if (kind === "status") return "HDMI";
  if (kind === "rect") return "ONEKVM";
  if (kind === "line") return "";
  if (kind === "media") return "";
  return text(data?.preview, text(data?.glyph, "?"));
}

export function readHomeLayout(): HomeLayout {
  const config = obj(parse(device()?.get?.("layout") || "{}")) || {};
  const faceId = typeof config.face === "string" ? config.face : dashboard.id;
  const faces = [dashboard, flip, digital, classic, minimal, ...registry(device()?.get?.("faces") || "[]").flatMap((entry) => {
    const face = faceFrom(entry);
    return face ? [face] : [];
  })];
  const selectedFace = faces.find((item) => item.id === faceId) || classic;
  const face = { ...selectedFace, background: color(config.background, selectedFace.background) };
  const legacyFixed = config.mode === "fixed";
  const mode: Mode = config.mode === "grid" ? "grid" : "free";
  const activeMode = faceId === dashboard.id && config.dashboard_layout !== true ? "free" : face.modes.includes(mode) ? mode : face.modes[0];
  const scr = screenSize();
  const savedClock = faceId === dashboard.id ? obj(config.dashboard_clock) || dashboardClock(scr.w, scr.h) : obj(config.clock);
  const clock = { x: num(savedClock?.x, 50, 0, 100), y: num(savedClock?.y, 50, 0, 100), scale: num(savedClock?.scale, 1, 0.5, 2) };
  const clockVisible = bool(config.clock_enabled, true);
  const catalog = new Map(registry(device()?.get?.("widgets") || "[]").flatMap((entry): [string, Record<string, unknown>][] => {
    const data = obj(entry.data);
    return typeof entry.id === "string" && data ? [[entry.id, data]] : [];
  }));
  const status = ipRotation.update(normalizeHomeWidgetStatus(parse(device()?.get?.("system") || "{}")));
  const programmed = new Set(registry(device()?.get?.("surfaceWidgets") || "[]").map(entry => entry.id));
  // CPU is a trend value. Keep its text and bar on the same five-second
  // sample, while IP, HDMI, USB and session indicators still refresh normally.
  const sampledAt = Date.now();
  if (sampledAt - cpuSampleAt >= 5000 || sampledAt < cpuSampleAt || cpuSampleAt === 0) {
    cpuSampleAt = sampledAt;
    cpuSample = status.cpuPercent;
  }
  const cpuPending = status.cpuPercent !== cpuSample;
  status.cpuPercent = cpuSample;
  let saved = Array.isArray(config.home_widgets) ? config.home_widgets :
    Array.isArray(config.complications) ? config.complications.map((id, index) => ({ id, slot: classic.slots[index % 3].id })) : [];
  const savedPlacements = saved;
  if (faceId === dashboard.id && config.dashboard_layout !== true) saved = [...dashboardWidgets(scr.w, scr.h), ...saved];
  const widgets: PlacedWidget[] = [];
  const rotatingWidgets = new Set<string>();
  const cpuWidgets = new Set<string>();
  const dateWidgets = new Set<string>();
  const occupied = new Set<string>();
  for (const raw of saved) {
    const placement = obj(raw);
    if (!placement || typeof placement.id !== "string") continue;
    if (faceId !== dashboard.id && isDashboardWidget(placement.id)) continue;
    if (placement.hidden === true) continue;
    const source = typeof placement.widget === "string" ? placement.widget : placement.id;
    const builtinKind = builtinHomeWidgetKind(source);
    const data = catalog.get(source) || null;
    if (!builtinKind && !data) continue;
    const kind = widgetKinds.includes(placement.kind as HomeWidgetKind)
      ? placement.kind as HomeWidgetKind
      : builtinKind || "external";
    const allowed = Array.isArray(data?.placement)
      ? data.placement.map((value) => value === "fixed" ? "free" : value)
      : ["grid", "free"];
    if (!allowed.includes(activeMode)) continue;
    let x = 50, y = 88;
    if (activeMode === "grid") {
      const column = Math.floor(num(placement.column, 0, 0, face.columns - 1));
      const row = Math.floor(num(placement.row, 0, 0, face.rows - 1));
      const cell = `${column},${row}`;
      if (occupied.has(cell)) continue;
      occupied.add(cell);
      x = (column + 0.5) / face.columns * 100;
      y = (row + 0.5) / face.rows * 100;
    } else {
      const legacySlot = legacyFixed
        ? face.slots.find((item) => item.id === placement.slot) || face.slots[widgets.length % Math.max(1, face.slots.length)]
        : undefined;
      x = num(placement.x, legacySlot?.x ?? 50, 0, 100);
      y = num(placement.y, legacySlot?.y ?? 88, 0, 100);
    }
    const template = text(placement.text, defaultText(kind, data));
    if (template.includes("{ip}")) rotatingWidgets.add(placement.id);
    if (/\{cpu_(used|free|available|percent|value)\}/.test(template) || (kind === "progress" && (!placement.metric || placement.metric === "cpu"))) cpuWidgets.add(placement.id);
    if (template.includes("{date}")) dateWidgets.add(placement.id);
    const expanded = expandHomeWidgetTemplate(template, status);
    const safeText = [...expanded].slice(0, 24).map((char) => widgetChars.includes(char) ? char : "?").join("");
    const sourceStatus = statusSource(placement.status);
    widgets.push({
      id: placement.id,
      programmed: programmed.has(source),
      mediaSlot: savedPlacements.indexOf(raw),
      kind,
      text: safeText,
      x,
      y,
      scale: num(placement.scale, 1, 0.5, 1.5),
      ...homeWidgetSize(kind, { width: typeof placement.width === "number" ? placement.width : undefined, height: typeof placement.height === "number" ? placement.height : undefined }),
      accent: color(placement.accent, color(data?.accent, 0xffffffff)),
      inactive: color(placement.inactive, 0xff857066),
      background: color(placement.background, 0xff211811),
      showBackground: bool(placement.show_background, kind === "status" || kind === "external"),
      showBorder: bool(placement.show_border, true),
      statusIcon: kind === "status" && homeStatusStyle(placement) === "icon" ? sourceStatus : null,
      statusCount: kind === "status" && homeStatusStyle(placement) === "icon" && sourceStatus === "live" ? status.sessionCount : null,
      filled: bool(placement.filled, kind === "status"),
      statusImage: kind === "status" && homeStatusStyle(placement) === "image" && typeof (homeStatusActive(sourceStatus, status) ? placement.status_active_image : placement.status_inactive_image) === "string" && Boolean(homeStatusActive(sourceStatus, status) ? placement.status_active_image : placement.status_inactive_image),
      active: kind === "status" ? homeStatusActive(sourceStatus, status) : true,
      fontSize: num(placement.font_size, 12, 10, 32),
      textAlign: typeof placement.text_align === "string" ? placement.text_align : "center",
      radius: num(placement.radius, kind === "line" || kind === "progress" ? 2 : kind === "rect" ? 4 : 7, 0, 32),
      progress: kind === "progress" ? Math.round(homeMetricPercent(typeof placement.metric === "string" ? placement.metric : "cpu", status)) : 0,
    });
  }
  const visible = widgets.slice(0, MAX_HOME_WIDGETS);
  homeRotationAt = visible.some(widget => rotatingWidgets.has(widget.id)) ? ipRotation.deadline() : Infinity;
  if (cpuPending && visible.some(widget => cpuWidgets.has(widget.id))) homeRotationAt = Math.min(homeRotationAt, cpuSampleAt + 5000);
  if (visible.some(widget => dateWidgets.has(widget.id))) {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    homeRotationAt = Math.min(homeRotationAt, midnight.getTime());
  }
  const layers = homeLayerOrder(visible.map(widget => widget.id), config.layer_order);
  const depth = new Map(layers.map((id, index) => [id, index]));
  visible.sort((a, b) => depth.get(a.id)! - depth.get(b.id)!);
  return { face, clock, clockFormat: normalizeClockFormat(config.clock_format), clockVisible, clockLayer: layers.indexOf(CLOCK_WIDGET_ID), widgets: visible };
}
