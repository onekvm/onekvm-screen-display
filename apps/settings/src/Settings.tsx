import { shallowRef } from "vue";
import { AppTitle } from "../../../packages/screen-ui/src";
import { Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { aboutHeight, AboutPage, connectionLabel, type SystemState } from "./About";
import { AppBar } from "./AppBar";
import { BrightnessRow } from "./BrightnessRow";
import { device, requestPageTransition, requestScrollTransition, screenSize, setHot } from "./device";
import { readLang, t, type Lang } from "./i18n";
import { OptionDrawer, OptionRow } from "./Options";
import { TIMEZONES, timezoneLabel } from "./timezones";
import { COLOR, FONT } from "./ui";
import { drawerRow, knobRow, ListRow, pinRow, rowArmed } from "../../../src/shell/ListRow";
import { LIST_ROW_H } from "../../../src/shell/listMetrics";
import { INPUT_HOLD_FRAMES } from "../../../src/shell/motion";
import Keyboard from "../../../src/shell/Keyboard";
import { FeedbackModal } from "../../../src/shell/FeedbackModal";
import { applyToken, layoutKeys, moveFocus, nextKeyMode, type KeyKind } from "../../../src/shell/keypad";
import { apTags, blankLabel, isWifiJoinError, networkApplyError, parseAps, parseLinks, wifiJoinError, wireBody, type Ap, type Nic } from "./net";
import { SETTINGS_ASSETS } from "./assets";
import { settleTouchScroll } from "../../../src/shared/touchScroll";
import { RecoveryDebug } from "./RecoveryDebug";
import { useRecoveryDebug } from "./useRecoveryDebug";
import { RecoveryConfirm } from "./RecoveryConfirm";
import { useRecoveryConfirmation } from "./useRecoveryConfirmation";
import { RECOVERY_ACTIONS, type RecoveryAction } from "./recoveryConfirmation";
import { useAppLock } from "./useAppLock";
import { AppLockPanel } from "./AppLockPanel";
import { parseRotations } from "../../../src/shared/rotation";
import { HotspotSettings, hotspotLabel } from "./HotspotSettings";
import { useHotspot } from "./useHotspot";
import { hotspotBody, hotspotChannels, hotspotRows, type HotspotField, type HotspotRow } from "./hotspot";
import { appLayoutUpdate, managedApps, type AppAction, type ListedApp } from "./appManagement";

type Page = "home" | "screen" | "network" | "wifi" | "hotspot" | "link" | "v4" | "display" | "region" | "timezone" | "about" | "restore" | "lock";
type AppView = "icons" | "list";
type Rotate = 0 | 90 | 180 | 270;
type Drawer = "rotate" | "view" | "app" | "language" | "blank" | "v4" | "v6" | "lockTimeout" | "apBand" | "apChannel" | null;
type KbKind = "" | KeyKind;
type KbTarget = "" | "blank" | "wifi" | "v4ip" | "v4mask" | "v4gw" | "dns" | "v6addr" | "v6pre" | "v6gw" | "vlan" | "ssid" | "password" | "address" | "dhcp_start" | "dhcp_end";
type DrawerKind = Exclude<Drawer, null>;

const VIEW_H = 176;
const HOME_VIEW = 220;
const HOME_H = 476;
const LIST_W = 200;
const ROW_H = LIST_ROW_H;
const TZ_ROW = LIST_ROW_H;
const TZ_TOP = 12;
const TZ_H = 28 + TZ_TOP + TIMEZONES.length * TZ_ROW + Math.max(0, TIMEZONES.length - 1) * 4;
// Section title (28), spacer (8), and three list gaps (4 each).
const APP_LIST_GAP = 48;
const APP_BAR_H = 22;
// Keep the cursor colour settling in the same window as the host-composited
// list scroll. A longer guest-side hold makes a short rotary move feel slow.
const HIGHLIGHT_FRAMES = INPUT_HOLD_FRAMES;

function readView(): AppView {
  return device()?.get?.("appView") === "icons" ? "icons" : "list";
}

function readLauncherApps(): ListedApp[] {
  return managedApps(device()?.get?.("apps") || "[]", device()?.get?.("layout") || "{}");
}

function readBrightness(): number {
  const n = Number(device()?.get?.("brightness") || "100");
  if (!Number.isFinite(n)) return 100;
  return Math.max(5, Math.min(100, Math.round(n)));
}

function readRotate(): Rotate {
  const n = Number(device()?.get?.("rotate") || "0");
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

function readTimezone(): string {
  return device()?.get?.("timezone") || "UTC";
}

function readBlank(): number {
  const n = Number(device()?.get?.("blankSeconds") || "0");
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(86400, Math.floor(n));
}

function readSystem(): SystemState {
  const raw = device()?.get?.("system") || "";
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SystemState;
  } catch {
    return {};
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function hhmm(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function Label(props: { text: string }) {
  return (
    <Text class="text-xs text-zinc-400" style={{ fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>
      {props.text}
    </Text>
  );
}

function Value(props: { text: string }) {
  return (
    <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
      {props.text}
    </Text>
  );
}

function Spec(props: { label: string; value: string }) {
  return (
    <View class="w-full flex flex-row items-center justify-between px-1" style={{ height: 28 }}>
      <Label text={props.label} />
      <Value text={props.value} />
    </View>
  );
}

function pageTitle(page: Page, lang: Lang): string {
  if (page === "screen") return t("screen", {}, lang);
  if (page === "network" || page === "wifi") return t("network", {}, lang);
  if (page === "hotspot") return t("hotspot", {}, lang);
  if (page === "v4") return t("v4settings", {}, lang);
  if (page === "display") return t("appView", {}, lang);
  if (page === "region") return t("regionTime", {}, lang);
  if (page === "timezone") return t("timezone", {}, lang);
  if (page === "about") return t("about", {}, lang);
  if (page === "restore") return t("restore", {}, lang);
  if (page === "lock") return t("appLock", {}, lang);
  return t("settings", {}, lang);
}

function rotateLabel(deg: Rotate, lang: Lang): string {
  if (deg === 90) return t("rotate90", {}, lang);
  if (deg === 180) return t("rotate180", {}, lang);
  if (deg === 270) return t("rotate270", {}, lang);
  return t("rotate0", {}, lang);
}

function viewLabel(view: AppView, lang: Lang): string {
  return view === "list" ? t("viewList", {}, lang) : t("viewIcons", {}, lang);
}

function langLabel(lang: Lang): string {
  if (lang === "zh") return t("langZh", {}, lang);
  if (lang === "zh_tw") return t("langZhTw", {}, lang);
  return t("langEn", {}, lang);
}

function viewH(_page: Page): number {
  const h = screenSize().h;
  return Math.max(80, h - APP_BAR_H);
}

function contentH(page: Page, appCount = 0, withBack = false, rows = 0): number {
  let h = VIEW_H;
  if (page === "home") h = HOME_H;
  else if (page === "about") h = 28 + aboutHeight();
  else if (page === "timezone") h = TZ_H;
  else if (page === "display") h = 28 + ROW_H + APP_LIST_GAP - 4 + appCount * (ROW_H + 4);
  else if (page === "restore") h = 28 + 5 * (ROW_H + 4);
  else if (page === "screen" || page === "lock") h = 28 + 3 * (ROW_H + 4);
  else if (page === "network" || page === "wifi" || page === "hotspot" || page === "link" || page === "v4") h = 28 + Math.max(1, rows) * (ROW_H + 4);
  if (withBack) h += ROW_H + 8;
  return h;
}

export default function Settings() {
  const appLock = useAppLock();
  const recovery = useRecoveryConfirmation();
  const debug = useRecoveryDebug();
  let systemCapabilities: Partial<Record<RecoveryAction, boolean>> = {};
  try { systemCapabilities = JSON.parse(device()?.get?.("systemCapabilities") || "{}"); } catch { /* disabled on older hosts */ }
  const openRecovery = (action: RecoveryAction) => {
    if (systemCapabilities[action]) recovery.open(action);
  };
  const page = shallowRef<Page>("home");
  const appView = shallowRef<AppView>(readView());
  const launcherApps = shallowRef<ListedApp[]>(readLauncherApps());
  const appId = shallowRef("");
  const appsGen = shallowRef(device()?.get?.("appsGen") || "");
  const brightness = shallowRef(readBrightness());
  const rotate = shallowRef<Rotate>(readRotate());
  const rotationAngles = parseRotations(device()?.get?.("rotations"));
  const lang = shallowRef<Lang>(readLang());
  const timezone = shallowRef(readTimezone());
  const blank = shallowRef(readBlank());
  const links = shallowRef<Nic[]>(parseLinks(device()?.get?.("links") || "[]"));
  const hotspot = useHotspot();
  const aps = shallowRef<Ap[]>([]);
  const wifiSsid = shallowRef(device()?.get?.("wifiSsid") || "");
  const wifiGeneration = shallowRef(device()?.get?.("wifiGeneration") || "");
  const ip = shallowRef(device()?.get?.("ip") || "");
  const nicName = shallowRef("");
  const v4mode = shallowRef<"dhcp" | "static">("dhcp");
  const v4ip = shallowRef("");
  const v4mask = shallowRef("255.255.255.0");
  const v4gw = shallowRef("");
  const v6mode = shallowRef<"slaac" | "static">("slaac");
  const v6addr = shallowRef("");
  const v6pre = shallowRef("64");
  const v6gw = shallowRef("");
  const dns = shallowRef("");
  const vlan = shallowRef("");
  const netError = shallowRef("");
  // "notice" reports a network that is not tried at all; it only closes.
  const netState = shallowRef<"idle" | "applying" | "applied" | "failed" | "notice">("idle");
  const netDialogFocus = shallowRef(0);
  let netStartedAt = 0;
  let netSawBusy = false;
  let lastNetworkApply: { key: string; body: string } | null = null;
  // The open dialog reports either a network apply or a Wi-Fi connection.
  const netKind = shallowRef<"network" | "wifi">("network");
  const joining = shallowRef<{ ssid: string; secure: boolean } | null>(null);
  let joinPassword = "";
  const scanBusy = shallowRef(false);
  const kb = shallowRef<KbKind>("");
  const kbValue = shallowRef("");
  const kbFocus = shallowRef(0);
  const kbRotaryFocus = shallowRef(true);
  const kbMode = shallowRef(0);
  const kbTarget = shallowRef<KbTarget>("");
  const kbSsid = shallowRef("");
  const kbReveal = shallowRef(false);
  const drawer = shallowRef<Drawer>(null);
  const shownDrawer = shallowRef<DrawerKind>("rotate");
  const focus = shallowRef(0);
  const cursor = shallowRef(0);
  const editing = shallowRef(false);
  const time = shallowRef(hhmm());
  const system = shallowRef<SystemState>(readSystem());
  let list: NodeMirror | null = null;
  let scrollY = 0;
  let gestureScrollY = 0;
  let lastPage: Page = "home";
  let tick = 0;
  let knobSeq = "0";
  let seenDrawer: Drawer = null;
  let slideFrames = 0;
  let linksRaw = "";
  let scanRaw = "";

  // Rotary presence is a capability, not the last input method used. Desk
  // devices need a focusable Back row even while touch navigation is enabled.
  const hasRotary = shallowRef(device()?.get?.("knobOn") === "1");

  const holdFrames = (frames = HIGHLIGHT_FRAMES) => {
    slideFrames = Math.max(slideFrames, frames);
    setHot(true);
  };

  const navigate = (next: Page, dir: 1 | -1) => {
    if (netState.value !== "idle") return;
    if (next === page.value) return;
    page.value = next;
    requestPageTransition(dir);
  };

  const networkLinks = (): Nic[] => {
    const ap = hotspot.status.value;
    const rows = links.value.map(link => ap && link.name === ap.ap_interface ? { ...link, kind: "ap" as const } : link);
    if (ap && !rows.some(link => link.name === ap.ap_interface)) rows.push({ name: ap.ap_interface, kind: "ap" });
    return rows;
  };

  const openNetwork = (link: Nic) => {
    nicName.value = link.name;
    if (link.kind === "ap") {
      navigate("hotspot", 1);
    } else {
      if (link.kind === "eth" && !v4ip.value && ip.value) v4ip.value = ip.value;
      navigate(link.kind === "wifi" ? "wifi" : "link", 1);
    }
  };

  const wirePlan = (): string[] => {
    const rows = ["v4"];
    if (v4mode.value === "static") rows.push("v4set");
    rows.push("v6");
    if (v6mode.value === "static") rows.push("v6addr", "v6pre", "v6gw");
    rows.push("vlan");
    if (v4mode.value !== "static") rows.push("dns");
    rows.push("apply");
    return rows;
  };

  const wireTitle = (id: string) => {
    if (id === "v4") return "IPv4";
    if (id === "v4set") return t("v4settings", {}, lang.value);
    if (id === "v6") return "IPv6";
    if (id === "v6addr") return t("address", {}, lang.value);
    if (id === "v6pre") return t("prefix", {}, lang.value);
    if (id === "v6gw") return t("gateway", {}, lang.value);
    if (id === "vlan") return "VLAN";
    if (id === "dns") return t("dns", {}, lang.value);
    return t("apply", {}, lang.value);
  };

  const wireValue = (id: string) => {
    if (id === "v4") return v4mode.value === "static" ? t("staticAddr", {}, lang.value) : t("dhcp", {}, lang.value);
    if (id === "v4set") return v4ip.value;
    if (id === "v6") return v6mode.value === "static" ? t("staticAddr", {}, lang.value) : t("slaac", {}, lang.value);
    if (id === "v6addr") return v6addr.value;
    if (id === "v6pre") return v6pre.value;
    if (id === "v6gw") return v6gw.value;
    if (id === "vlan") return vlan.value;
    if (id === "dns") return dns.value;
    return "";
  };

  const openField = (id: string) => {
    if (netState.value !== "idle") return;
    netError.value = "";
    if (netState.value !== "applying") netState.value = "idle";
    if (id === "v4ip") openKb("ipv4", "v4ip", v4ip.value);
    else if (id === "v4mask") openKb("ipv4", "v4mask", v4mask.value);
    else if (id === "v4gw") openKb("ipv4", "v4gw", v4gw.value);
    else if (id === "dns") openKb("ipv4", "dns", dns.value);
    else if (id === "v6addr") openKb("ipv6", "v6addr", v6addr.value);
    else if (id === "v6pre") openKb("number", "v6pre", v6pre.value);
    else if (id === "v6gw") openKb("ipv6", "v6gw", v6gw.value);
    else if (id === "vlan") openKb("number", "vlan", vlan.value);
  };

  const submitNetwork = (key: string, body: string, kind: "network" | "wifi" = "network") => {
    if (netState.value === "applying") return;
    lastNetworkApply = { key, body };
    netKind.value = kind;
    netDialogFocus.value = 0;
    if (kind === "network" && device()?.get?.("nfs") === "1") {
      netError.value = t("nfs", {}, lang.value);
      netState.value = "failed";
      setHot(true);
      return;
    }
    netError.value = "";
    netState.value = "applying";
    netStartedAt = Date.now();
    netSawBusy = false;
    device()?.set?.(key, body);
    setHot(true);
  };

  const joinAp = (ap: Ap) => {
    if (netState.value !== "idle") return;
    if (ap.security === "wpa3") {
      // Core joins protected networks over WPA-PSK, which SAE-only networks refuse.
      netKind.value = "wifi";
      netDialogFocus.value = 0;
      netError.value = t("wifiWpa3Only", {}, lang.value);
      netState.value = "notice";
      setHot(true);
    } else if (ap.secure) openKb("text", "wifi", ap.ssid);
    else connectWifi(ap.ssid, "", false);
  };

  const connectWifi = (ssid: string, password: string, secure: boolean) => {
    joining.value = { ssid, secure };
    joinPassword = password;
    submitNetwork("wifiConnect", JSON.stringify({ ssid, password }), "wifi");
  };

  const retryNetwork = () => {
    const join = joining.value;
    if (netKind.value === "wifi" && join?.secure) {
      // Show the password again so it can be checked before reconnecting.
      const password = joinPassword;
      dismissNetwork();
      openKb("text", "wifi", join.ssid);
      kbValue.value = password;
      return;
    }
    if (lastNetworkApply) submitNetwork(lastNetworkApply.key, lastNetworkApply.body, netKind.value);
  };

  const applyWire = () => {
    submitNetwork("netApply",
      wireBody({
        parent: nicName.value,
        vlan: vlan.value,
        v4: v4mode.value,
        ip: v4ip.value,
        mask: v4mask.value,
        gateway: v4gw.value,
        v6: v6mode.value,
        v6addr: v6addr.value,
        v6prefix: v6pre.value,
        v6gw: v6gw.value,
        dns: dns.value,
      }),
    );
    setHot(true);
  };

  const openHotspot = (row: HotspotRow) => {
    if (netState.value !== "idle" || !hotspot.draft.value) return;
    const draft = hotspot.draft.value;
    if (row === "enabled") submitNetwork("wifiApApply", JSON.stringify({ action: "ap", request: { enabled: !hotspot.status.value?.ap_enabled } }));
    else if (row === "apply") submitNetwork("wifiApApply", hotspotBody(draft));
    else if (row === "dhcp_enabled") hotspot.edit(row, !draft.dhcp_enabled);
    else if (row === "band") showDrawer("apBand");
    else if (row === "channel") showDrawer("apChannel");
    else openKb(row === "ssid" || row === "password" ? "text" : "ipv4", row, draft[row]);
  };

  const dismissNetwork = () => {
    if (netState.value === "applying") return;
    netState.value = "idle";
    netError.value = "";
    if (netKind.value === "wifi") {
      lastNetworkApply = null;
      joining.value = null;
      joinPassword = "";
    }
    setHot(true);
  };

  const openWire = (id: string) => {
    if (netState.value !== "idle") return;
    if (id !== "apply") {
      netState.value = "idle";
      netError.value = "";
    }
    if (id === "v4") showDrawer("v4");
    else if (id === "v6") showDrawer("v6");
    else if (id === "v4set") {
      navigate("v4", 1);
    } else if (id === "apply") applyWire();
    else openField(id);
  };

  const dataRows = (shownPage = page.value): number => {
    if (shownPage === "network") return Math.max(1, networkLinks().length);
    if (shownPage === "hotspot") return Math.max(1, hotspotRows(hotspot.draft.value).length);
    if (shownPage === "wifi") return Math.max(1, aps.value.length);
    if (shownPage === "link") return wirePlan().length;
    if (shownPage === "v4") return 4;
    return 0;
  };

  const itemCount = (shownPage = page.value) => {
    let n = 0;
    if (shownPage === "home") n = 7;
    else if (shownPage === "restore") n = 5;
    else if (shownPage === "screen" || shownPage === "lock") n = 3;
    else if (shownPage === "region") n = 2;
    else if (shownPage === "display") n = 1 + launcherApps.value.length;
    else if (dataRows(shownPage)) n = dataRows(shownPage);
    else if (shownPage === "timezone") n = TIMEZONES.length;
    if (hasRotary.value) n += 1;
    return n;
  };

  const drawerIds = (): string[] => {
    if (drawer.value === "apBand") return ["2.4", "5"].filter(band => hotspotChannels(hotspot.status.value, band).length > 1);
    if (drawer.value === "apChannel") return hotspotChannels(hotspot.status.value, hotspot.draft.value?.band || "2.4").map(String);
    if (drawer.value === "view") return ["icons", "list"];
    if (drawer.value === "app") return appOptions().map(option => option.id);
    if (drawer.value === "language") return ["en", "zh", "zh_tw"];
    if (drawer.value === "blank") return ["0", "30", "60", "300", "custom"];
    if (drawer.value === "lockTimeout") return ["15", "30", "60", "120", "300", "600"];
    if (drawer.value === "v4") return ["dhcp", "static"];
    if (drawer.value === "v6") return ["slaac", "static"];
    if (drawer.value === "rotate") return rotationAngles.map(String);
    return [];
  };

  const glideY = (fromY = scrollY) => {
    // Let the host slide a cached complete list. A positive direction means
    // content moves up (the user revealed rows below the viewport).
    // The node mirror is not guaranteed to be available on the first input
    // frame after a page replacement. The guest state still needs to commit;
    // the host can cache the settled frame on the next paint even without the
    // mirror, so do not make the transition request conditional on `list`.
    if (list) jump(list, "translateY", scrollY);
    const direction: 1 | -1 = scrollY < fromY ? 1 : -1;
    const size = screenSize();
    // The cached compositor needs the actual displacement, not a full-page
    // slide: reveal() commonly moves by only one row.
    requestScrollTransition(direction, Math.abs(scrollY - fromY), {
      y: APP_BAR_H,
      height: Math.max(0, size.h - APP_BAR_H),
    }, list?.parent ? {
      node: list.id, parent: list.parent.id, offset: -scrollY,
      height: -minY() + viewH(page.value),
    } : undefined);
    // The native host is already awake for the rotary event and owns the
    // cached scroll animation. Do not keep the expensive guest frame loop hot
    // after handing it the settled list layer.
  };

  const scrollBy = (step: number) => {
    const previous = scrollY;
    scrollY = Math.max(minY(), Math.min(0, scrollY - step * 48));
    glideY(previous);
  };

  const reveal = (index: number) => {
    const title = page.value === "home" ? 32 : 28;
    const row = page.value === "timezone" && index < TIMEZONES.length ? TZ_ROW : ROW_H;
    const top = page.value === "display" && index > 0
      ? index > launcherApps.value.length
        ? contentH("display", launcherApps.value.length) + 8
        : title + ROW_H + APP_LIST_GAP + (index - 1) * (ROW_H + 4)
      : page.value === "timezone" && index >= TIMEZONES.length
      ? TZ_H + 8
      : title + (page.value === "timezone" ? TZ_TOP : 0) + index * (row + 4);
    const bottom = top + row;
    const view = viewH(page.value);
    let y = -scrollY;
    if (top < y) y = top;
    else if (bottom > y + view - 8) y = bottom - (view - 8);
    const next = Math.max(minY(), Math.min(0, -y));
    const previous = scrollY;
    scrollY = next;
    // Zero-distance requests fade the selection using the same cached layer.
    glideY(previous);
  };

  const minY = () =>
    Math.min(
      0,
      viewH(page.value) -
        contentH(
          page.value,
          launcherApps.value.length,
          hasRotary.value,
          dataRows(),
        ),
    );

  const bindPage = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (node == null) list = null;
      return;
    }
    const previous = list;
    list = node;
    if (previous?.id === node.id) return;
    jump(node, "translateY", scrollY);
  };

  const syncPage = () => {
    if (page.value === lastPage) return;
    lastPage = page.value;
    editing.value = false;
    focus.value =
      page.value === "timezone"
        ? Math.max(0, TIMEZONES.findIndex((zone) => zone.id === timezone.value))
        : 0;
    scrollY = 0;
    if (list) jump(list, "translateY", 0);
    if (page.value === "screen") brightness.value = readBrightness();
    if (page.value === "about" || page.value === "network" || page.value === "link") system.value = readSystem();
    if (page.value === "wifi") device()?.set?.("wifiScan", "1");
    if (page.value === "network") device()?.set?.("wifiApRefresh", "1");
    if (page.value === "hotspot") hotspot.open();
  };

  onFrame(() => {
    debug.sync();
    hasRotary.value = device()?.get?.("knobOn") === "1";
    if (slideFrames > 0) slideFrames -= 1;
    // The password keyboard used to stay hot the whole time it was open, so
    // every tick redrew the settings tree and pushed a full SPI frame.
    setHot(debug.busy() || slideFrames > 0 || page.value === "about" || netState.value === "applying" || (!!recovery.action.value && !recovery.status.value) || (!!appLock.step.value && (appLock.busy.value || appLock.wait.value > 0)));
    if (netState.value === "applying") {
      const busy = device()?.get?.("setupBusy") === "1";
      if (busy) netSawBusy = true;
      else if (netSawBusy || Date.now() - netStartedAt >= 800) {
        const error = device()?.get?.("setupError") || "";
        netState.value = error ? "failed" : "applied";
        const join = joining.value;
        netError.value = netKind.value === "wifi" ? wifiJoinError(error, !!join?.secure, lang.value) : networkApplyError(error, lang.value);
        if (!error && netKind.value === "wifi" && join) {
          aps.value = aps.value.map((ap) => ({ ...ap, connected: ap.ssid === join.ssid }));
          joinPassword = "";
        }
        // Refresh the list, which marks the network now in use.
        if (netKind.value === "wifi" && page.value === "wifi") device()?.set?.("wifiScan", "1");
        if (!error && page.value === "hotspot") { hotspot.sync(); hotspot.edit("password", ""); }
      }
    }
    if (device()?.get?.("back") === "1") {
      if (netState.value !== "idle") dismissNetwork();
      else if (debug.active()) debug.close();
      else if (appLock.step.value) appLock.cancel();
      else if (recovery.action.value) recovery.dismiss();
      else if (drawer.value) drawer.value = null;
      else if (kb.value) closeKb();
      else if (editing.value) editing.value = false;
      else if (page.value !== "home") {
        if (page.value === "timezone") navigate("region", -1);
        else if (page.value === "v4") navigate("link", -1);
        else if (page.value === "wifi" || page.value === "hotspot" || page.value === "link") navigate("network", -1);
        else navigate("home", -1);
      } else device()?.set?.("launch", "shell");
    }
    const jumpTo = device()?.get?.("settingsPage") || "";
    if (netState.value === "idle" && (
      jumpTo === "home"
      || jumpTo === "screen"
      || jumpTo === "network"
      || jumpTo === "hotspot"
      || jumpTo === "display"
      || jumpTo === "region"
      || jumpTo === "timezone"
      || jumpTo === "about"
      || jumpTo === "restore"
      || jumpTo === "lock"
    )) {
      if (page.value !== jumpTo) navigate(jumpTo as Page, jumpTo === "home" ? -1 : 1);
      device()?.set?.("settingsPage", "");
    }
    const nextGen = device()?.get?.("appsGen") || "";
    if (nextGen !== appsGen.value) {
      appsGen.value = nextGen;
      appView.value = readView();
      launcherApps.value = readLauncherApps();
    }
    const nextLang = readLang();
    if (nextLang !== lang.value) lang.value = nextLang;
    const nextTz = readTimezone();
    if (nextTz !== timezone.value) timezone.value = nextTz;
    const next = hhmm();
    if (next !== time.value) time.value = next;
    tick += 1;
    if (page.value === lastPage && (page.value === "about" || page.value === "network") && tick % 120 === 0) {
      system.value = readSystem();
    }
    const seq = device()?.get?.("knobSeq") || "0";
    if (seq !== knobSeq) {
      knobSeq = seq;
      if (seq !== "0") applyKnob();
    }
    if (kb.value) return;
    syncPage();
    if (drawer.value !== seenDrawer) {
      seenDrawer = drawer.value;
      if (drawer.value) {
        const ids = drawerIds();
        const cur =
          drawer.value === "apBand" ? hotspot.draft.value?.band || "2.4"
            : drawer.value === "apChannel" ? String(hotspot.draft.value?.channel || 0)
            : drawer.value === "view"
            ? appView.value
            : drawer.value === "language"
              ? lang.value
              : drawer.value === "lockTimeout" ? String(appLock.timeout.value) : String(rotate.value);
        const found = ids.indexOf(cur);
        cursor.value = found >= 0 ? found : 0;
      }
    }
    const rows = itemCount();
    if (focus.value < 0) focus.value = 0;
    if (rows > 0 && focus.value >= rows) focus.value = rows - 1;
    const knob = hasRotary.value;
    if (!kb.value) {
      const nextBlank = readBlank();
      if (nextBlank !== blank.value) blank.value = nextBlank;
      // Network getters may perform synchronous D-Bus I/O after their cache
      // expires. Unrelated rotary lists must not wait on that status refresh.
      if (page.value === "network" || page.value === "link" || page.value === "wifi") {
        hotspot.sync();
        const nextIp = device()?.get?.("ip") || "";
        if (nextIp !== ip.value) ip.value = nextIp;
        const nextSsid = device()?.get?.("wifiSsid") || "";
        if (nextSsid !== wifiSsid.value) wifiSsid.value = nextSsid;
        const nextGeneration = device()?.get?.("wifiGeneration") || "";
        if (nextGeneration !== wifiGeneration.value) wifiGeneration.value = nextGeneration;
        const rawLinks = device()?.get?.("links") || "[]";
        if (rawLinks !== linksRaw) {
          linksRaw = rawLinks;
          links.value = parseLinks(rawLinks);
        }
      }
      if (page.value === "hotspot") hotspot.sync();
      if (page.value === "wifi") {
        const rawScan = device()?.get?.("wifiScan") || "[]";
        if (rawScan !== scanRaw) {
          scanRaw = rawScan;
          aps.value = parseAps(rawScan);
          slideFrames = 2;
          setHot(true);
        }
        const busy = device()?.get?.("setupBusy") === "1";
        if (busy !== scanBusy.value) scanBusy.value = busy;
      }
    }
    knobRow.value = knob && netState.value === "idle" && !drawer.value && !kb.value && !recovery.action.value && !debug.active() && !appLock.step.value ? focus.value : -1;
    drawerRow.value = knob && !!drawer.value ? cursor.value : -1;
    rowArmed.value = editing.value;
    pinRow.value = page.value === "timezone"
      ? TIMEZONES.findIndex((zone) => zone.id === timezone.value)
      : -1;
  });

  const setView = (next: AppView) => {
    appView.value = next;
    device()?.set?.("appView", next);
  };

  const appOptions = () => {
    const index = launcherApps.value.findIndex(app => app.id === appId.value);
    const app = launcherApps.value[index];
    if (!app) return [];
    const options: { id: AppAction; label: string }[] = [
      { id: app.hidden ? "show" : "hide", label: t(app.hidden ? "show" : "hide", {}, lang.value) },
    ];
    if (index > 0) options.push({ id: "up", label: t("moveUp", {}, lang.value) });
    if (index < launcherApps.value.length - 1) options.push({ id: "down", label: t("moveDown", {}, lang.value) });
    return options;
  };

  const openApp = (app: ListedApp) => {
    appId.value = app.id;
    cursor.value = 0;
    showDrawer("app");
  };

  const changeApp = (action: string) => {
    if (!appOptions().some(option => option.id === action)) return;
    const next = appLayoutUpdate(device()?.get?.("apps") || "[]", device()?.get?.("layout") || "{}", appId.value, action as AppAction);
    if (next === null) return;
    device()?.set?.("layout", next);
    launcherApps.value = readLauncherApps();
    const index = launcherApps.value.findIndex(app => app.id === appId.value);
    if (index >= 0) { focus.value = index + 1; reveal(focus.value); }
  };

  const setBrightness = (pct: number) => {
    brightness.value = pct;
    device()?.set?.("brightness", String(pct));
  };

  const setRotate = (next: Rotate) => {
    if (rotate.value === next) return;
    rotate.value = next;
    setHot(true);
    device()?.set?.("rotate", String(next));
  };

  const setLang = (next: Lang) => {
    lang.value = next;
    device()?.set?.("language", next);
    setHot(true);
  };

  const setTimezone = (next: string) => {
    timezone.value = next;
    device()?.set?.("timezone", next);
    setHot(true);
  };

  const setBlank = (seconds: number) => {
    const n = Math.max(0, Math.min(86400, Math.floor(seconds)));
    blank.value = n;
    device()?.set?.("blankSeconds", String(n));
    setHot(true);
  };

  const openKb = (kind: KeyKind, target: KbTarget, extra = "") => {
    kb.value = kind;
    kbTarget.value = target;
    if (target === "wifi") {
      kbSsid.value = extra;
      kbValue.value = "";
    } else {
      kbValue.value = extra;
    }
    kbFocus.value = 0;
    kbRotaryFocus.value = true;
    kbMode.value = 0;
    kbReveal.value = false;
    slideFrames = 2;
    setHot(true);
  };

  const closeKb = () => {
    kb.value = "";
    kbTarget.value = "";
    slideFrames = 2;
    setHot(true);
  };

  const pressToken = (token: string) => {
    if (!kb.value) return;
    const max =
      kbTarget.value === "blank" ? 6 : kbTarget.value === "vlan" ? 4 : kbTarget.value === "v6pre" ? 3 : kbTarget.value === "ssid" ? 32 : kbTarget.value === "password" ? 63 : 64;
    const applied = applyToken(kbValue.value, token, max);
    if (applied.action === "mode") {
      if (kb.value === "text") {
        kbMode.value = nextKeyMode(kbMode.value, screenSize());
        kbFocus.value = 0;
      }
      return;
    }
    if (applied.action === "cancel") {
      closeKb();
      return;
    }
    if (applied.action === "char") {
      kbValue.value = applied.value;
      return;
    }
    const value = applied.value;
    const target = kbTarget.value;
    const ssid = kbSsid.value;
    closeKb();
    if (target === "blank") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) setBlank(n);
      return;
    }
    if (target === "wifi" && ssid) {
      connectWifi(ssid, value, true);
      return;
    }
    netError.value = "";
    if (["ssid", "password", "address", "dhcp_start", "dhcp_end"].includes(target)) hotspot.edit(target as HotspotField, value);
    else if (target === "v4ip") v4ip.value = value;
    else if (target === "v4mask") v4mask.value = value;
    else if (target === "v4gw") v4gw.value = value;
    else if (target === "dns") dns.value = value;
    else if (target === "v6addr") v6addr.value = value;
    else if (target === "v6pre") v6pre.value = value;
    else if (target === "v6gw") v6gw.value = value;
    else if (target === "vlan") vlan.value = value;
  };

  const closeDrawer = () => {
    drawer.value = null;
    setHot(true);
  };

  const showDrawer = (kind: DrawerKind) => {
    editing.value = false;
    shownDrawer.value = kind;
    drawer.value = kind;
    setHot(true);
  };

  const back = () => {
    if (debug.active()) { debug.close(); return; }
    if (netState.value !== "idle") { dismissNetwork(); return; }
    if (appLock.step.value) { appLock.cancel(); return; }
    if (recovery.action.value) { recovery.dismiss(); return; }
    if (editing.value) {
      editing.value = false;
      setHot(true);
      return;
    }
    if (drawer.value) {
      closeDrawer();
      return;
    }
    if (page.value === "timezone") {
      navigate("region", -1);
      return;
    }
    if (page.value === "v4") {
      navigate("link", -1);
      return;
    }
    if (page.value === "wifi" || page.value === "hotspot" || page.value === "link") {
      navigate("network", -1);
      return;
    }
    navigate("home", -1);
  };

  const pickDrawer = (id: string) => {
    if (drawer.value === "apBand") hotspot.edit("band", id);
    else if (drawer.value === "apChannel") hotspot.edit("channel", Number(id));
    else if (drawer.value === "view") setView(id === "list" ? "list" : "icons");
    else if (drawer.value === "app") changeApp(id);
    else if (drawer.value === "lockTimeout") appLock.setTimeout(Number(id));
    else if (drawer.value === "language") {
      if (id === "zh" || id === "zh_tw" || id === "en") setLang(id);
    } else if (drawer.value === "blank") {
      if (id === "custom") {
        closeDrawer();
        openKb("number", "blank");
        return;
      }
      const n = Number(id);
      if (Number.isFinite(n) && n >= 0) setBlank(n);
    } else if (drawer.value === "v4") {
      if (id === "dhcp" || id === "static") v4mode.value = id;
    } else if (drawer.value === "v6") {
      if (id === "slaac" || id === "static") v6mode.value = id;
    } else {
      const deg = Number(id) as Rotate;
      if (deg === 0 || deg === 90 || deg === 180 || deg === 270) setRotate(deg);
    }
    closeDrawer();
  };

  const leave = () => {
    if (netState.value !== "idle") { dismissNetwork(); return; }
    if (page.value === "home") device()?.set?.("launch", "shell");
    else back();
  };

  const activate = () => {
    const i = focus.value;
    if (hasRotary.value && i === itemCount() - 1) {
      leave();
      return;
    }
    if (page.value === "home") {
      const next = (["screen", "network", "region", "lock", "restore", "display", "about"] as const)[i];
      if (next) navigate(next, 1);
      return;
    }
    if (page.value === "screen") {
      if (i === 0) {
        editing.value = true;
        slideFrames = 14;
        setHot(true);
      } else if (i === 1) {
        showDrawer("blank");
      } else {
        showDrawer("rotate");
      }
      return;
    }
    if (page.value === "restore") {
      const action = RECOVERY_ACTIONS[i];
      if (action) openRecovery(action);
      else if (i === 3) debug.openDiagnostics();
      else if (i === 4) debug.openAdb();
      return;
    }
    if (page.value === "lock") {
      if (i === 0) appLock.open();
      else if (i === 1) showDrawer("lockTimeout");
      else if (appLock.enabled.value) appLock.open(true);
      return;
    }
    if (page.value === "network") {
      const link = networkLinks()[i];
      if (!link) return;
      openNetwork(link);
      return;
    }
    if (page.value === "hotspot") {
      const row = hotspotRows(hotspot.draft.value)[i];
      if (row) openHotspot(row);
      return;
    }
    if (page.value === "link") {
      const id = wirePlan()[i];
      if (id) openWire(id);
      return;
    }
    if (page.value === "v4") {
      const id = (["v4ip", "v4mask", "v4gw", "dns"] as const)[i];
      if (id) openField(id);
      return;
    }
    if (page.value === "wifi") {
      const ap = aps.value[i];
      if (!ap) {
        device()?.set?.("wifiScan", "1");
        return;
      }
      joinAp(ap);
      return;
    }
    if (page.value === "display") {
      if (i === 0) showDrawer("view");
      else if (launcherApps.value[i - 1]) openApp(launcherApps.value[i - 1]);
      return;
    }
    if (page.value === "region") {
      if (i === 0) {
        showDrawer("language");
      } else {
        navigate("timezone", 1);
      }
      return;
    }
    if (page.value === "timezone") {
      const zone = TIMEZONES[i];
      if (!zone) return;
      setTimezone(zone.id);
      navigate("region", -1);
    }
  };

  const applyKnob = () => {
    const step = Number(device()?.get?.("knob") || "0");
    const click = device()?.get?.("knobClick") === "1";
    const hold = device()?.get?.("knobHold") === "1";
    if (debug.active()) { debug.handleKnob(step, click, hold); return; }
    if (netState.value !== "idle") {
      if (netState.value === "applying") return;
      if (hold) dismissNetwork();
      else if (click) {
        if (netState.value === "failed" && netDialogFocus.value === 1) retryNetwork();
        else dismissNetwork();
      } else if (step && netState.value === "failed") {
        netDialogFocus.value = Math.max(0, Math.min(1, netDialogFocus.value + step));
        setHot(true);
      }
      return;
    }
    if (appLock.step.value) { appLock.handleKnob(step, click, hold); return; }
    if (recovery.action.value) { recovery.handleKnob(step, click); return; }
    if (kb.value) {
      if (hold) {
        closeKb();
        return;
      }
      const caps = layoutKeys(kb.value, kbMode.value, screenSize()).caps;
      const slots = caps.length + (kbTarget.value === "wifi" || kbTarget.value === "password" ? 1 : 0);
      if (click) {
        if ((kbTarget.value === "wifi" || kbTarget.value === "password") && kbFocus.value >= caps.length) {
          kbReveal.value = !kbReveal.value;
        } else {
          const cap = caps[kbFocus.value];
          if (cap) pressToken(cap.token);
        }
      } else if (step !== 0) {
        kbFocus.value = moveFocus(kbFocus.value, step, slots);
      } else {
        return;
      }
      kbRotaryFocus.value = true;
      slideFrames = 1;
      setHot(true);
      return;
    }
    if (hold) {
      if (editing.value) editing.value = false;
      else if (drawer.value || page.value !== "home") back();
      else device()?.set?.("launch", "shell");
      return;
    }
    if (drawer.value) {
      const ids = drawerIds();
      if (click) {
        const id = ids[cursor.value];
        if (id) pickDrawer(id);
      } else if (step !== 0 && ids.length > 0) {
        cursor.value = Math.max(0, Math.min(ids.length - 1, cursor.value + step));
        holdFrames(1);
      }
      return;
    }
    if (editing.value) {
      if (click) {
        editing.value = false;
        slideFrames = 14;
        setHot(true);
      } else if (step !== 0) {
        setBrightness(Math.max(5, Math.min(100, brightness.value + step * 5)));
      }
      return;
    }
    if (click) {
      activate();
      return;
    }
    if (step === 0) return;
    const rows = itemCount();
    if (rows <= 0) {
      scrollBy(step);
      return;
    }
    // The encoder can coalesce several detents into one delta. Keep the
    // cursor and the viewport driven by the same clamped target; scrolling
    // without moving `focus` leaves the highlighted row behind when a fast
    // turn crosses more than one item (or reaches an edge).
    const next = moveFocus(focus.value, step, rows);
    if (next === focus.value) {
      // Informational pages (the app catalog and About) contain additional
      // non-focusable content. Once their selectable rows are at an edge,
      // keep allowing the encoder to pan that overflow without losing the
      // edge selection.
      if (page.value === "display" || page.value === "about") scrollBy(step);
      return;
    }
    focus.value = next;
    reveal(next);
  };

  createGesture({
    axis: "y",
    region: {
      rect: () =>
        debug.active() || netState.value !== "idle" || appLock.step.value || recovery.action.value || drawer.value || kb.value || editing.value ||
        contentH(
          page.value,
          launcherApps.value.length,
          hasRotary.value,
          dataRows(),
        ) <= viewH(page.value)
          ? null
          : { x: 0, y: APP_BAR_H, w: screenSize().w, h: viewH(page.value) },
    },
    onDown() {
      const [node, offset] = (device()?.get?.("appScrollPosition") || "").split(":").map(Number);
      if (list?.id === node && Number.isFinite(offset) && offset >= 0) {
        scrollY = Math.max(minY(), Math.min(0, -offset));
        jump(list, "translateY", scrollY);
      }
      gestureScrollY = scrollY;
    },
    onPanStart() {
      setHot(true);
    },
    onPanMove(c) {
      scrollY = Math.max(minY(), Math.min(0, gestureScrollY + c.dy));
      if (list) jump(list, "translateY", scrollY);
    },
    onPanEnd(c) {
      const previous = scrollY;
      scrollY = settleTouchScroll(gestureScrollY, scrollY, c.dy, c.vy, viewH(page.value), minY());
      if (scrollY !== previous) glideY(previous);
      setHot(false);
    },
    onCancel() {
      // An observing list is also cancelled when a slider or system edge
      // wins. Never rewind it to an earlier contact's starting position.
      setHot(false);
    },
  });

  createGesture({
    axis: "x",
    panSlop: 12,
    region: { rect: () => ({
      x: 0, y: 0, w: debug.active() || kb.value || appLock.step.value ? 20 : screenSize().w,
      // Keep keyboard character selection and an armed slider exclusive.
      h: editing.value ? APP_BAR_H : screenSize().h - 20,
    }) },
    onPanEnd(c) {
      if (c.dx < 28 || c.dx <= Math.abs(c.dy)) return;
      if (netState.value !== "idle") dismissNetwork();
      else if (kb.value) closeKb();
      else if (debug.active() || appLock.step.value || recovery.action.value || drawer.value || editing.value) back();
      else leave();
    },
  });

  const touchless = device()?.get?.("touchOn") === "0";

  const renderPage = (shownPage: Page) => shownPage === "home" ? (
    <View class="w-full shrink-0 flex flex-col justify-start px-5 pt-8 gap-1">
      <ListRow icon={SETTINGS_ASSETS.screen} title={t("screen", {}, lang.value)} rowIndex={0} onPress={() => navigate("screen", 1)} />
      <ListRow icon={SETTINGS_ASSETS.net} title={t("network", {}, lang.value)} rowIndex={1} onPress={() => navigate("network", 1)} />
      <ListRow icon={SETTINGS_ASSETS.region} title={t("regionTime", {}, lang.value)} rowIndex={2} onPress={() => navigate("region", 1)} />
      <ListRow icon={SETTINGS_ASSETS.lock} title={t("appLock", {}, lang.value)} rowIndex={3} onPress={() => navigate("lock", 1)} />
      <ListRow icon={SETTINGS_ASSETS.screen} title={t("restore", {}, lang.value)} rowIndex={4} onPress={() => navigate("restore", 1)} />
      <ListRow icon={SETTINGS_ASSETS.display} title={t("appView", {}, lang.value)} rowIndex={5} onPress={() => navigate("display", 1)} />
      <ListRow icon={SETTINGS_ASSETS.about} title={t("aboutOneKvm", {}, lang.value)} rowIndex={6} onPress={() => navigate("about", 1)} />
      {hasRotary.value ? (
        <ListRow icon={SETTINGS_ASSETS.back} title={t("back", {}, lang.value)} rowIndex={7} onPress={leave} />
      ) : null}
    </View>
  ) : (
    <View class="w-full shrink-0 flex flex-col items-center px-5">
      <AppTitle height={28}
        title={
          shownPage === "link"
            ? nicName.value || t("wired", {}, lang.value)
            : shownPage === "v4"
              ? t("v4settings", {}, lang.value)
              : pageTitle(shownPage, lang.value)
        }
      />
      {shownPage === "screen" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          <BrightnessRow
            value={brightness.value}
            enabled={!drawer.value}
            editing={editing.value}
            top={() => APP_BAR_H + 28 + scrollY}
            rowIndex={0}
            title={t("brightness", {}, lang.value)}
            onChange={setBrightness}
            onToggle={() => {
              focus.value = 0;
              editing.value = !editing.value;
              setHot(true);
            }}
          />
          <OptionRow
            icon={SETTINGS_ASSETS.screen}
            title={t("blank", {}, lang.value)}
            value={blankLabel(blank.value, lang.value)}
            rowIndex={1}
            onPress={() => {
              showDrawer("blank");
            }}
          />
          <OptionRow
            icon={SETTINGS_ASSETS.display}
            title={t("rotate", {}, lang.value)}
            value={rotateLabel(rotate.value, lang.value)}
            rowIndex={2}
            onPress={() => {
              showDrawer("rotate");
            }}
          />
        </View>
      ) : null}
      {shownPage === "network" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          {networkLinks().length === 0 ? (
            <ListRow title={t("unavailable", {}, lang.value)} rowIndex={0} />
          ) : (
            networkLinks().map((link, index) => (
              <ListRow
                icon={link.kind === "eth" ? SETTINGS_ASSETS.net : SETTINGS_ASSETS.wifi}
                title={link.kind === "ap" ? t("hotspot", {}, lang.value) : link.name}
                value={
                  link.kind === "ap" ? hotspot.status.value?.ap_ssid || ""
                  : link.kind === "wifi"
                    ? wifiSsid.value || t("wifiDown", {}, lang.value)
                    : ip.value || t("disconnected", {}, lang.value)
                }
                tags={
                  link.kind === "ap" ? [t(hotspot.status.value?.ap_enabled ? "enabled" : "disabled", {}, lang.value)]
                  : link.kind === "wifi" && wifiSsid.value
                    ? [t("wifiOk", {}, lang.value)]
                    : link.kind === "eth"
                      ? [t("wired", {}, lang.value)]
                      : []
                }
                rowIndex={index}
                onPress={() => openNetwork(link)}
              />
            ))
          )}
        </View>
      ) : null}
      {shownPage === "hotspot" ? <HotspotSettings status={hotspot.status.value} draft={hotspot.draft.value} lang={lang.value} onPress={openHotspot} /> : null}
      {shownPage === "wifi" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          {aps.value.length === 0 ? (
            <ListRow
              title={
                scanBusy.value
                  ? t("scanning", {}, lang.value)
                  : device()?.get?.("wifi") === "0"
                    ? t("nowifi", {}, lang.value)
                    : device()?.get?.("setupError") && !isWifiJoinError(device()?.get?.("setupError") || "")
                      ? t("scanFailed", {}, lang.value)
                      : t("noNetworks", {}, lang.value)
              }
              rowIndex={0}
              onPress={() => {
                device()?.set?.("wifiScan", "1");
              }}
            />
          ) : (
            aps.value.map((ap, index) => (
              <ListRow
                title={ap.ssid}
                tags={apTags(ap, lang.value, wifiGeneration.value)}
                rowIndex={index}
                onPress={() => joinAp(ap)}
              />
            ))
          )}
        </View>
      ) : null}
      {shownPage === "link" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          {wirePlan().map((id, index) => (
            <OptionRow
              title={wireTitle(id)}
              value={wireValue(id)}
              rowIndex={index}
              onPress={() => openWire(id)}
            />
          ))}
        </View>
      ) : null}
      {shownPage === "v4" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          {(
            [
              ["v4ip", "IP", v4ip.value],
              ["v4mask", t("mask", {}, lang.value), v4mask.value],
              ["v4gw", t("gateway", {}, lang.value), v4gw.value],
              ["dns", t("dns", {}, lang.value), dns.value],
            ] as const
          ).map((row, index) => (
            <OptionRow
              title={row[1]}
              value={row[2]}
              rowIndex={index}
              onPress={() => openField(row[0])}
            />
          ))}
        </View>
      ) : null}
      {shownPage === "display" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          <OptionRow
            icon={SETTINGS_ASSETS.display}
            title={t("viewMode", {}, lang.value)}
            value={viewLabel(appView.value, lang.value)}
            rowIndex={0}
            onPress={() => {
              showDrawer("view");
            }}
          />
          <View class="w-full flex items-center px-2" style={{ height: 28 }}>
            <Text class="text-xs text-zinc-400" style={{ fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>
              {t("appList", {}, lang.value)}
            </Text>
          </View>
          <View class="w-full" style={{ height: 8 }} />
          {launcherApps.value.map((app, index) => (
            <ListRow title={app.title} value={t(app.hidden ? "appHidden" : "appVisible", {}, lang.value)} rowIndex={index + 1} onPress={() => openApp(app)} />
          ))}
        </View>
      ) : null}
      {shownPage === "region" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          <OptionRow
            icon={SETTINGS_ASSETS.region}
            title={t("language", {}, lang.value)}
            value={langLabel(lang.value)}
            rowIndex={0}
            onPress={() => {
              showDrawer("language");
            }}
          />
          <OptionRow
            icon={SETTINGS_ASSETS.region}
            title={t("timezone", {}, lang.value)}
            value={timezoneLabel(timezone.value, lang.value)}
            rowIndex={1}
            onPress={() => {
              navigate("timezone", 1);
            }}
          />
        </View>
      ) : null}
      {shownPage === "timezone" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          {TIMEZONES.map((zone, index) => (
            <ListRow
              title={t(zone.key, {}, lang.value)}
              rowIndex={index}
              onPress={() => {
                setTimezone(zone.id);
                navigate("region", -1);
              }}
            />
          ))}
        </View>
      ) : null}
      {shownPage === "about" ? <AboutPage system={system.value} lang={lang.value} /> : null}
      {shownPage === "restore" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          {RECOVERY_ACTIONS.map((action, index) => (
            <ListRow
              title={t(action === "reboot" ? "rebootDevice" : action === "factory-reset" ? "factoryReset" : "recoveryMode", {}, lang.value)}
              value={systemCapabilities[action] ? undefined : t("unavailable", {}, lang.value)}
              rowIndex={index}
              onPress={systemCapabilities[action] ? () => openRecovery(action) : undefined}
            />
          ))}
          <ListRow title={t("exportDiagnostics", {}, lang.value)} rowIndex={3}
            value={debug.available ? undefined : t("unavailable", {}, lang.value)}
            onPress={debug.available ? debug.openDiagnostics : undefined} />
          <ListRow title={t("usbDebug", {}, lang.value)} rowIndex={4}
            value={debug.available ? undefined : t("unavailable", {}, lang.value)}
            onPress={debug.available ? debug.openAdb : undefined} />
        </View>
      ) : null}
      {shownPage === "lock" ? (
        <View class="w-full shrink-0 flex flex-col justify-start gap-1">
          <ListRow title={t(appLock.enabled.value ? "changePin" : "enablePin", {}, lang.value)} rowIndex={0} onPress={() => appLock.open()} />
          <OptionRow title={t("lockTimeout", {}, lang.value)} value={t("seconds", { n: appLock.timeout.value }, lang.value)} rowIndex={1} onPress={() => showDrawer("lockTimeout")} />
          <ListRow title={t("disablePin", {}, lang.value)} value={appLock.enabled.value ? undefined : t("pinDisabled", {}, lang.value)} rowIndex={2} onPress={appLock.enabled.value ? () => appLock.open(true) : undefined} />
        </View>
      ) : null}
      {hasRotary.value ? (
        <View class="w-full pt-2">
          <ListRow icon={SETTINGS_ASSETS.back} title={t("back", {}, lang.value)} rowIndex={itemCount(shownPage) - 1} onPress={leave} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View class="relative w-full h-full overflow-hidden bg-black">
      <View
        class="relative w-full h-full flex flex-col items-center overflow-hidden"
      >
      <AppBar time={time.value} showBack={!touchless && page.value !== "home" && !kb.value} onBack={back} />
      {recovery.action.value ? <RecoveryConfirm controls={recovery} lang={lang.value} rotary={hasRotary.value} /> : kb.value ? null : (
      <View
        class="relative overflow-hidden"
        style={{ width: screenSize().w, height: viewH(page.value) }}
      >
        <View
          nodeRef={bindPage}
          class="absolute"
          style={{ insetL: 0, insetT: 0, width: screenSize().w }}
        >
          {renderPage(page.value)}
        </View>
      </View>
      )}
      </View>
      <OptionDrawer
        open={!!drawer.value}
        title={
          shownDrawer.value === "apBand" ? t("wifiBand", {}, lang.value)
            : shownDrawer.value === "apChannel" ? t("wifiChannel", {}, lang.value)
            : shownDrawer.value === "app" ? launcherApps.value.find(app => app.id === appId.value)?.title || t("appList", {}, lang.value)
            : shownDrawer.value === "view"
            ? t("viewMode", {}, lang.value)
            : shownDrawer.value === "language"
              ? t("language", {}, lang.value)
              : shownDrawer.value === "blank"
                ? t("blank", {}, lang.value)
                : shownDrawer.value === "v4"
                  ? "IPv4"
                  : shownDrawer.value === "v6"
                    ? "IPv6"
                    : shownDrawer.value === "lockTimeout" ? t("lockTimeout", {}, lang.value) : t("rotate", {}, lang.value)
        }
        options={
          shownDrawer.value === "apBand" ? ["2.4", "5"].filter(band => hotspotChannels(hotspot.status.value, band).length > 1).map(band => ({ id: band, label: `${band} GHz` }))
            : shownDrawer.value === "apChannel" ? hotspotChannels(hotspot.status.value, hotspot.draft.value?.band || "2.4").map(channel => ({ id: String(channel), label: channel ? String(channel) : t("automatic", {}, lang.value) }))
            : shownDrawer.value === "app" ? appOptions()
            : shownDrawer.value === "view"
            ? [
                { id: "icons", label: t("viewIcons", {}, lang.value) },
                { id: "list", label: t("viewList", {}, lang.value) },
              ]
            : shownDrawer.value === "language"
              ? [
                  { id: "en", label: t("langEn", {}, lang.value) },
                  { id: "zh", label: t("langZh", {}, lang.value) },
                  { id: "zh_tw", label: t("langZhTw", {}, lang.value) },
                ]
              : shownDrawer.value === "blank"
                ? [
                    { id: "0", label: t("never", {}, lang.value) },
                    { id: "30", label: t("s30", {}, lang.value) },
                    { id: "60", label: t("m1", {}, lang.value) },
                    { id: "300", label: t("m5", {}, lang.value) },
                    { id: "custom", label: t("custom", {}, lang.value) },
                  ]
                : shownDrawer.value === "v4"
                  ? [
                      { id: "dhcp", label: t("dhcp", {}, lang.value) },
                      { id: "static", label: t("staticAddr", {}, lang.value) },
                    ]
                  : shownDrawer.value === "v6"
                    ? [
                        { id: "slaac", label: t("slaac", {}, lang.value) },
                        { id: "static", label: t("staticAddr", {}, lang.value) },
                      ]
                    : shownDrawer.value === "lockTimeout" ? [15, 30, 60, 120, 300, 600].map((seconds) => ({ id: String(seconds), label: t("seconds", { n: seconds }, lang.value) }))
                    : rotationAngles.map(deg => ({ id: String(deg), label: rotateLabel(deg, lang.value) }))
        }
        value={
          shownDrawer.value === "apBand" ? hotspot.draft.value?.band || "2.4"
            : shownDrawer.value === "apChannel" ? String(hotspot.draft.value?.channel || 0)
            : shownDrawer.value === "app" ? ""
            : shownDrawer.value === "view"
            ? appView.value
            : shownDrawer.value === "language"
              ? lang.value
              : shownDrawer.value === "blank"
                ? blank.value === 0 || blank.value === 30 || blank.value === 60 || blank.value === 300
                  ? String(blank.value)
                  : ""
                : shownDrawer.value === "v4"
                  ? v4mode.value
                  : shownDrawer.value === "v6"
                    ? v6mode.value
                    : shownDrawer.value === "lockTimeout" ? String(appLock.timeout.value) : String(rotate.value)
        }
        onPick={pickDrawer}
        onClose={closeDrawer}
      />
      <Keyboard
        open={kb.value !== ""}
        assets={{
          backspace: SETTINGS_ASSETS.backspace,
          enter: SETTINGS_ASSETS.enter,
          space: SETTINGS_ASSETS.space,
        }}
        kind={kb.value || "text"}
        mode={kbMode.value}
        value={kbValue.value}
        secret={kbTarget.value === "wifi" || kbTarget.value === "password"}
        label={
          ["ssid", "password", "address", "dhcp_start", "dhcp_end"].includes(kbTarget.value)
            ? hotspotLabel(kbTarget.value as HotspotRow, lang.value)
            : kbTarget.value === "blank"
            ? t("blank", {}, lang.value)
            : kbTarget.value === "wifi"
              ? t("password", {}, lang.value)
              : kbTarget.value === "v4ip"
                ? "IP"
                : kbTarget.value === "v4mask"
                  ? t("mask", {}, lang.value)
                  : kbTarget.value === "v4gw" || kbTarget.value === "v6gw"
                    ? t("gateway", {}, lang.value)
                    : kbTarget.value === "dns"
                      ? t("dns", {}, lang.value)
                      : kbTarget.value === "v6addr"
                        ? t("address", {}, lang.value)
                        : kbTarget.value === "v6pre"
                          ? t("prefix", {}, lang.value)
                          : kbTarget.value === "vlan"
                            ? "VLAN"
                            : ""
        }
        revealed={kbReveal.value}
        revealLabel={kbReveal.value ? t("hide", {}, lang.value) : t("show", {}, lang.value)}
        focus={kbFocus.value}
        rotaryFocus={kbRotaryFocus.value}
        onFocus={(index) => {
          if (index >= 0) kbFocus.value = index;
          kbRotaryFocus.value = false;
        }}
        onToken={pressToken}
        onReveal={() => {
          kbReveal.value = !kbReveal.value;
        }}
      />
      <RecoveryDebug controls={debug} lang={lang.value} rotary={hasRotary.value} />
      {appLock.step.value ? <AppLockPanel controls={appLock} lang={lang.value} /> : null}
      {netState.value !== "idle" ? (
        <FeedbackModal
          width={screenSize().w}
          height={screenSize().h}
          busy={netState.value === "applying"}
          title={netState.value === "notice" ? undefined
            : netKind.value === "wifi"
            ? t(netState.value === "applying" ? "wifiConnecting" : netState.value === "applied" ? "wifiOk" : "wifiFailed", {}, lang.value)
            : t(netState.value === "applying" ? "applying" : netState.value === "applied" ? "applied" : "applyFailed", {}, lang.value)}
          message={netState.value === "failed" || netState.value === "notice" ? netError.value
            : netKind.value === "wifi" ? joining.value?.ssid || ""
            : t(netState.value === "applying" ? "networkSaving" : "networkSaved", {}, lang.value)}
          primary={{ label: t(netState.value === "failed" ? "retry" : "confirm", {}, lang.value), onPress: () => netState.value === "failed" ? retryNetwork() : dismissNetwork() }}
          secondary={netState.value === "failed" ? { label: t(netKind.value === "wifi" ? "cancel" : "editNetwork", {}, lang.value), onPress: dismissNetwork } : undefined}
          rotary={hasRotary.value}
          focus={netDialogFocus.value}
        />
      ) : null}
    </View>
  );
}
