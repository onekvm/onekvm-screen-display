import { setupFailureCode, startupMessage } from "./startup-copy";
import { TIMEZONE_IDS } from "../../apps/settings/src/timezone-ids";
import { LIST_ROW_H, LIST_ROW_PITCH } from "../shell/listMetrics";
import type { KeyKind } from "../shell/keypad";
import { layoutFor } from "../shell/layouts";

export const STEPS = ["welcome", "language", "blank", "network", "password"] as const;
export type Step = (typeof STEPS)[number];
export type Lang = "zh" | "en" | "zh_tw";

export const LIST_TOP = 28;
export const ROW_H = LIST_ROW_H;
export const ROW_PITCH = LIST_ROW_PITCH;

/**
 * Language of the setup screens and dialogs. Until a language is picked on the
 * language step of this setup they are in English; a language stored on the
 * device, for example by an earlier setup, is not used.
 */
export function setupLang(picked: string | null = null): Lang {
  return picked ? normalizeLang(picked) : "en";
}

export function normalizeLang(raw: string): Lang {
  const n = raw.trim().toLowerCase().replace(/-/g, "_");
  if (n === "zh" || n === "zh_cn") return "zh";
  if (n === "zh_tw") return "zh_tw";
  return "en";
}

type Copy = {
  language: string;
  back: string;
  timezone: string;
  filter: string;
  all: string;
  asia: string;
  europe: string;
  america: string;
  australia: string;
  blank: string;
  never: string;
  s30: string;
  m1: string;
  m5: string;
  custom: string;
  network: string;
  wired: string;
  wireless: string;
  hidden: string;
  advanced: string;
  collapse: string;
  dhcp: string;
  static: string;
  address: string;
  gateway: string;
  prefix: string;
  v4settings: string;
  mask: string;
  badAddress: string;
  badGateway: string;
  badDns: string;
  badMask: string;
  badVlan: string;
  badPrefix: string;
  badBlank: string;
  badMarker: string;
  badReach: string;
  badApply: string;
  apply: string;
  next: string;
  nowifi: string;
  scanning: string;
  scanFailed: string;
  connecting: string;
  wifiFail: string;
  wifiPassword: string;
  wifiBusy: string;
  wifiPending: string;
  wifiApOnly: string;
  wifiService: string;
  wifiWpa3Only: string;
  wifiOk: string;
  networkApplied: string;
  wifiDown: string;
  retry: string;
  show: string;
  hide: string;
  noNetworks: string;
  open: string;
  password: string;
  account: string;
  username: string;
  badUsername: string;
  confirm: string;
  done: string;
  wait: string;
  mismatch: string;
  short: string;
  nfs: string;
  ssid: string;
  slaac: string;
  dns: string;
  dismiss: string;
  onDevice: string;
};

const ZH: Copy = {
  language: "语言",
  back: "返回",
  timezone: "时区",
  filter: "筛选",
  all: "全部",
  asia: "亚洲",
  europe: "欧洲",
  america: "美洲",
  australia: "澳洲",
  blank: "熄屏",
  never: "永不",
  s30: "30秒",
  m1: "1分钟",
  m5: "5分钟",
  custom: "自定义",
  network: "网络",
  wired: "有线",
  wireless: "无线",
  hidden: "隐藏网络",
  advanced: "高级",
  collapse: "收起",
  dhcp: "DHCP",
  static: "静态",
  address: "地址",
  gateway: "网关",
  prefix: "前缀",
  v4settings: "IPv4 设置",
  mask: "掩码",
  badAddress: "IP 格式不正确",
  badGateway: "网关格式不正确",
  badDns: "DNS 格式不正确",
  badMask: "掩码格式不正确",
  badVlan: "VLAN 须为 1-4094",
  badPrefix: "前缀须为 0-128",
  badBlank: "请填写熄屏秒数",
  badMarker: "设置未能保存",
  badReach: "连不上本机服务",
  badApply: "设置没有成功",
  apply: "应用",
  next: "继续",
  nowifi: "无无线",
  scanning: "正在扫描",
  scanFailed: "扫描失败",
  connecting: "正在连接",
  wifiFail: "连接失败，请重试",
  wifiPassword: "密码需 8～63 个字符",
  wifiBusy: "无线正忙，请稍后重试",
  wifiPending: "请在网页确认网络配置",
  wifiApOnly: "请在网页退出仅热点模式",
  wifiService: "无线不可用，请稍后重试",
  wifiWpa3Only: "不支持仅 WPA3 的网络",
  wifiOk: "已连接",
  networkApplied: "网络配置已应用",
  wifiDown: "未连接",
  retry: "重试",
  show: "显示",
  hide: "隐藏",
  noNetworks: "未找到网络",
  open: "开放",
  password: "密码",
  account: "账户",
  username: "用户名",
  badUsername: "用户名须为 1-64 字符",
  confirm: "确认密码",
  done: "完成",
  wait: "等待",
  mismatch: "两次密码不一致",
  short: "密码至少 8 位",
  nfs: "NFS 下不能改网络",
  ssid: "请填写网络名称",
  slaac: "SLAAC",
  dns: "DNS",
  dismiss: "知道了",
  onDevice: "在此屏幕设置",
};

const ZHT: Copy = {
  language: "語言",
  back: "返回",
  timezone: "時區",
  filter: "篩選",
  all: "全部",
  asia: "亞洲",
  europe: "歐洲",
  america: "美洲",
  australia: "澳洲",
  blank: "熄屏",
  never: "永不",
  s30: "30秒",
  m1: "1分鐘",
  m5: "5分鐘",
  custom: "自訂",
  network: "網路",
  wired: "有線",
  wireless: "無線",
  hidden: "隱藏網路",
  advanced: "進階",
  collapse: "收起",
  dhcp: "DHCP",
  static: "靜態",
  address: "位址",
  gateway: "閘道",
  prefix: "前綴",
  v4settings: "IPv4 設定",
  mask: "遮罩",
  badAddress: "IP 格式不正確",
  badGateway: "閘道格式不正確",
  badDns: "DNS 格式不正確",
  badMask: "遮罩格式不正確",
  badVlan: "VLAN 須為 1-4094",
  badPrefix: "前綴須為 0-128",
  badBlank: "請填寫熄屏秒數",
  badMarker: "設定未能儲存",
  badReach: "連不上本機服務",
  badApply: "設定沒有成功",
  apply: "套用",
  next: "繼續",
  nowifi: "無無線",
  scanning: "正在掃描",
  scanFailed: "掃描失敗",
  connecting: "正在連線",
  wifiFail: "連線失敗，請重試",
  wifiPassword: "密碼需 8～63 個字元",
  wifiBusy: "無線忙碌，請稍後重試",
  wifiPending: "請在網頁確認網路設定",
  wifiApOnly: "請在網頁退出僅熱點模式",
  wifiService: "無線無法使用，請稍後重試",
  wifiWpa3Only: "不支援僅 WPA3 的網路",
  wifiOk: "已連線",
  networkApplied: "網路設定已套用",
  wifiDown: "未連線",
  retry: "重試",
  show: "顯示",
  hide: "隱藏",
  noNetworks: "未找到網路",
  open: "開放",
  password: "密碼",
  account: "帳號",
  username: "使用者名稱",
  badUsername: "使用者名稱須為 1-64 字元",
  confirm: "確認密碼",
  done: "完成",
  wait: "等待",
  mismatch: "兩次密碼不一致",
  short: "密碼至少 8 位",
  nfs: "NFS 下不能改網路",
  ssid: "請填寫網路名稱",
  slaac: "SLAAC",
  dns: "DNS",
  dismiss: "知道了",
  onDevice: "在此螢幕設定",
};

const EN: Copy = {
  language: "Language",
  back: "Back",
  timezone: "Timezone",
  filter: "Filter",
  all: "All",
  asia: "Asia",
  europe: "Europe",
  america: "America",
  australia: "Australia",
  blank: "Screen off",
  never: "Never",
  s30: "30s",
  m1: "1 min",
  m5: "5 min",
  custom: "Custom",
  network: "Network",
  wired: "Ethernet",
  wireless: "Wi-Fi",
  hidden: "Hidden",
  advanced: "Advanced",
  collapse: "Hide",
  dhcp: "DHCP",
  static: "Static",
  address: "Address",
  gateway: "Gateway",
  prefix: "Prefix",
  v4settings: "IPv4 settings",
  mask: "Mask",
  badAddress: "Enter a valid IP",
  badGateway: "Enter a valid gateway",
  badDns: "Enter a valid DNS",
  badMask: "Enter a valid mask",
  badVlan: "VLAN must be 1-4094",
  badPrefix: "Prefix must be 0-128",
  badBlank: "Enter seconds before the screen turns off",
  badMarker: "Could not save setup",
  badReach: "Can't reach the device",
  badApply: "That change failed",
  apply: "Apply",
  next: "Continue",
  nowifi: "No Wi-Fi",
  scanning: "Scanning",
  scanFailed: "Scan failed",
  connecting: "Connecting",
  wifiFail: "Connection failed. Try again",
  wifiPassword: "Password: 8–63 characters",
  wifiBusy: "Wi-Fi busy. Retry later",
  wifiPending: "Confirm network on web",
  wifiApOnly: "Exit hotspot-only on web",
  wifiService: "Wi-Fi down. Retry later",
  wifiWpa3Only: "WPA3-only not supported",
  wifiOk: "Connected",
  networkApplied: "Network settings applied",
  wifiDown: "Not connected",
  retry: "Retry",
  show: "Show",
  hide: "Hide",
  noNetworks: "No networks",
  open: "Open",
  password: "Password",
  account: "Account",
  username: "Username",
  badUsername: "Username must be 1-64 characters",
  confirm: "Confirm password",
  done: "Done",
  wait: "Wait",
  mismatch: "Passwords don't match",
  short: "At least 8 characters",
  nfs: "Can't change NFS network",
  ssid: "Enter a network name",
  slaac: "SLAAC",
  dns: "DNS",
  dismiss: "OK",
  onDevice: "Set up here",
};

export function copy(lang: string): Copy {
  const n = normalizeLang(lang);
  if (n === "zh") return ZH;
  if (n === "zh_tw") return ZHT;
  return EN;
}

/** Welcome button cycles these labels. Each one stays up for 5 seconds. */
export const BUTTON_LANGS = ["zh", "en", "zh_tw"] as const;
export const BUTTON_LANG_MS = 5000;

export function buttonLangAt(elapsedMs: number): (typeof BUTTON_LANGS)[number] {
  const step = Math.floor(Math.max(0, elapsedMs) / BUTTON_LANG_MS);
  return BUTTON_LANGS[step % BUTTON_LANGS.length] ?? "zh";
}

export type NetAp = {
  ssid: string;
  secure: boolean;
  /** open, wep, wpa, wpa2, wpa3, wpa2-wpa3, owe. Missing on older scans. */
  security?: string;
  /** "2.4", "5", "6". */
  bands?: string[];
  /** "Wi-Fi 6" and similar. Empty when the beacon did not say. */
  generation?: string;
  /** This name is the network the radio is associated with. */
  connected?: boolean;
};

export type NetLink = { name: string; kind: "eth" | "wifi" };

function wifiName(name: string): boolean {
  return name.startsWith("wlan") || name.startsWith("wl");
}

export function parseLinks(raw: string): NetLink[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: NetLink[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { name?: unknown; kind?: unknown };
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      const kind = rec.kind === "wifi" || rec.kind === "eth" ? rec.kind : "";
      if (!name || !kind || out.some((link) => link.name === name)) continue;
      out.push({ name, kind });
    }
    return out;
  } catch {
    return [];
  }
}

/** Host `links` wins. An empty string is an older host, so use iface and wifi. */
export function resolveLinks(raw: string, wifi: boolean, iface: string): NetLink[] {
  const text = raw.trim();
  if (text) return parseLinks(text);
  const out: NetLink[] = [];
  const name = iface.trim();
  if (name && !wifiName(name)) out.push({ name, kind: "eth" });
  if (wifi) {
    const radio = wifiName(name) ? name : "wlan0";
    if (!out.some((link) => link.name === radio)) out.push({ name: radio, kind: "wifi" });
  }
  return out;
}

export type PageState = {
  step: Step;
  lang: string;
  /** Timezone page region. "all" shows every zone. */
  tzFilter: string;
  /** Wired IPv4/IPv6/VLAN page. */
  advanced: boolean;
  /** Wireless scan page. */
  wifiPage: boolean;
  /** Static IPv4 address and mask page, under the wired config. */
  v4page: boolean;
  v4: "dhcp" | "static";
  v6: "slaac" | "static";
  wifi: boolean;
  links: NetLink[];
  /** Default-route interface, used to place the address on that card. */
  iface: string;
  ip: string;
  /** SSID the radio is associated with. Empty when it is not. */
  wifiSsid: string;
  /** IPv4 on the Wi-Fi interface, even when the default route is wired. */
  wifiIp: string;
  /** Hardware maximum, independent of a scanned hotspot's standard. */
  wifiGeneration: string;
  aps: NetAp[];
  username: string;
  pass1: string;
  pass2: string;
  v4addr: string;
  v4gw: string;
  dns: string;
  v6addr: string;
  v6prefix: string;
  v6gw: string;
  vlan: string;
  busy: boolean;
};

export type Row = {
  id: string;
  label: string;
  value?: string;
  detail?: string;
  icon?: string;
  tags?: string[];
};

/** Address belongs on the card of the interface that holds it. */
/** Second line of a NIC card. Wired stays "有线" plus its address. Wi-Fi names the network. */
export function linkCard(
  link: NetLink,
  s: Pick<PageState, "lang" | "iface" | "ip" | "wifiSsid" | "wifiIp">,
): { value: string; detail?: string } {
  const c = copy(s.lang);
  if (link.kind === "eth") {
    const address = linkAddress(link.name, s.iface, s.ip);
    return { value: c.wired, detail: address || undefined };
  }
  const ssid = (s.wifiSsid || "").trim();
  const address = (s.wifiIp || "").trim() || linkAddress(link.name, s.iface, s.ip);
  return {
    value: ssid ? `${c.wifiOk} ${ssid}` : c.wifiDown,
    detail: address || undefined,
  };
}

export function linkAddress(name: string, iface: string, ip: string): string {
  const address = (ip || "").trim();
  if (!address || (iface || "").trim() !== name) return "";
  return address;
}

function backRow(label: string): Row {
  return { id: "back", label, icon: "back.png" };
}

function applyRow(label: string): Row {
  return { id: "apply", label, icon: "apply.png" };
}

export function modeOptions(which: "v4" | "v6", lang: string): { id: string; label: string }[] {
  const c = copy(lang);
  if (which === "v4") {
    return [
      { id: "dhcp", label: c.dhcp },
      { id: "static", label: c.static },
    ];
  }
  return [
    { id: "slaac", label: c.slaac },
    { id: "static", label: c.static },
  ];
}

const TZ_FILTERS = ["all", "UTC", "Asia", "Europe", "America", "Australia"] as const;

export function tzFilterOptions(lang: string): { id: string; label: string }[] {
  const c = copy(lang);
  const labels: Record<(typeof TZ_FILTERS)[number], string> = {
    all: c.all,
    UTC: "UTC",
    Asia: c.asia,
    Europe: c.europe,
    America: c.america,
    Australia: c.australia,
  };
  return TZ_FILTERS.map((id) => ({ id, label: labels[id] }));
}

export function tzFilterChrome(lang: string, filter: string): { title: string; value: string } {
  const options = tzFilterOptions(lang);
  return {
    title: copy(lang).filter,
    value: options.find((item) => item.id === filter)?.label ?? options[0].label,
  };
}

export function tzZones(filter: string): readonly string[] {
  if (!filter || filter === "all") return TIMEZONE_IDS;
  return TIMEZONE_IDS.filter((id) => id === filter || id.startsWith(`${filter}/`));
}

export function drawerOptions(which: "v4" | "v6" | "tz", lang: string): { id: string; label: string }[] {
  if (which === "tz") return tzFilterOptions(lang);
  return modeOptions(which, lang);
}

function modeValue(which: "v4" | "v6", mode: string, lang: string): string {
  return modeOptions(which, lang).find((item) => item.id === mode)?.label ?? mode;
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

/** Dotted mask for a prefix length. 0 is 0.0.0.0; 32 is 255.255.255.255. */
export function prefixToMask(prefix: number): string {
  const n = Math.max(0, Math.min(32, Math.floor(prefix)));
  if (n === 0) return "0.0.0.0";
  const bits = (0xffffffff << (32 - n)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (bits >>> shift) & 255).join(".");
}

/** Prefix length of a contiguous dotted mask, or null when the mask is not a prefix. */
export function maskToPrefix(mask: string): number | null {
  const nums = ipv4Octets(mask);
  if (!nums) return null;
  const bits = (((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0);
  let prefix = 0;
  let zero = false;
  for (let i = 31; i >= 0; i--) {
    if ((bits >>> i) & 1) {
      if (zero) return null;
      prefix += 1;
    } else {
      zero = true;
    }
  }
  return prefix;
}

/** Split a stored CIDR (`192.168.1.10/24` or `/24`) into an address and a dotted mask. */
export function v4Parts(addr: string): { ip: string; mask: string } {
  const raw = addr.trim();
  const slash = raw.indexOf("/");
  const ip = (slash >= 0 ? raw.slice(0, slash) : raw).trim();
  let prefix = 24;
  if (slash >= 0) {
    const n = Number(raw.slice(slash + 1));
    if (Number.isInteger(n) && n >= 0 && n <= 32) prefix = n;
  }
  return { ip, mask: prefixToMask(prefix) };
}

/** CIDR sent as ipv4_address. A mask remembered before the address stays off the wire. */
export function v4Wire(addr: string): string {
  const parts = v4Parts(addr);
  if (!ipv4Octets(parts.ip)) return "";
  const prefix = maskToPrefix(parts.mask) ?? 24;
  return `${parts.ip}/${prefix}`;
}

export function pageRows(s: PageState): Row[] {
  const c = copy(s.lang);
  if (s.step === "welcome") return [];
  if (s.step === "language") {
    return [
      { id: "lang:zh", label: "简体中文" },
      { id: "lang:en", label: "English" },
      { id: "lang:zh_tw", label: "繁體中文" },
      backRow(c.back),
    ];
  }
  if (s.step === "timezone") {
    return [
      ...tzZones(s.tzFilter).map((id) => ({ id: `tz:${id}`, label: id })),
      backRow(c.back),
    ];
  }
  if (s.step === "blank") {
    return [
      { id: "blank:0", label: c.never },
      { id: "blank:30", label: c.s30 },
      { id: "blank:60", label: c.m1 },
      { id: "blank:300", label: c.m5 },
      { id: "blank:custom", label: c.custom },
      backRow(c.back),
    ];
  }
  if (s.step === "network") {
    if (s.v4page) {
      const parts = v4Parts(s.v4addr);
      return [
        { id: "v4ip", label: "IP", value: parts.ip },
        { id: "v4mask", label: c.mask, value: parts.mask },
        { id: "v4gw", label: c.gateway, value: s.v4gw },
        { id: "dns", label: c.dns, value: s.dns },
        backRow(c.back),
      ];
    }
    if (s.advanced) {
      const rows: Row[] = [{ id: "v4", label: "IPv4", value: modeValue("v4", s.v4, s.lang) }];
      if (s.v4 === "static") {
        rows.push({ id: "v4set", label: c.v4settings, value: v4Parts(s.v4addr).ip });
      }
      rows.push({ id: "v6", label: "IPv6", value: modeValue("v6", s.v6, s.lang) });
      if (s.v6 === "static") {
        rows.push({ id: "v6addr", label: c.address, value: s.v6addr });
        rows.push({ id: "v6pre", label: c.prefix, value: s.v6prefix });
        rows.push({ id: "v6gw", label: c.gateway, value: s.v6gw });
      }
      rows.push({ id: "vlan", label: "VLAN", value: s.vlan });
      if (s.v4 !== "static") rows.push({ id: "dns", label: c.dns, value: s.dns });
      rows.push(applyRow(c.apply));
      rows.push(backRow(c.back));
      return rows;
    }
    if (s.wifiPage) {
      const rows: Row[] = [];
      if (s.wifi) {
        if (s.busy && s.aps.length === 0) {
          rows.push({ id: "scanning", label: c.scanning });
        }
        s.aps.forEach((ap, index) => {
          rows.push({
            id: `ap:${index}`,
            label: ap.ssid,
            tags: apTags(ap, s.lang, s.wifiGeneration),
          });
        });
        if (!s.busy && s.aps.length === 0) {
          rows.push({ id: "empty", label: c.noNetworks });
        }
        rows.push({ id: "hidden", label: c.hidden });
      } else {
        rows.push({ id: "nowifi", label: c.nowifi });
      }
      rows.push(backRow(c.back));
      return rows;
    }
    const rows: Row[] = s.links.map((link) => {
      const card = linkCard(link, s);
      return {
        id: `link:${link.name}`,
        label: link.name,
        value: card.value,
        detail: card.detail,
      };
    });
    rows.push({ id: "next", label: c.next, icon: "forward.png" });
    rows.push(backRow(c.back));
    return rows;
  }
  const cpass = copy(s.lang);
  return [
    { id: "username", label: cpass.username, value: s.username },
    { id: "pass1", label: cpass.password, value: mask(s.pass1) },
    { id: "pass2", label: cpass.confirm, value: mask(s.pass2) },
    { id: "auth", label: s.busy ? cpass.wait : cpass.done, icon: "apply.png" },
    backRow(cpass.back),
  ];
}

const FIND_HOST = "find.onekvm.org";

/** With an address: the find host, then that address. Each row carries the internet glyph. */
export function welcomeHintLines(_lang: string, ip: string, _width = 0): string[] {
  if (!ip) return [];
  return [FIND_HOST, ip];
}

type WelcomeBox = {
  logo: { x: number; y: number; w: number; h: number };
  next: { x: number; y: number; w: number; h: number; size: number };
  hint: { x: number; y: number; w: number; h: number; line: number; align: "center" | "start" } | null;
};

/**
 * Space kept clear along the panel edges. Go's 284x240 panel has rounded
 * corners; 12 px on both edges keeps a corner radius up to 40 px off content.
 */
export const EDGE = 12;

function welcomeSplit(scr: { w: number; h: number }, bottom: number): WelcomeBox {
  const margin = EDGE;
  const size = 48;
  const nextW = Math.max(size, scr.w - margin * 2);
  const nextY = Math.max(0, scr.h - Math.max(margin, bottom) - size);
  const top = 8;
  const bandH = Math.max(22, nextY - 8 - top);
  const gap = 12;
  const line = 22;
  const count = welcomeHintLines("en", "0.0.0.0", scr.w).length;
  const hintH = count * line;
  let logoH = Math.min(bandH, 88);
  let logoW = logoH * 2;
  const maxLogoW = Math.max(64, Math.round(scr.w * 0.42));
  if (logoW > maxLogoW) {
    logoW = maxLogoW;
    logoH = Math.max(1, Math.round(logoW / 2));
  }
  const hintX = margin + logoW + gap;
  const hintW = Math.max(40, scr.w - margin - hintX);
  const logoY = top + Math.max(0, Math.round((bandH - logoH) / 2));
  const hintY = top + Math.max(0, Math.round((bandH - hintH) / 2));
  return {
    logo: { x: margin, y: logoY, w: logoW, h: logoH },
    next: {
      x: Math.round((scr.w - nextW) / 2),
      y: nextY,
      w: nextW,
      h: size,
      size,
    },
    hint: { x: hintX, y: hintY, w: hintW, h: hintH, line, align: "start" },
  };
}

/** Where the wordmark sits in src/logo.png (256x128); the rest is transparent. */
const LOGO_INK_TOP = 40 / 128;
const LOGO_INK_H = 48 / 128;
const LOGO_INK_CENTRE = 121.5 / 256;

/**
 * Landscape panels whose welcome face stacks: logo, addresses and the split
 * layout's button, centred, with equal visible gaps above the wordmark,
 * between it and the addresses, and above the button.
 */
function welcomeColumn(scr: { w: number; h: number }, bottom: number): WelcomeBox {
  const split = welcomeSplit(scr, bottom);
  const line = 22;
  const hintH = welcomeHintLines("en", "0.0.0.0", scr.w).length * line;
  const room = split.next.y - EDGE - hintH;
  const minGap = 8;
  let logoW = Math.min(208, scr.w - EDGE * 2);
  let logoH = Math.round(logoW / 2);
  if (logoH * LOGO_INK_H > room - minGap * 3) {
    logoH = Math.max(2, Math.floor((room - minGap * 3) / LOGO_INK_H));
    logoW = logoH * 2;
  }
  const ink = Math.round(logoH * LOGO_INK_H);
  const gap = Math.max(0, Math.floor((room - ink) / 3));
  const inkY = EDGE + gap;
  return {
    logo: {
      // Centre the wordmark, which sits slightly left in the texture.
      x: Math.round(scr.w / 2 - logoW * LOGO_INK_CENTRE),
      y: Math.max(0, Math.round(inkY - logoH * LOGO_INK_TOP)),
      w: logoW,
      h: logoH,
    },
    next: split.next,
    hint: { x: EDGE, y: inkY + ink + gap, w: scr.w - EDGE * 2, h: hintH, line, align: "center" },
  };
}

/** Welcome faces rotate on this period while an access point is on the air. */
export const WELCOME_FACE_MS = 20000;
/** Bottom strip holding the page dots and the switch countdown. */
export const WELCOME_PAGER_H = 28;

/** Space the faces keep free at the bottom edge for the page dots. */
export function welcomeBottom(pages: number): number {
  return pages > 1 ? WELCOME_PAGER_H : 0;
}

export type WelcomePager = {
  /** Centre of each page dot; the current one carries the countdown ring. */
  dots: { x: number; y: number }[];
  ring: number;
  dot: number;
  /** Tap target: the bottom strip around the dots. */
  hit: { x: number; y: number; w: number; h: number };
};

/** Page dots side by side at the bottom centre, clear of the rounded corners. */
export function welcomePager(scr: { w: number; h: number }, pages: number): WelcomePager {
  const pitch = 26;
  const y = scr.h - Math.round(WELCOME_PAGER_H / 2);
  const first = Math.round(scr.w / 2 - ((pages - 1) * pitch) / 2);
  const hitW = Math.min(scr.w - EDGE * 4, Math.max(96, pages * pitch + 48));
  return {
    dots: Array.from({ length: pages }, (_, index) => ({ x: first + index * pitch, y })),
    ring: 18,
    dot: 6,
    hit: { x: Math.round((scr.w - hitW) / 2), y: scr.h - WELCOME_PAGER_H, w: hitW, h: WELCOME_PAGER_H },
  };
}

export function welcomeFaceAt(elapsedMs: number, pages: number): number {
  return welcomeFaceIndex(0, elapsedMs, pages);
}

/** Page after `elapsedMs`, counting forward from `origin`. */
export function welcomeFaceIndex(origin: number, elapsedMs: number, pages: number): number {
  if (pages <= 1) return 0;
  const start = ((Math.trunc(origin) % pages) + pages) % pages;
  const slot = Math.floor(Math.max(0, elapsedMs) / WELCOME_FACE_MS);
  return (start + slot) % pages;
}

/** One detent moves one page. Positive delta goes forward. */
export function welcomeKnobFace(current: number, delta: number, pages: number): number {
  if (pages <= 1 || !Number.isFinite(delta) || delta === 0) {
    if (pages <= 1) return 0;
    return ((Math.trunc(current) % pages) + pages) % pages;
  }
  const at = ((Math.trunc(current) % pages) + pages) % pages;
  const step = delta > 0 ? 1 : pages - 1;
  return (at + step) % pages;
}

/** A horizontal swipe turns the page like a detent: leftward goes forward. */
export function welcomeSwipeFace(current: number, dx: number, dy: number, pages: number): number | null {
  if (pages <= 1 || Math.abs(dx) < 28 || Math.abs(dx) <= Math.abs(dy)) return null;
  return welcomeKnobFace(current, dx < 0 ? 1 : -1, pages);
}

/** 0 at the start of a face, 1 at the moment it switches. */
export function welcomeFaceProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return (elapsedMs % WELCOME_FACE_MS) / WELCOME_FACE_MS;
}

/** QR modules of white kept around the code, as the QR specification asks. */
export const AP_QUIET = 4;
/** Narrowest text column beside the code on a wide or square panel. */
const AP_TEXT_MIN = 96;
const AP_GAP = 10;
/** Atlas slots: 12 px labels, 14 px and 16 px values, 14 px bold title. */
export const AP_SLOT = { label: 0, small: 1, value: 2, title: 8 } as const;
const AP_LINE: Record<number, number> = { 0: 16, 1: 19, 2: 22, 8: 19 };
const AP_PX: Record<number, number> = { 0: 12, 1: 14, 2: 16, 8: 14 };

export type TextMeasure = (text: string, slot: number) => number;

/** Fallback width when the host cannot measure: CJK is square, Latin about 0.62 em. */
export function estimateText(text: string, slot: number): number {
  const px = AP_PX[slot] ?? 16;
  let width = 0;
  for (const char of text) width += char.codePointAt(0)! >= 0x2e80 ? px : px * 0.62;
  return Math.ceil(width);
}

/** Break at spaces when a word fits, otherwise between characters. */
export function wrapText(text: string, width: number, slot: number, measure: TextMeasure): string[] {
  const out: string[] = [];
  let line = "";
  const push = (piece: string) => {
    for (const char of piece) {
      if (line && measure(line + char, slot) > width) {
        out.push(line.trimEnd());
        line = char === " " ? "" : char;
      } else line += char;
    }
  };
  for (const word of text.split(/(?<= )/)) {
    if (line && measure(line + word, slot) > width && measure(word.trimEnd(), slot) <= width) {
      out.push(line.trimEnd());
      line = "";
    }
    push(word);
  }
  if (line) out.push(line.trimEnd());
  return out.length ? out : [""];
}

export type ApCopy = { title: string; ssidLabel: string; passwordLabel: string; ssid: string; password: string };
export type ApLine = { text: string; x: number; y: number; slot: number; tone: "title" | "label" | "value" };
export type ApFaceBox = {
  qr: { x: number; y: number; size: number; module: number };
  lines: ApLine[];
};

type ApBlock = { lines: ApLine[]; w: number; h: number };

/**
 * Network name and password. Values use 16 px, then 14 px, then 12 px while
 * they fit on one line, and wrap at 14 px (12 px when `dense`) only when even
 * 12 px does not fit. `inline` puts each label in front of its value when both rows fit.
 */
function apBlock(copy: ApCopy, width: number, measure: TextMeasure, title: boolean, inline: boolean, dense = false): ApBlock {
  const rows = [[copy.ssidLabel, copy.ssid], [copy.passwordLabel, copy.password]];
  const labelW = Math.max(...rows.map(([label]) => measure(label, AP_SLOT.label))) + 8;
  const fits = (slot: number, room: number) => rows.every(([, value]) => measure(value, slot) <= room);
  const pick = (room: number) => [AP_SLOT.value, AP_SLOT.small, AP_SLOT.label].find((slot) => fits(slot, room));
  const side = inline ? pick(width - labelW) : undefined;
  const slot = side ?? pick(width) ?? (dense ? AP_SLOT.label : AP_SLOT.small);
  const lines: ApLine[] = [];
  let y = 0;
  let w = 0;
  const add = (text: string, x: number, slot: number, tone: ApLine["tone"]) => {
    lines.push({ text, x, y, slot, tone });
    w = Math.max(w, x + measure(text, slot));
  };
  if (title) {
    for (const line of wrapText(copy.title, width, AP_SLOT.title, measure)) {
      add(line, 0, AP_SLOT.title, "title");
      y += AP_LINE[AP_SLOT.title];
    }
    y += 6;
  }
  rows.forEach(([label, value], index) => {
    if (index) y += 6;
    if (side !== undefined) {
      const lineH = AP_LINE[slot];
      lines.push({ text: label, x: 0, y: y + lineH - AP_LINE[AP_SLOT.label] - 1, slot: AP_SLOT.label, tone: "label" });
      add(value, labelW, slot, "value");
      y += lineH;
      return;
    }
    add(label, 0, AP_SLOT.label, "label");
    y += AP_LINE[AP_SLOT.label];
    for (const line of wrapText(value, width, slot, measure)) {
      add(line, 0, slot, "value");
      y += AP_LINE[slot];
    }
  });
  return { lines, w: Math.min(width, Math.ceil(w)), h: y };
}

function shift(block: ApBlock, x: number, y: number): ApLine[] {
  return block.lines.map((line) => ({ ...line, x: line.x + x, y: line.y + y }));
}

/**
 * Setup hotspot face. A wide or square panel puts the code on the left and
 * the text beside it; a tall panel stacks the title, the code and the text.
 * The code takes the largest whole-pixel module that leaves the text room.
 * `bottom` is kept free for the page dots.
 */
export function apFaceLayout(
  box: { w: number; h: number },
  modules: number,
  copy: ApCopy,
  measure: TextMeasure = estimateText,
  bottom = 0,
): ApFaceBox {
  const span = Math.max(21, modules) + AP_QUIET * 2;
  const top = EDGE;
  const availH = Math.max(span, box.h - top - Math.max(EDGE, bottom));
  if (box.w >= box.h) {
    let module = Math.max(1, Math.floor(availH / span));
    let block: ApBlock;
    for (;; module--) {
      // The text column ends away from the corners, so 8 px is enough there.
      const textW = box.w - EDGE - module * span - AP_GAP - 8;
      if (textW < AP_TEXT_MIN && module > 2) continue;
      block = apBlock(copy, textW, measure, true, false);
      if (block.h <= availH) break;
      block = apBlock(copy, textW, measure, true, false, true);
      if (block.h <= availH) break;
      if (module <= 2) {
        // Very long credentials: the code already says what to do.
        block = apBlock(copy, textW, measure, false, false, true);
        break;
      }
    }
    const size = module * span;
    // Centre the code and the text as one group.
    const left = Math.max(EDGE, Math.round((box.w - size - AP_GAP - block.w) / 2));
    const textY = top + Math.max(0, Math.round((availH - block.h) / 2));
    return {
      qr: { x: left, y: top + Math.round((availH - size) / 2), size, module },
      lines: shift(block, left + size + AP_GAP, textY),
    };
  }
  const width = box.w - EDGE * 2;
  const titleLines = wrapText(copy.title, width, AP_SLOT.title, measure);
  const titleH = titleLines.length * AP_LINE[AP_SLOT.title];
  const gap = 8;
  let block = apBlock(copy, width, measure, false, true);
  // Keep at least a 2 px module; long credentials drop to 12 px first.
  if (availH - titleH - gap * 2 - block.h < span * 2) block = apBlock(copy, width, measure, false, true, true);
  const room = availH - titleH - gap * 2 - block.h;
  const module = Math.max(1, Math.floor(Math.min(width, room) / span));
  const size = module * span;
  const total = titleH + gap + size + gap + block.h;
  let y = top + Math.max(0, Math.round((availH - total) / 2));
  const lines: ApLine[] = titleLines.map((text, index) => ({
    text,
    x: Math.round((box.w - measure(text, AP_SLOT.title)) / 2),
    y: y + index * AP_LINE[AP_SLOT.title],
    slot: AP_SLOT.title,
    tone: "title",
  }));
  y += titleH + gap;
  const qr = { x: Math.round((box.w - size) / 2), y, size, module };
  y += size + gap;
  return { qr, lines: [...lines, ...shift(block, Math.round((box.w - block.w) / 2), y)] };
}

/**
 * Logo stays clear of the forward control.
 * A wide machine with `welcome: "split"` puts the logo on the left and the
 * address on the right. A square screen keeps the logo centered above them.
 * `bottom` is kept free below the forward control for the page dots.
 */
export function welcomeLayout(
  scr: { w: number; h: number },
  hint = false,
  arrange?: "split" | "stack",
  bottom = 0,
): WelcomeBox {
  const landscape = scr.w > scr.h;
  const split =
    hint &&
    (arrange === "split" ||
      (arrange !== "stack" && landscape && layoutFor(scr).welcome === "split"));
  if (split) return welcomeSplit(scr, bottom);
  if (hint && landscape) return welcomeColumn(scr, bottom);
  let logoW = Math.min(Math.max(40, scr.w - 24), 208);
  // src/logo.png is a 256x128 texture; the wordmark sits in the middle of it.
  let logoH = Math.max(1, Math.round(logoW / 2));
  const size = 56;
  const margin = 16;
  const nextW = Math.max(size, scr.w - margin * 2);
  const nextY = Math.max(0, scr.h - Math.max(margin, bottom) - size);
  let logoLimit = nextY - 8;
  let hintBox: WelcomeBox["hint"] = null;
  if (hint) {
    const line = 22;
    const count = welcomeHintLines("en", "0.0.0.0", scr.w).length;
    const gap = 6;
    const h = count * line;
    const y = nextY - gap - h;
    hintBox = { x: 8, y, w: Math.max(40, scr.w - 16), h, line, align: "center" };
    logoLimit = y - gap;
  }
  const top = hint ? 4 : 8;
  let logoY = Math.round((scr.h - logoH) / 2);
  if (logoY + logoH > logoLimit) logoY = Math.max(top, logoLimit - logoH);
  if (logoY + logoH > logoLimit) {
    logoH = Math.max(1, logoLimit - top);
    logoW = Math.max(40, Math.min(logoW, logoH * 2));
    logoH = Math.max(1, Math.round(logoW / 2));
    if (top + logoH > logoLimit) {
      logoH = Math.max(1, logoLimit - top);
      logoW = Math.max(40, logoH * 2);
    }
    logoY = top;
  }
  return {
    logo: {
      x: Math.round((scr.w - logoW) / 2),
      y: logoY,
      w: logoW,
      h: logoH,
    },
    next: {
      x: Math.round((scr.w - nextW) / 2),
      y: nextY,
      w: nextW,
      h: size,
      size,
    },
    hint: hintBox,
  };
}

export function titleOf(step: Step, lang: string, advanced = false, v4page = false, wifiPage = false, linkName = ""): string {
  const c = copy(lang);
  if (step === "welcome") return "";
  if (step === "language") return c.language;
  if (step === "timezone") return c.timezone;
  if (step === "blank") return c.blank;
  if (step === "network") {
    if (v4page) return c.v4settings;
    if (wifiPage) return linkName || c.wireless;
    if (advanced) return linkName || c.wired;
    return c.network;
  }
  return c.account;
}

export function mask(value: string): string {
  return "*".repeat(Array.from(value).length);
}

export type Action =
  | { type: "language"; id: Lang }
  | { type: "timezone"; id: string }
  | { type: "blank"; seconds: number }
  | { type: "keyboard"; kind: KeyKind; target: string; secret: boolean; max: number; initial: string }
  | { type: "config"; name: string }
  | { type: "close-config" }
  | { type: "wifi-open"; name: string }
  | { type: "close-wifi" }
  | { type: "v4-settings" }
  | { type: "close-v4" }
  | { type: "drawer"; which: "v4" | "v6" }
  | { type: "wifi"; ssid: string; password: string }
  | { type: "alert"; code: string }
  | { type: "apply" }
  | { type: "next" }
  | { type: "back" }
  | { type: "auth" }
  | { type: "noop" };

export function decide(s: PageState, rowId: string): Action {
  if (rowId === "back") {
    if (s.step === "network" && s.v4page) return { type: "close-v4" };
    if (s.step === "network" && s.wifiPage) return { type: "close-wifi" };
    if (s.step === "network" && s.advanced) return { type: "close-config" };
    return { type: "back" };
  }
  if (s.step === "language") {
    if (rowId === "lang:zh" || rowId === "lang:en" || rowId === "lang:zh_tw") {
      return { type: "language", id: rowId.slice(5) as Lang };
    }
    return { type: "noop" };
  }
  if (s.step === "timezone") {
    if (rowId.startsWith("tz:")) return { type: "timezone", id: rowId.slice(3) };
    return { type: "noop" };
  }
  if (s.step === "blank") {
    if (rowId === "blank:custom") {
      return { type: "keyboard", kind: "number", target: "blankCustom", secret: false, max: 6, initial: "" };
    }
    if (rowId.startsWith("blank:")) {
      const seconds = Number(rowId.slice(6));
      if (Number.isFinite(seconds)) return { type: "blank", seconds };
    }
    return { type: "noop" };
  }
  if (s.step === "network") {
    if (rowId === "nowifi" || rowId === "scanning" || rowId === "empty" || rowId === "noop") {
    return { type: "noop" };
  }
    if (rowId.startsWith("link:")) {
      const name = rowId.slice(5);
      const link = s.links.find((item) => item.name === name);
      if (!link) return { type: "noop" };
      if (link.kind === "wifi") return { type: "wifi-open", name };
      return { type: "config", name };
    }
    if (rowId === "eth" || rowId === "advanced") return { type: "config", name: "" };
    if (rowId === "wifi") return { type: "wifi-open", name: "" };
    if (rowId === "next") return { type: "next" };
    if (rowId === "v4") return { type: "drawer", which: "v4" };
    if (rowId === "v6") return { type: "drawer", which: "v6" };
    if (rowId === "v4set") return { type: "v4-settings" };
    if (rowId === "apply") return { type: "apply" };
    if (rowId === "hidden") {
      return { type: "keyboard", kind: "text", target: "hiddenSsid", secret: false, max: 32, initial: "" };
    }
    if (rowId === "v4ip" || rowId === "v4mask") {
      const parts = v4Parts(s.v4addr);
      return {
        type: "keyboard",
        kind: "ipv4",
        target: rowId,
        secret: false,
        max: 15,
        initial: rowId === "v4ip" ? parts.ip : parts.mask,
      };
    }
    if (rowId === "v4gw" || rowId === "dns") {
      return {
        type: "keyboard",
        kind: "ipv4",
        target: rowId,
        secret: false,
        max: 15,
        initial: rowId === "v4gw" ? s.v4gw : s.dns,
      };
    }
    if (rowId === "v6addr" || rowId === "v6gw") {
      const initial = rowId === "v6addr" ? s.v6addr : s.v6gw;
      return { type: "keyboard", kind: "ipv6", target: rowId, secret: false, max: 39, initial };
    }
    if (rowId === "v6pre") {
      return { type: "keyboard", kind: "number", target: "v6pre", secret: false, max: 3, initial: s.v6prefix };
    }
    if (rowId === "vlan") {
      return { type: "keyboard", kind: "number", target: "vlan", secret: false, max: 4, initial: s.vlan };
    }
    if (rowId.startsWith("ap:")) {
      const ap = s.aps[Number(rowId.slice(3))];
      if (!ap) return { type: "noop" };
      // Core joins protected networks over WPA-PSK, which SAE-only networks refuse.
      if (ap.security === "wpa3") return { type: "alert", code: "wifi-wpa3" };
      if (!ap.secure) return { type: "wifi", ssid: ap.ssid, password: "" };
      return { type: "keyboard", kind: "text", target: `wifi:${ap.ssid}`, secret: true, max: 64, initial: "" };
    }
    return { type: "noop" };
  }
  if (rowId === "username") {
    return { type: "keyboard", kind: "text", target: "username", secret: false, max: 64, initial: s.username };
  }
  if (rowId === "pass1") {
    return { type: "keyboard", kind: "text", target: "pass1", secret: true, max: 128, initial: s.pass1 };
  }
  if (rowId === "pass2") {
    return { type: "keyboard", kind: "text", target: "pass2", secret: true, max: 128, initial: s.pass2 };
  }
  if (rowId === "auth") return { type: "auth" };
  return { type: "noop" };
}

/** Title band of a list step: text lines up with the row text, step dots sit at the right. */
export const TITLE_X = 20;

export type StepDots = { dots: { x: number; y: number; state: "done" | "current" | "next" }[]; size: number; right: number };

/** One dot per step after the welcome; `right` is the band width they take from the right edge. */
export function stepDots(step: Step, width: number): StepDots {
  const steps = STEPS.slice(1);
  const at = steps.indexOf(step as (typeof steps)[number]);
  const pitch = 10;
  const size = 6;
  const last = width - TITLE_X - size / 2;
  return {
    dots: steps.map((_, index) => ({
      x: last - (steps.length - 1 - index) * pitch,
      y: Math.round(LIST_TOP / 2),
      state: index < at ? "done" : index === at ? "current" : "next",
    })),
    size,
    right: TITLE_X + (steps.length - 1) * pitch + size + 8,
  };
}

export function nextStep(step: Step): Step {
  const index = STEPS.indexOf(step);
  return STEPS[Math.min(STEPS.length - 1, index + 1)];
}

export function prevStep(step: Step): Step | null {
  const index = STEPS.indexOf(step);
  if (index <= 0) return null;
  return STEPS[index - 1];
}

export type Commit =
  | { type: "blank"; seconds: number }
  | { type: "ask-pass"; ssid: string }
  | { type: "wifi"; ssid: string; password: string }
  | { type: "field"; key: string; value: string }
  | { type: "error"; code: string };

export function commitValue(target: string, value: string, pass1: string, current = ""): Commit {
  if (target === "username") {
    const username = value.trim();
    if (!username || username.length > 64) return { type: "error", code: "username" };
    return { type: "field", key: "username", value: username };
  }
  if (target === "blankCustom") {
    const n = Number(value.trim() || "0");
    if (!Number.isFinite(n) || n < 0) return { type: "error", code: "blank" };
    return { type: "blank", seconds: Math.min(86400, Math.floor(n)) };
  }
  if (target === "hiddenSsid") {
    const ssid = value.trim();
    if (!ssid) return { type: "error", code: "ssid" };
    return { type: "ask-pass", ssid };
  }
  if (target.startsWith("wifi:")) {
    return { type: "wifi", ssid: target.slice(5), password: value };
  }
  if (target === "v4ip" || target === "v4mask") {
    const parts = v4Parts(current);
    if (target === "v4ip") {
      const ip = value.trim();
      if (ip && !ipv4Octets(ip)) return { type: "error", code: "address" };
      const prefix = maskToPrefix(parts.mask) ?? 24;
      const stored = ip ? `${ip}/${prefix}` : current.includes("/") ? `/${prefix}` : "";
      return { type: "field", key: "v4addr", value: stored };
    }
    const prefix = maskToPrefix(value.trim());
    if (prefix === null) return { type: "error", code: "mask" };
    const stored = parts.ip ? `${parts.ip}/${prefix}` : `/${prefix}`;
    return { type: "field", key: "v4addr", value: stored };
  }
  if (target === "v4gw" || target === "dns") {
    const ip = value.trim();
    if (ip && !ipv4Octets(ip)) return { type: "error", code: target === "dns" ? "dns" : "gateway" };
    return { type: "field", key: target, value: ip };
  }
  if (target === "v6pre") {
    const n = Number(value.trim() || "0");
    if (!Number.isFinite(n)) return { type: "error", code: "prefix" };
    const prefix = Math.max(0, Math.min(128, Math.floor(n)));
    return { type: "field", key: "v6pre", value: String(prefix) };
  }
  if (target === "vlan") {
    const raw = value.trim();
    if (!raw) return { type: "field", key: "vlan", value: "" };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 4094) return { type: "error", code: "vlan" };
    return { type: "field", key: "vlan", value: String(n) };
  }
  if (target === "pass2") {
    if (value !== pass1) return { type: "error", code: "mismatch" };
    const n = Array.from(value).length;
    if (n < 8 || n > 128) return { type: "error", code: "short" };
    return { type: "field", key: "pass2", value };
  }
  return { type: "field", key: target, value };
}

export function authAllowed(username: string, pass1: string, pass2: string): "ok" | "username" | "short" | "mismatch" {
  if (!username.trim() || username.trim().length > 64) return "username";
  if (pass1 !== pass2) return "mismatch";
  const n = Array.from(pass1).length;
  if (n < 8 || n > 128) return "short";
  return "ok";
}

export function applyAllowed(nfs: boolean): boolean {
  return !nfs;
}

export function vlanNumber(raw: string): number {
  const text = raw.trim();
  if (!text) return 0;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 4094) return 0;
  return n;
}

export function netBody(s: {
  parent: string;
  vlan: string;
  v4: string;
  v4addr: string;
  v4gw: string;
  v6: string;
  v6addr: string;
  v6prefix: string;
  v6gw: string;
  dns: string;
}): string {
  const prefix = Number(s.v6prefix);
  return JSON.stringify({
    parent: s.parent || "eth0",
    vlan_id: vlanNumber(s.vlan),
    ipv4_mode: s.v4 === "static" ? "static" : "dhcp",
    ipv4_address: v4Wire(s.v4addr),
    ipv4_gateway: s.v4gw,
    ipv6_mode: s.v6 === "static" ? "static" : "slaac",
    ipv6_address: s.v6addr,
    ipv6_prefix: Number.isFinite(prefix) ? Math.max(0, Math.min(128, Math.floor(prefix))) : 64,
    ipv6_gateway: s.v6gw,
    dns: s.dns,
  });
}

/** Name shown above the keyboard preview for the field being edited. */
export function fieldLabel(target: string, lang: string): string {
  const c = copy(lang);
  if (target === "username") return c.username;
  if (target === "pass1" || target.startsWith("wifi:")) return c.password;
  if (target === "pass2") return c.confirm;
  if (target === "v4ip") return "IP";
  if (target === "v4mask") return c.mask;
  if (target === "v4addr" || target === "v6addr") return c.address;
  if (target === "v4gw" || target === "v6gw") return c.gateway;
  if (target === "dns") return c.dns;
  if (target === "v6pre") return c.prefix;
  if (target === "vlan") return "VLAN";
  if (target === "blankCustom") return c.blank;
  if (target === "hiddenSsid") return c.hidden;
  return "";
}

export function wifiBody(ssid: string, password: string): string {
  return JSON.stringify({ ssid, password });
}

export function authBody(username: string, password: string, language: string): string {
  return JSON.stringify({ username: username.trim(), password, language, timezone: "UTC" });
}

const SECURITIES = new Set(["open", "wep", "wpa", "wpa2", "wpa3", "wpa2-wpa3", "owe"]);

export function apTags(ap: NetAp, lang: string, radioGeneration = ""): string[] {
  const tags: string[] = [];
  if (radioGeneration) tags.push(radioGeneration);
  const bands = [...(ap.bands ?? [])].sort((a, b) => bandOrder(a) - bandOrder(b));
  for (const band of bands) {
    if (band === "2.4") tags.push("2.4G");
    else if (band === "5") tags.push("5G");
    else if (band === "6") tags.push("6G");
    else if (band) tags.push(band);
  }
  tags.push(ap.connected ? copy(lang).wifiOk : securityTag(ap, lang));
  return tags.filter((tag) => tag !== "");
}

function bandOrder(band: string): number {
  if (band === "2.4") return 0;
  if (band === "5") return 1;
  if (band === "6") return 2;
  return 3;
}

function securityTag(ap: NetAp, lang: string): string {
  switch (ap.security) {
    case "open":
      return copy(lang).open;
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
      return ap.secure ? "" : copy(lang).open;
  }
}

export function parseScan(raw: string): NetAp[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: NetAp[] = [];
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
      const generation = typeof rec.generation === "string" ? rec.generation : "";
      const secure = security ? security !== "open" && security !== "owe" : !!rec.secure;
      out.push({
        ssid: rec.ssid,
        secure,
        ...(security ? { security } : {}),
        ...(bands.length ? { bands } : {}),
        ...(generation ? { generation } : {}),
        ...(rec.connected === true ? { connected: true } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function panScroll(current: number, dy: number, count: number, viewH: number): number {
  const max = Math.max(0, Math.max(0, count) * ROW_PITCH - viewH);
  let next = current - dy;
  if (next < 0) return 0;
  if (next > max) return max;
  return next;
}

export function revealScroll(current: number, index: number, count: number, viewH: number): number {
  const max = Math.max(0, Math.max(0, count) * ROW_PITCH - viewH);
  const top = Math.max(0, index) * ROW_PITCH;
  const bottom = top + ROW_H;
  let next = current;
  if (top < next) next = top;
  else if (bottom > next + viewH) next = bottom - viewH;
  if (next < 0) return 0;
  if (next > max) return max;
  return next;
}

export function scrollOf(focus: number, count: number, viewH: number, pitch = ROW_PITCH): number {
  const content = Math.max(0, count) * pitch;
  const max = Math.max(0, content - viewH);
  const target = focus * pitch - Math.floor(viewH / 3);
  return Math.max(0, Math.min(max, target));
}

export function bodyCountOf(rowCount: number): number {
  return Math.max(0, rowCount - 1);
}

export function listPinned(listH: number, bodyCount: number): boolean {
  return bodyCount * ROW_PITCH + ROW_PITCH > listH;
}

export function footerInset(listH: number, bodyCount: number): number {
  if (!listPinned(listH, bodyCount)) return Math.max(0, bodyCount) * ROW_PITCH;
  return Math.max(0, listH - ROW_PITCH);
}

export function bodyViewH(listH: number, bodyCount: number): number {
  if (!listPinned(listH, bodyCount)) return listH;
  return Math.max(ROW_PITCH, listH - ROW_PITCH);
}

export function hitRow(
  x: number,
  y: number,
  width: number,
  listH: number,
  focus: number,
  rowCount: number,
): number {
  if (rowCount <= 0 || width <= 16) return -1;
  if (y < LIST_TOP || y >= LIST_TOP + listH) return -1;
  if (x < 8 || x >= width - 8) return -1;
  const body = bodyCountOf(rowCount);
  const inset = footerInset(listH, body);
  if (y >= LIST_TOP + inset && y < LIST_TOP + inset + ROW_H) return rowCount - 1;
  const viewH = bodyViewH(listH, body);
  if (y >= LIST_TOP + viewH) return -1;
  const scroll = scrollOf(focus, body, viewH);
  const index = Math.floor((y - LIST_TOP + scroll) / ROW_PITCH);
  if (index < 0 || index >= body) return -1;
  const rowTop = LIST_TOP + index * ROW_PITCH - scroll;
  if (y < rowTop || y >= rowTop + ROW_H) return -1;
  return index;
}

export function listHeight(screenH: number, keyboardTop: number | null): number {
  const bottom = keyboardTop == null ? screenH : keyboardTop;
  return Math.max(ROW_PITCH, bottom - LIST_TOP);
}

export function explain(code: string, lang: string): string {
  const c = copy(lang);
  const startup = startupMessage(setupFailureCode(code), lang);
  if (startup) return startup;
  if (code === "username") return c.badUsername;
  if (!code) return "";
  if (code === "short") return c.short;
  if (code === "mismatch") return c.mismatch;
  if (code === "nfs") return c.nfs;
  if (code === "ssid") return c.ssid;
  if (code === "scan") return c.scanFailed;
  if (code === "wifi") return c.wifiFail;
  if (code === "wifi-password") return c.wifiPassword;
  if (code === "wifi-busy") return c.wifiBusy;
  if (code === "wifi-pending") return c.wifiPending;
  if (code === "wifi-ap-only") return c.wifiApOnly;
  if (code === "wifi-core") return c.wifiService;
  if (code === "wifi-wpa3") return c.wifiWpa3Only;
  if (code === "wifi-ok") return c.wifiOk;
  if (code === "net-ok") return c.networkApplied;
  if (code === "vlan") return c.badVlan;
  if (code === "address") return c.badAddress;
  if (code === "gateway") return c.badGateway;
  if (code === "dns") return c.badDns;
  if (code === "mask") return c.badMask;
  if (code === "prefix") return c.badPrefix;
  if (code === "blank") return c.badBlank;
  if (code === "marker") return c.badMarker;
  if (code === "api unreachable" || code.startsWith("308") || code.startsWith("301")) return c.badReach;
  return c.badApply;
}
