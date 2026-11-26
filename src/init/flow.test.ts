import { startupDialogCopy, startupMessage } from "./startup-copy";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyToken, caretX, CORNER_CLEAR, HEADER_LABEL_H, HEADER_VALUE_H, KEY_HEADER_H, KEY_MODE, KEY_RADIUS, chipAt, keyHeader, keyboardMark, keyRows, layoutKeys, maskSecret, nextKeyMode, pickAt, pickBand, pickChips, releaseKey, revealBox, tailFit } from "../shell/keypad";
import { MACHINE_LAYOUTS, cornerInset, layoutFor } from "../shell/layouts";
import { LIST_ROW_H, LIST_ROW_PITCH } from "../shell/listMetrics";
import {
  TIMEZONE_IDS,
} from "../../apps/settings/src/timezone-ids";
import {
  applyAllowed,
  authAllowed,
  authBody,
  commitValue,
  buttonLangAt,
  copy,
  decide,
  explain,
  fieldLabel,
  netBody,
  modeOptions,
  linkAddress,
  pageRows,
  panScroll,
  parseScan,
  apTags,
  parseLinks,
  prevStep,
  resolveLinks,
  revealScroll,
  apFaceLayout,
  estimateText,
  EDGE,
  stepDots,
  TITLE_X,
  welcomeBottom,
  welcomePager,
  welcomeSwipeFace,
  WELCOME_PAGER_H,
  wrapText,
  welcomeFaceAt,
  welcomeFaceIndex,
  welcomeKnobFace,
  welcomeFaceProgress,
  welcomeHintLines,
  welcomeLayout,
  setupLang,
  bodyViewH,
  footerInset,
  hitRow,
  LIST_TOP,
  ROW_H,
  ROW_PITCH,
  scrollOf,
  titleOf,
  tzFilterChrome,
  tzZones,
  wifiBody,
  type PageState,
} from "./flow";

function blankState(over: Partial<PageState> = {}): PageState {
  return {
    step: "language",
    lang: "zh",
    tzFilter: "all",
    advanced: false,
    wifiPage: false,
    v4page: false,
    v4: "dhcp",
    v6: "slaac",
    wifi: false,
    links: [],
    iface: "",
    ip: "",
    wifiSsid: "",
    wifiIp: "",
    wifiGeneration: "",
    aps: [],
    username: "admin",
    pass1: "",
    pass2: "",
    v4addr: "",
    v4gw: "",
    dns: "",
    v6addr: "",
    v6prefix: "64",
    v6gw: "",
    vlan: "",
    busy: false,
    ...over,
  };
}

const lang = pageRows(blankState());
assert.equal(explain("net-ok", "zh"), "网络配置已应用");
assert.equal(explain("net-ok", "zh_tw"), "網路設定已套用");
assert.equal(explain("net-ok", "en"), "Network settings applied");
assert.deepEqual(lang.map((row) => row.id), ["lang:zh", "lang:en", "lang:zh_tw", "back"]);
assert.equal(lang.some((row) => row.id.includes("app")), false);
assert.equal(decide(blankState(), "lang:en").type, "language");
// The device still stores "zh" from an earlier setup. Init does not read it:
// its startup dialogs are in English until a language is picked on the
// language step, then follow that choice.
{
  const before = setupLang();
  assert.equal(before, "en");
  assert.deepEqual(startupDialogCopy(before, "starting", "core-starting"), {
    title: "Starting device", message: "Core service is starting…\nPlease wait.", retry: "Check again", back: "Back",
  });
  assert.equal(startupDialogCopy(before, "checking", "").message, "Checking startup status…");
  assert.equal(startupDialogCopy(before, "error", "core-failed").title, "Device is not ready");
  assert.equal(startupDialogCopy(before, "error", "core-failed").message, "Core service failed to start.\nExport diagnostics for details.");
  const picked = decide(blankState({ step: "language", lang: before }), "lang:zh");
  assert.equal(picked.type, "language");
  const after = setupLang(picked.type === "language" ? picked.id : null);
  assert.equal(after, "zh");
  assert.deepEqual(startupDialogCopy(after, "starting", "core-starting"), {
    title: "正在启动", message: "核心服务正在启动…\n完成后将自动继续", retry: "重新检查", back: "返回",
  });
  assert.equal(startupDialogCopy(after, "error", "core-failed").title, "设备尚未就绪");
  assert.equal(setupLang("zh_tw"), "zh_tw");
  assert.equal(setupLang("en"), "en");
}
assert.equal(prevStep("welcome"), null);
assert.equal(prevStep("language"), "welcome");
assert.equal(pageRows(blankState({ step: "welcome" })).length, 0);
for (const scr of [
  { w: 240, h: 240 },
  { w: 172, h: 320 },
]) {
  const tall = welcomeLayout({ w: 172, h: 320 });
  assert.equal(tall.logo.y, Math.round((320 - tall.logo.h) / 2));
  assert.equal(tall.hint, null);
  const lay = welcomeLayout(scr);
  assert.equal(lay.logo.x, Math.round((scr.w - lay.logo.w) / 2));
  assert.equal(lay.next.x, Math.round((scr.w - lay.next.w) / 2));
  assert.equal(lay.next.w, scr.w - 32);
  assert.equal(lay.next.h, lay.next.size);
  assert.ok(lay.logo.y + lay.logo.h <= lay.next.y);
  assert.ok(lay.next.y + lay.next.size <= scr.h);
  assert.equal(lay.hint, null);
  const hinted = welcomeLayout(scr, true);
  const lines = welcomeHintLines("zh", "192.168.10.20", scr.w);
  assert.ok(hinted.hint);
  assert.equal(hinted.hint.h, lines.length * hinted.hint.line);
  assert.ok(hinted.logo.y + hinted.logo.h <= hinted.hint.y);
  assert.ok(hinted.hint.y + hinted.hint.h <= hinted.next.y);
  assert.ok(hinted.next.y + hinted.next.size <= scr.h);
  assert.equal(hinted.logo.x, Math.round((scr.w - hinted.logo.w) / 2));
}
const plain = welcomeLayout({ w: 240, h: 240 });
assert.equal(plain.logo.w, 208);
assert.equal(plain.logo.h, 104);
assert.equal(plain.logo.y, 56);
assert.equal(plain.next.y, 168);
assert.deepEqual(welcomeHintLines("zh", "", 240), []);
assert.deepEqual(welcomeHintLines("zh", "192.168.10.20", 240), [
  "find.onekvm.org",
  "192.168.10.20",
]);
assert.deepEqual(welcomeHintLines("zh_tw", "10.0.0.8", 240), ["find.onekvm.org", "10.0.0.8"]);
assert.deepEqual(welcomeHintLines("en", "10.0.0.8", 172), ["find.onekvm.org", "10.0.0.8"]);
assert.equal(copy("zh").onDevice, "在此屏幕设置");
assert.equal(copy("zh_tw").onDevice, "在此螢幕設定");
assert.equal(copy("en").onDevice, "Set up here");
assert.equal(copy("zh").dismiss, "知道了");
assert.equal(copy("en").dismiss, "OK");
// Wi-Fi requests Core refuses before connecting.
for (const [code, zh, tw, en] of [
  ["wifi-password", "密码需 8～63 个字符", "密碼需 8～63 個字元", "Password: 8–63 characters"],
  ["wifi-busy", "无线正忙，请稍后重试", "無線忙碌，請稍後重試", "Wi-Fi busy. Retry later"],
  ["wifi-pending", "请在网页确认网络配置", "請在網頁確認網路設定", "Confirm network on web"],
  ["wifi-ap-only", "请在网页退出仅热点模式", "請在網頁退出僅熱點模式", "Exit hotspot-only on web"],
  ["wifi-core", "无线不可用，请稍后重试", "無線無法使用，請稍後重試", "Wi-Fi down. Retry later"],
]) {
  assert.equal(explain(code, "zh"), zh);
  assert.equal(explain(code, "zh_tw"), tw);
  assert.equal(explain(code, "en"), en);
}
assert.equal(explain("vlan", "zh"), "VLAN 须为 1-4094");
assert.equal(explain("vlan", "zh_tw"), "VLAN 須為 1-4094");
assert.equal(explain("vlan", "en"), "VLAN must be 1-4094");
assert.equal(explain("short", "zh"), "密码至少 8 位");
assert.equal(explain("mismatch", "zh"), "两次密码不一致");
assert.equal(explain("mismatch", "en"), "Passwords don't match");
assert.equal(explain("nfs", "zh"), "NFS 下不能改网络");
assert.equal(explain("ssid", "zh"), "请填写网络名称");
assert.equal(explain("address", "zh"), "IP 格式不正确");
assert.equal(explain("gateway", "zh"), "网关格式不正确");
assert.equal(explain("dns", "zh_tw"), "DNS 格式不正確");
assert.equal(explain("mask", "en"), "Enter a valid mask");
assert.equal(explain("prefix", "zh"), "前缀须为 0-128");
assert.equal(explain("blank", "zh"), "请填写熄屏秒数");
assert.equal(explain("marker", "zh"), "设置未能保存");
assert.equal(explain("api unreachable", "zh"), "连不上本机核心服务\n请稍后重试或导出诊断");
assert.equal(explain("Connection refused (os error 111)", "zh"), explain("api unreachable", "zh"));
assert.ok(explain('500 {"error":"save authentication settings: No space left on device (os error 28)"}', "zh").includes("空间不足"));
assert.ok(explain('500 {"error":"apply region and time settings: timeout"}', "en").includes("timezone"));
assert.ok(explain("startup:storage-read-only", "zh_tw").includes("唯讀"));
assert.equal(explain("500 no such route", "zh"), "设置没有成功");
assert.equal(explain("", "zh"), "");
assert.equal((commitValue("v4gw", "192.168.1", "") as { code: string }).code, "gateway");
assert.equal((commitValue("dns", "1.1.1.256", "") as { code: string }).code, "dns");
assert.equal(buttonLangAt(0), "zh");
assert.equal(buttonLangAt(4999), "zh");
assert.equal(buttonLangAt(5000), "en");
assert.equal(buttonLangAt(10000), "zh_tw");
assert.equal(buttonLangAt(15000), "zh");
assert.equal(copy(buttonLangAt(5000)).onDevice, "Set up here");
assert.equal(copy(buttonLangAt(10000)).onDevice, "在此螢幕設定");
assert.equal(decide(blankState(), "back").type, "back");

const zones = pageRows(blankState({ step: "timezone" }));
assert.equal(zones[0].label, TIMEZONE_IDS[0]);
assert.equal(zones.at(-1)?.id, "back");
assert.equal(decide(blankState({ step: "timezone" }), "tz:Asia/Shanghai").type, "timezone");
assert.equal(tzFilterChrome("zh", "all").title, "筛选");
assert.equal(tzFilterChrome("zh", "Asia").value, "亚洲");
assert.equal(tzFilterChrome("zh_tw", "Europe").value, "歐洲");
assert.equal(tzFilterChrome("en", "Australia").value, "Australia");
assert.deepEqual(
  pageRows(blankState({ step: "timezone", tzFilter: "Asia" })).filter((row) => row.id.startsWith("tz:")).map((row) => row.label),
  TIMEZONE_IDS.filter((id) => id.startsWith("Asia/")),
);
assert.deepEqual(tzZones("UTC"), ["UTC"]);
assert.equal(pageRows(blankState({ step: "timezone", tzFilter: "Australia" })).some((row) => row.id === "tz:Europe/London"), false);

const blank = pageRows(blankState({ step: "blank", lang: "en" }));
assert.deepEqual(blank.map((row) => row.label), ["Never", "30s", "1 min", "5 min", "Custom", "Back"]);
assert.deepEqual(decide(blankState({ step: "blank" }), "blank:0"), { type: "blank", seconds: 0 });
assert.equal(decide(blankState({ step: "blank" }), "blank:custom").type, "keyboard");

const ethOnly = pageRows(blankState({ step: "network", links: [{ name: "eth0", kind: "eth" }] }));
assert.deepEqual(ethOnly.map((row) => row.id), ["link:eth0", "next", "back"]);
assert.equal(ethOnly[0]?.label, "eth0");
assert.equal(ethOnly[0]?.value, "有线");
assert.equal(ethOnly[0]?.detail, undefined);
assert.equal(ethOnly.some((row) => row.value === "无线" || row.id === "wifi"), false);
const addressed = pageRows(blankState({
  step: "network",
  iface: "eth0",
  ip: "192.168.10.20",
  links: [
    { name: "eth0", kind: "eth" },
    { name: "wlan0", kind: "wifi" },
  ],
}));
assert.equal(addressed[0]?.detail, "192.168.10.20");
assert.equal(addressed[1]?.detail, undefined);
assert.equal(linkAddress("eth0", "wlan0", "10.0.0.8"), "");
const both = pageRows(blankState({
  step: "network",
  wifi: true,
  links: [
    { name: "eth0", kind: "eth" },
    { name: "wlan0", kind: "wifi" },
  ],
  aps: [{ ssid: "lab", secure: false }],
}));
assert.deepEqual(both.map((row) => row.id), ["link:eth0", "link:wlan0", "next", "back"]);
assert.equal(both[0]?.value, "有线");
assert.equal(both[1]?.label, "wlan0");
assert.equal(both[1]?.value, "未连接");
assert.equal(both.some((row) => row.id === "v4" || row.id === "hidden" || row.id.startsWith("ap:")), false);
const wifiOnly = pageRows(blankState({ step: "network", links: [{ name: "wlan0", kind: "wifi" }] }));
assert.deepEqual(wifiOnly.map((row) => row.id), ["link:wlan0", "next", "back"]);
assert.equal(wifiOnly[0]?.value, "未连接");
assert.equal(wifiOnly.some((row) => row.value === "有线"), false);
assert.deepEqual(pageRows(blankState({ step: "network" })).map((row) => row.id), ["next", "back"]);
assert.equal(
  pageRows(blankState({ step: "network", lang: "zh_tw", links: [{ name: "wlan0", kind: "wifi" }] }))
    .find((row) => row.id === "link:wlan0")?.value,
  "未連線",
);
assert.equal(
  pageRows(blankState({ step: "network", lang: "en", links: [{ name: "eth0", kind: "eth" }] }))
    .find((row) => row.id === "link:eth0")?.value,
  "Ethernet",
);
assert.equal(
  pageRows(blankState({ step: "network", lang: "en", links: [{ name: "wlan0", kind: "wifi" }] }))
    .find((row) => row.id === "link:wlan0")?.value,
  "Not connected",
);
const joined = pageRows(blankState({
  step: "network",
  lang: "zh",
  wifiSsid: "Sam_Network+",
  wifiIp: "192.168.8.20",
  links: [{ name: "wlan0", kind: "wifi" }],
}));
assert.equal(joined[0]?.value, "已连接 Sam_Network+");
assert.equal(joined[0]?.detail, "192.168.8.20");
assert.deepEqual(resolveLinks("", false, "eth0"), [{ name: "eth0", kind: "eth" }]);
assert.deepEqual(resolveLinks("", true, "eth0"), [
  { name: "eth0", kind: "eth" },
  { name: "wlan0", kind: "wifi" },
]);
assert.deepEqual(resolveLinks("", true, "wlan0"), [{ name: "wlan0", kind: "wifi" }]);
assert.deepEqual(resolveLinks("[]", true, "eth0"), []);
assert.deepEqual(
  parseLinks('[{"name":"eth0","kind":"eth"},{"name":"eth0","kind":"wifi"},{"name":"wlan0","kind":"wifi"}]'),
  [
    { name: "eth0", kind: "eth" },
    { name: "wlan0", kind: "wifi" },
  ],
);
const radios = pageRows(blankState({ step: "network", wifiPage: true, wifi: true, aps: [{ ssid: "lab", secure: false }] }));
assert.equal(radios.some((row) => row.id === "hidden"), true);
assert.equal(radios.some((row) => row.id.startsWith("ap:")), true);
assert.equal(radios.at(-1)?.id, "back");
assert.equal(radios.some((row) => row.id === "next" || row.id === "v4"), false);
assert.deepEqual(pageRows(blankState({ step: "network", wifiPage: true, wifi: false })).map((row) => row.id), ["nowifi", "back"]);
assert.deepEqual(
  pageRows(blankState({ step: "network", wifiPage: true, wifi: true, busy: true })).map((row) => row.id),
  ["scanning", "hidden", "back"],
);
assert.equal(
  pageRows(blankState({ step: "network", lang: "zh", wifiPage: true, wifi: true, busy: true }))[0]?.label,
  "正在扫描",
);
assert.deepEqual(
  pageRows(blankState({ step: "network", wifiPage: true, wifi: true })).map((row) => row.id),
  ["empty", "hidden", "back"],
);
assert.equal(decide(blankState({ step: "network", wifiPage: true, wifi: true, busy: true }), "scanning").type, "noop");
assert.equal(explain("scan", "zh"), "扫描失败");
assert.equal(explain("wifi", "zh"), "连接失败，请重试");
assert.equal(explain("wifi-ok", "en"), "Connected");
assert.equal(fieldLabel("pass1", "zh"), "密码");
assert.equal(fieldLabel("pass2", "zh"), "确认密码");
assert.equal(fieldLabel("wifi:lab", "en"), "Password");
assert.equal(fieldLabel("v4gw", "zh"), "网关");
assert.equal(fieldLabel("v4ip", "en"), "IP");
assert.equal(fieldLabel("v4mask", "zh_tw"), "遮罩");
assert.equal(maskSecret("abcd", false, 1000, 2000), "***d");
assert.equal(maskSecret("abcd", false, 2000, 2000), "****");
assert.equal(maskSecret("abcd", true, 3000, 2000), "abcd");
assert.equal(maskSecret("", false, 0, 0), "");
assert.deepEqual(decide(blankState({ step: "network", wifiPage: true, wifi: true, aps: [{ ssid: "lab", secure: false }] }), "ap:0"), {
  type: "wifi",
  ssid: "lab",
  password: "",
});
assert.equal(
  decide(blankState({ step: "network", wifiPage: true, wifi: true, aps: [{ ssid: "lock", secure: true }] }), "ap:0").type,
  "keyboard",
);
// SAE-only networks are refused before asking for a password; WPA2/WPA3
// networks still connect.
const apRow = (security: string) =>
  decide(blankState({ step: "network", wifiPage: true, wifi: true, aps: [{ ssid: "Office", secure: true, security }] }), "ap:0");
assert.deepEqual(apRow("wpa3"), { type: "alert", code: "wifi-wpa3" });
assert.equal(apRow("wpa2-wpa3").type, "keyboard");
assert.equal(apRow("wpa2").type, "keyboard");
assert.equal(explain("wifi-wpa3", "zh"), "不支持仅 WPA3 的网络");
assert.equal(explain("wifi-wpa3", "zh_tw"), "不支援僅 WPA3 的網路");
assert.equal(explain("wifi-wpa3", "en"), "WPA3-only not supported");
assert.deepEqual(
  decide(blankState({ step: "network", links: [{ name: "eth0", kind: "eth" }] }), "link:eth0"),
  { type: "config", name: "eth0" },
);
assert.deepEqual(
  decide(blankState({ step: "network", links: [{ name: "wlan0", kind: "wifi" }] }), "link:wlan0"),
  { type: "wifi-open", name: "wlan0" },
);
assert.deepEqual(decide(blankState({ step: "network" }), "link:eth0"), { type: "noop" });
assert.deepEqual(decide(blankState({ step: "network" }), "eth"), { type: "config", name: "" });
assert.deepEqual(decide(blankState({ step: "network" }), "wifi"), { type: "wifi-open", name: "" });
assert.deepEqual(decide(blankState({ step: "network", wifiPage: true }), "back"), { type: "close-wifi" });
assert.equal(titleOf("network", "zh", false, false, true), "无线");
assert.equal(titleOf("network", "zh", true, false, false, "eth0"), "eth0");
assert.equal(titleOf("network", "zh", false, false, true, "wlan0"), "wlan0");

const menu = pageRows(blankState({ step: "network", advanced: true, wifi: true, aps: [{ ssid: "lab", secure: false }] }));
assert.equal(menu.some((row) => row.id.startsWith("ap:")), false);
assert.equal(menu.find((row) => row.id === "v4")?.value, "DHCP");
assert.equal(menu.find((row) => row.id === "v6")?.value, "SLAAC");
assert.equal(menu.at(-1)?.id, "back");
assert.equal(menu.some((row) => row.id === "next" || row.id === "v4set"), false);
assert.deepEqual(decide(blankState({ step: "network", advanced: true }), "back"), { type: "close-config" });
assert.deepEqual(decide(blankState({ step: "network", advanced: true }), "v4"), { type: "drawer", which: "v4" });
assert.deepEqual(decide(blankState({ step: "network" }), "back"), { type: "back" });
assert.equal(titleOf("network", "zh", true), "有线");
assert.deepEqual(modeOptions("v6", "en").map((item) => item.label), ["SLAAC", "Static"]);

const open = pageRows(blankState({
  step: "network",
  advanced: true,
  v4: "static",
  v6: "static",
  v4addr: "192.168.1.10/24",
}));
assert.equal(open.find((row) => row.id === "v4")?.value, "静态");
assert.equal(open.find((row) => row.id === "v4set")?.label, "IPv4 设置");
assert.equal(open.find((row) => row.id === "v4set")?.value, "192.168.1.10");
assert.equal(open.some((row) => row.id === "v4addr" || row.id === "v4gw" || row.id === "dns"), false);
assert.equal(pageRows(blankState({ step: "network", advanced: true, v4: "dhcp" })).some((row) => row.id === "dns"), true);
assert.equal(open.find((row) => row.id === "v6")?.value, "静态");
assert.equal(open.some((row) => row.id === "v6addr"), true);
assert.equal(open.some((row) => row.id === "vlan"), true);
assert.deepEqual(decide(blankState({ step: "network", advanced: true, v4: "static" }), "v4set"), { type: "v4-settings" });
const v4menu = pageRows(blankState({
  step: "network",
  advanced: true,
  v4page: true,
  v4: "static",
  v4addr: "192.168.1.10/24",
}));
assert.deepEqual(v4menu.map((row) => row.id), ["v4ip", "v4mask", "v4gw", "dns", "back"]);
assert.equal(v4menu[0]?.value, "192.168.1.10");
assert.equal(v4menu[1]?.label, "掩码");
assert.equal(v4menu[1]?.value, "255.255.255.0");
assert.equal(v4menu[2]?.label, "网关");
assert.equal(v4menu[3]?.label, "DNS");
assert.deepEqual(decide(blankState({ step: "network", advanced: true, v4page: true, v4gw: "192.168.1.1", dns: "1.1.1.1" }), "v4gw"), {
  type: "keyboard",
  kind: "ipv4",
  target: "v4gw",
  secret: false,
  max: 15,
  initial: "192.168.1.1",
});
assert.deepEqual(decide(blankState({ step: "network", advanced: true, v4page: true, dns: "8.8.8.8" }), "dns"), {
  type: "keyboard",
  kind: "ipv4",
  target: "dns",
  secret: false,
  max: 15,
  initial: "8.8.8.8",
});
assert.equal((commitValue("v4gw", "192.168.1.1", "") as { value: string }).value, "192.168.1.1");
assert.equal((commitValue("v4gw", "", "") as { value: string }).value, "");
assert.equal(commitValue("v4gw", "192.168.1", "").type, "error");
assert.equal((commitValue("dns", "1.1.1.1", "") as { key: string }).key, "dns");
assert.equal(commitValue("dns", "1.1.1.256", "").type, "error");
assert.deepEqual(decide(blankState({ step: "network", advanced: true, v4page: true, v4: "static", v4addr: "192.168.1.10/24" }), "back"), { type: "close-v4" });
assert.deepEqual(decide(blankState({ step: "network", advanced: true, v4page: true, v4: "static", v4addr: "10.1.2.3/8" }), "v4ip"), {
  type: "keyboard",
  kind: "ipv4",
  target: "v4ip",
  secret: false,
  max: 15,
  initial: "10.1.2.3",
});
assert.equal(titleOf("network", "zh", true, true), "IPv4 设置");
assert.equal(pageRows(blankState({ step: "network", advanced: true, v4page: true, v4: "static", lang: "en", v4addr: "10.1.2.3/8" })).find((row) => row.id === "v4mask")?.label, "Mask");
assert.equal(pageRows(blankState({ step: "network", advanced: true, v4page: true, v4: "static", lang: "en", v4addr: "10.1.2.3/8" })).find((row) => row.id === "v4mask")?.value, "255.0.0.0");
assert.equal((commitValue("v4ip", "10.0.0.8", "", "") as { value: string }).value, "10.0.0.8/24");
assert.equal((commitValue("v4ip", "1.2.3.4", "", "/26") as { value: string }).value, "1.2.3.4/26");
assert.equal(commitValue("v4ip", "1.2.3.256", "", "").type, "error");
assert.equal((commitValue("v4mask", "255.255.255.192", "", "10.1.2.3/8") as { value: string }).value, "10.1.2.3/26");
assert.equal(commitValue("v4mask", "255.0.255.0", "", "10.1.2.3/8").type, "error");
assert.equal((commitValue("v4ip", "", "", "10.0.0.8/25") as { value: string }).value, "/25");
assert.equal(applyAllowed(true), false);
assert.equal(applyAllowed(false), true);

assert.equal(commitValue("blankCustom", "0", "").type === "blank" && (commitValue("blankCustom", "0", "") as { seconds: number }).seconds === 0, true);
assert.equal((commitValue("v6pre", "200", "") as { value: string }).value, "128");
assert.equal(commitValue("vlan", "", "").type, "field");
assert.equal(commitValue("vlan", "4095", "").type, "error");
assert.equal(commitValue("hiddenSsid", "  ", "").type, "error");
assert.equal((commitValue("hiddenSsid", "cave", "") as { ssid: string }).ssid, "cave");
assert.equal(commitValue("pass2", "short", "short").type, "error");
assert.equal(commitValue("pass2", "long-enough", "other-pass").type, "error");
assert.equal(authAllowed("operator", "long-enough", "long-enough"), "ok");
assert.equal(authAllowed("  ", "long-enough", "long-enough"), "username");
assert.equal(authAllowed("u".repeat(65), "long-enough", "long-enough"), "username");
assert.equal(authAllowed("u".repeat(64), "long-enough", "long-enough"), "ok");
assert.deepEqual(commitValue("username", "  operator  ", ""), { type: "field", key: "username", value: "operator" });
assert.deepEqual(commitValue("username", "   ", ""), { type: "error", code: "username" });
assert.deepEqual(decide(blankState({ step: "password", username: "operator" }), "username"), {
  type: "keyboard", kind: "text", target: "username", secret: false, max: 64, initial: "operator",
});
assert.equal(fieldLabel("username", "zh"), "用户名");
assert.equal(explain("username", "en"), "Username must be 1-64 characters");
assert.equal(titleOf("password", "zh"), "账户");
const savedPass = commitValue("pass2", "long-enough", "long-enough");
assert.equal(savedPass.type, "field");
assert.equal((savedPass as { key: string }).key, "pass2");
assert.equal((savedPass as { value: string }).value, "long-enough");
const passRows = pageRows(blankState({ step: "password", pass1: "secret12", pass2: "no" }));
assert.deepEqual(passRows.map((row) => row.id), ["username", "pass1", "pass2", "auth", "back"]);
assert.equal(passRows[0]?.label, "用户名");
assert.equal(passRows[0]?.value, "admin");
assert.equal(passRows[1]?.label, "密码");
assert.equal(passRows[1]?.value, "********");
assert.equal(passRows[2]?.label, "确认密码");
assert.equal(pageRows(blankState({ step: "password", lang: "en" }))[2]?.label, "Confirm password");
assert.equal(pageRows(blankState({ step: "password", lang: "zh_tw" }))[2]?.label, "確認密碼");
assert.equal(passRows[2]?.value, "**");
assert.equal(passRows[3]?.label, "完成");
assert.equal(passRows[3]?.icon, "apply.png");
assert.equal(passRows[4]?.icon, "back.png");
assert.equal(pageRows(blankState({ step: "network" })).find((row) => row.id === "next")?.icon, "forward.png");
assert.equal(pageRows(blankState({ step: "password", busy: true })).find((row) => row.id === "auth")?.label, "等待");
assert.equal(pageRows(blankState({ step: "password", lang: "en" })).find((row) => row.id === "auth")?.label, "Done");
assert.equal(lang.find((row) => row.id === "back")?.icon, "back.png");
assert.equal(pageRows(blankState({ step: "network", advanced: true })).find((row) => row.id === "apply")?.icon, "apply.png");

const wifi = JSON.parse(wifiBody("hidden net", "secret")) as Record<string, string>;
assert.deepEqual(Object.keys(wifi).sort(), ["password", "ssid"]);
const net = JSON.parse(netBody({
  parent: "eth0",
  vlan: "",
  v4: "static",
  v4addr: "192.168.1.10/24",
  v4gw: "192.168.1.1",
  v6: "static",
  v6addr: "2001:db8::10",
  v6prefix: "64",
  v6gw: "2001:db8::1",
  dns: "1.1.1.1",
})) as { vlan_id: number; ipv6_prefix: number; ipv4_address: string };
assert.equal(net.vlan_id, 0);
assert.equal(net.ipv6_prefix, 64);
assert.equal(net.ipv4_address, "192.168.1.10/24");
const masked = JSON.parse(netBody({
  parent: "eth0",
  vlan: "",
  v4: "static",
  v4addr: "/25",
  v4gw: "",
  v6: "slaac",
  v6addr: "",
  v6prefix: "64",
  v6gw: "",
  dns: "",
})) as { ipv4_address: string };
assert.equal(masked.ipv4_address, "");
const auth = JSON.parse(authBody("  operator  ", "long-enough", "zh")) as Record<string, string>;
assert.equal(auth.username, "operator");
assert.equal(auth.password, "long-enough");
assert.equal(auth.language, "zh");
assert.equal(auth.timezone, "UTC");
assert.equal("setupDone" in auth, false);
assert.deepEqual(parseScan("[{\"ssid\":\"a\",\"secure\":true},{\"ssid\":\"\"}]"), [{ ssid: "a", secure: true }]);
assert.deepEqual(parseScan("[{\"ssid\":\"lab\",\"secure\":true,\"security\":\"wpa2-wpa3\",\"bands\":[\"5\",\"2.4\"],\"generation\":\"Wi-Fi 6\"}]"), [
  { ssid: "lab", secure: true, security: "wpa2-wpa3", bands: ["5", "2.4"], generation: "Wi-Fi 6" },
]);
assert.deepEqual(
  apTags({ ssid: "lab", secure: true, security: "wpa3", bands: ["5", "2.4"], generation: "Wi-Fi 7" }, "zh", "Wi-Fi 6"),
  ["Wi-Fi 6", "2.4G", "5G", "WPA3"],
);
assert.deepEqual(apTags({ ssid: "cafe", secure: false, security: "open", bands: ["2.4"] }, "zh"), ["2.4G", "开放"]);
assert.deepEqual(
  apTags({ ssid: "lab", secure: true, security: "wpa3", bands: ["5"], generation: "Wi-Fi 7", connected: true }, "zh", "Wi-Fi 6"),
  ["Wi-Fi 6", "5G", "已连接"],
);
assert.equal(parseScan("[{\"ssid\":\"home\",\"secure\":true,\"security\":\"wpa2\",\"connected\":true}]")[0]?.connected, true);
const tagged = pageRows(blankState({
  step: "network",
  wifiPage: true,
  wifi: true,
  wifiGeneration: "Wi-Fi 6",
  aps: [{ ssid: "lab", secure: true, security: "wpa2", bands: ["5"], generation: "Wi-Fi 5" }],
}));
assert.deepEqual(tagged.find((row) => row.id === "ap:0")?.tags, ["Wi-Fi 6", "5G", "WPA2"]);
assert.deepEqual(apTags({ ssid: "lab", secure: true, generation: "Wi-Fi 7" }, "zh"), []);
assert.deepEqual(parseScan("{\"error\":\"down\"}"), []);
assert.equal(keyboardMark(-1, 0, false), -1);
assert.equal(keyboardMark(-1, 0, true), 0);
assert.equal(keyboardMark(3, 0, false), 3);
assert.equal(scrollOf(0, 15, 200), 0);
assert.ok(scrollOf(14, 15, 80) > 0);
assert.equal(ROW_H, LIST_ROW_H);
assert.equal(ROW_PITCH, LIST_ROW_PITCH);
assert.equal(panScroll(10, 4, 8, 100), 6);
assert.equal(panScroll(0, 20, 8, 100), 0);
assert.equal(revealScroll(0, 2, 8, 100) > 0, true);

const zoneCount = pageRows(blankState({ step: "timezone" })).length;
assert.equal(zoneCount, TIMEZONE_IDS.length + 1);
assert.equal(hitRow(120, 38, 240, 218, 0, zoneCount), 0);
assert.equal(hitRow(120, LIST_TOP + footerInset(218, zoneCount - 1) + 8, 240, 218, 0, zoneCount), zoneCount - 1);
assert.equal(hitRow(2, 210, 240, 218, 0, zoneCount), -1);
const langCount = pageRows(blankState()).length;
assert.equal(footerInset(218, langCount - 1), 218 - ROW_PITCH);
assert.equal(hitRow(120, LIST_TOP + footerInset(218, langCount - 1) + 8, 240, 218, 0, langCount), langCount - 1);
assert.equal(bodyViewH(218, zoneCount - 1), 218 - ROW_PITCH);

for (const scr of [
  { w: 172, h: 320 },
  { w: 240, h: 240 },
  { w: 320, h: 172 },
  { w: 284, h: 240 },
  { w: 240, h: 284 },
]) {
  for (const kind of ["text", "ipv4", "ipv6", "number"] as const) {
    for (const mode of [0, 1, 2]) {
      const lay = layoutKeys(kind, mode, scr);
      assert.ok(lay.caps.length > 0);
      // The field name and typed text keep a header of their own above the keys.
      assert.ok(lay.previewH >= KEY_HEADER_H, `${kind} ${scr.w}x${scr.h} header`);
      // Either the keyboard covers the page or a strip at least a header tall stays visible.
      assert.ok(lay.top === 0 || lay.top >= KEY_HEADER_H * 2, `${kind} ${scr.w}x${scr.h} top ${lay.top}`);
      // Only text fields are secret and show the button.
      const eye = revealBox(lay, scr);
      if (kind === "text") assert.ok(eye.y >= lay.top && eye.y + eye.h <= lay.top + lay.previewH, `${scr.w}x${scr.h} show button`);
      for (const cap of lay.caps) {
        assert.ok(cap.x >= 0 && cap.y >= 0, `${kind} ${scr.w}x${scr.h}`);
        assert.ok(cap.x + cap.w <= scr.w, `${kind} ${cap.token} x`);
        assert.ok(cap.y + cap.h <= scr.h, `${kind} ${cap.token} y`);
        assert.ok(cap.y >= lay.top + lay.previewH && cap.ly >= lay.previewH, `${kind} ${cap.token} under header`);
      }
    }
  }
}
/** A rounded rectangle stays inside a panel whose corners have radius `corner`. */
function insideCorners(rect: { x: number; y: number; w: number; h: number }, radius: number, scr: { w: number; h: number }, corner: number): boolean {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > scr.w || rect.y + rect.h > scr.h) return false;
  if (corner <= 0) return true;
  const arc = radius * (1 - Math.SQRT1_2);
  const points = [
    [rect.x + arc, rect.y + arc], [rect.x + rect.w - arc, rect.y + arc],
    [rect.x + arc, rect.y + rect.h - arc], [rect.x + rect.w - arc, rect.y + rect.h - arc],
  ];
  return points.every(([px, py]) => {
    const cx = Math.min(Math.max(px, corner), scr.w - corner);
    const cy = Math.min(Math.max(py, corner), scr.h - corner);
    return Math.hypot(px - cx, py - cy) <= corner + 0.01;
  });
}
// NanoKVM Go uses PicoKVM's nine-key board: hold a group, move to a letter, release.
for (const scr of [{ w: 284, h: 240 }, { w: 240, h: 284 }]) {
  const corner = layoutFor(scr, "nanokvm-go").corner;
  assert.ok(corner > 0);
  for (const kind of ["text", "ipv4", "ipv6", "number"] as const) {
    for (const mode of kind === "text" ? [0, 1, 2, 3] : [0]) {
      const lay = layoutKeys(kind, mode, scr, "nanokvm-go");
      const name = `Go ${scr.w}x${scr.h} ${kind} ${mode}`;
      assert.equal(lay.board, "nine", name);
      assert.equal(lay.top, 0, name);
      for (const cap of lay.caps) {
        assert.ok(insideCorners(cap, KEY_RADIUS, scr, corner), `${name} ${cap.label || cap.token} hits a corner`);
        if (cap.chars.length > 1) {
          for (const chip of pickChips(cap, lay, scr)) {
            assert.ok(insideCorners({ x: chip.x, y: chip.y + lay.top, w: chip.size, h: chip.size }, 8, scr, corner), `${name} ${cap.label} letters`);
          }
        }
      }
      const eye = revealBox(lay, scr);
      assert.ok(insideCorners(eye, 8, scr, corner), `${name} show button`);
    }
  }
  for (const mode of [0, 2]) {
    const lay = layoutKeys("text", mode, scr, "nanokvm-go");
    const letters = lay.caps.flatMap((cap) => cap.chars).join("").toLowerCase();
    for (const ch of "abcdefghijklmnopqrstuvwxyz") assert.ok(letters.includes(ch), `Go mode ${mode} ${ch}`);
  }
}
// Nine-key boards: the mode key steps abc, 123, #+=, ABC and names the mode in
// use. Every printable ASCII mark and digit can be typed; digits are single keys.
const MARKS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
assert.equal(MARKS.length, 32);
for (const [machine, scr] of [
  ["nanokvm-go", { w: 284, h: 240 }], ["nanokvm-go", { w: 240, h: 284 }], ["picokvm", { w: 240, h: 240 }],
] as const) {
  const name = `${machine} ${scr.w}x${scr.h}`;
  const cycle = [KEY_MODE.lower as number];
  for (let next = nextKeyMode(cycle[0], scr, machine); next !== cycle[0]; next = nextKeyMode(next, scr, machine)) {
    assert.ok(cycle.length < 8, `${name} mode cycle`);
    cycle.push(next);
  }
  assert.deepEqual(cycle, [KEY_MODE.lower, KEY_MODE.digits, KEY_MODE.marks, KEY_MODE.upper], name);
  const boards = cycle.map((mode) => layoutKeys("text", mode, scr, machine));
  assert.deepEqual(boards.map((lay) => lay.caps.find((cap) => cap.token === "MD")?.label), ["abc", "123", "#+=", "ABC"], name);
  const typed = new Set(boards.flatMap((lay) => lay.caps.flatMap((cap) => cap.chars)));
  for (const ch of MARKS + "0123456789") assert.ok(typed.has(ch), `${name} cannot type ${ch}`);
  const digits = boards[1].caps.filter((cap) => cap.chars.length === 1).map((cap) => cap.token).sort().join("");
  assert.equal(digits, "0123456789", `${name} digit keys`);
  const marks = boards[2];
  // The punctuation mode alone holds all 32 marks, each once, a pair of brackets in one group.
  assert.equal(marks.caps.flatMap((cap) => cap.chars).sort().join(""), Array.from(MARKS).sort().join(""), name);
  for (const pair of ["()", "[]", "{}", "<>"]) {
    assert.ok(marks.caps.some((cap) => cap.chars.includes(pair[0]) && cap.chars.includes(pair[1])), `${name} ${pair}`);
  }
  // Same key positions as the letters; five keys in the bottom row.
  assert.deepEqual(marks.caps.map((cap) => [cap.x, cap.y, cap.w, cap.h]), boards[0].caps.map((cap) => [cap.x, cap.y, cap.w, cap.h]), name);
  assert.ok(marks.caps.filter((cap) => cap.chars.length === 0).length === 5, name);
  if (machine === "nanokvm-go" && scr.w > scr.h) {
    assert.ok(marks.caps.filter((cap) => cap.chars.length === 0).every((cap) => cap.w >= 48), `${name} action row`);
  }
  assert.ok(marks.caps.every((cap) => cap.chars.length <= 4), name);
  // Holding a group picks the character whose chip is under the finger. From
  // a press at the key's left edge, middle or right edge, in every mode, each
  // character can be reached and typed by moving along the chip row.
  for (const [at, lay] of boards.entries()) {
    const corner = lay.corner;
    for (const [index, cap] of lay.caps.entries()) {
      if (cap.chars.length <= 1) continue;
      const label = `${name} mode ${cycle[at]} ${cap.label}`;
      const chips = pickChips(cap, lay, scr);
      assert.equal(chips.length, cap.chars.length, label);
      for (const [n, chip] of chips.entries()) {
        assert.ok(insideCorners({ x: chip.x, y: chip.y + lay.top, w: chip.size, h: chip.size }, 8, scr, Math.max(corner, 0)), `${label} chip ${n}`);
        if (n > 0) assert.ok(chip.x >= chips[n - 1].x + chips[n - 1].size, `${label} chips overlap`);
      }
      // The band behind the chips stays inside the panel and holds every chip.
      const band = pickBand(chips, lay, scr);
      assert.ok(band.x >= 0 && band.x + band.w <= scr.w && band.y + lay.top >= 0, `${label} band`);
      assert.ok(chips.every((chip) => chip.x >= band.x && chip.x + chip.size <= band.x + band.w && chip.y >= band.y && chip.y + chip.size <= band.y + band.h), `${label} band`);
      const y = cap.y + Math.floor(cap.h / 2);
      for (const press of [cap.x, cap.x + Math.floor(cap.w / 2), cap.x + cap.w - 1]) {
        // The chip under the press point, or the nearest one, is selected first.
        const first = pickAt(cap, lay, scr, press);
        const under = chips.findIndex((chip) => press >= chip.x && press < chip.x + chip.size);
        const nearest = chips.reduce((best, chip, n) => {
          const gap = (c: typeof chip) => Math.max(c.x - press, press - (c.x + c.size - 1), 0);
          return gap(chip) < gap(chips[best]) ? n : best;
        }, 0);
        assert.equal(first, under >= 0 ? under : nearest, `${label} press ${press}`);
        for (const [n, chip] of chips.entries()) {
          const x = chip.x + Math.floor(chip.size / 2);
          assert.ok(x >= 0 && x < scr.w, `${label} chip ${n} off the panel`);
          assert.equal(pickAt(cap, lay, scr, x), n, `${label} from ${press} to chip ${n}`);
          assert.equal(releaseKey(lay.caps, index, x, y, true, pickAt(cap, lay, scr, x)), cap.chars[n], `${label} types ${cap.chars[n]}`);
        }
      }
    }
  }
}
// Every board types every letter, capitals included; only the X key cancels.
for (const [machine, scr] of [
  ["nanokvm-go", { w: 284, h: 240 }], ["nanokvm-go", { w: 240, h: 284 }], ["picokvm", { w: 240, h: 240 }],
  ["nanokvm-pro", { w: 320, h: 172 }], ["nanokvm-pro", { w: 172, h: 320 }],
] as const) {
  const name = `${machine} ${scr.w}x${scr.h}`;
  const modes = [0];
  for (let next = nextKeyMode(0, scr, machine); next !== 0; next = nextKeyMode(next, scr, machine)) modes.push(next);
  const typed = new Set<string>();
  for (const mode of modes) {
    const caps = layoutKeys("text", mode, scr, machine).caps;
    for (const ch of caps.flatMap((cap) => cap.chars)) {
      assert.deepEqual(applyToken("", ch, 64), { value: ch, action: "char" }, `${name} mode ${mode} ${ch}`);
      typed.add(ch);
    }
    const cancel = caps.filter((cap) => applyToken("", cap.token, 64).action === "cancel");
    assert.deepEqual(cancel.map((cap) => cap.label), ["X"], `${name} mode ${mode}`);
  }
  for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") assert.ok(typed.has(ch), `${name} cannot type ${ch}`);
}
// Keyboard header on Go: the label, typed text, caret and show button keep
// CORNER_CLEAR from the 40 px corner arcs, measured from the corner centre and
// including the button's own 8 px corners. The button is centred on the typed
// line, and the text and caret end before it.
function clearOfCorners(rect: { x: number; y: number; w: number; h: number }, radius: number, scr: { w: number; h: number }, corner: number): boolean {
  const points = [
    [rect.x + radius, rect.y + radius], [rect.x + rect.w - radius, rect.y + radius],
    [rect.x + radius, rect.y + rect.h - radius], [rect.x + rect.w - radius, rect.y + rect.h - radius],
  ];
  return points.every(([px, py]) => {
    const cx = Math.min(Math.max(px, corner), scr.w - corner);
    const cy = Math.min(Math.max(py, corner), scr.h - corner);
    return Math.hypot(px - cx, py - cy) + radius <= corner - CORNER_CLEAR + 1e-6;
  });
}
const tenPx = (text: string) => Array.from(text).length * 10;
for (const scr of [{ w: 284, h: 240 }, { w: 240, h: 284 }]) {
  const corner = layoutFor(scr, "nanokvm-go").corner;
  for (const kind of ["text", "ipv4", "ipv6", "number"] as const) {
    const lay = layoutKeys(kind, 0, scr, "nanokvm-go");
    for (const secret of kind === "text" ? [false, true] : [false]) {
      for (const labelled of [true, false]) {
        const head = keyHeader(lay, scr, labelled, secret);
        const width = scr.w - head.x - head.right;
        for (const [state, text] of [["empty", ""], ["long hidden", "*".repeat(40)], ["long shown", "a".repeat(40)]] as const) {
          const name = `Go ${scr.w}x${scr.h} ${kind}${secret ? " secret" : ""}${labelled ? "" : " unlabelled"} ${state}`;
          const shown = tailFit(text, width, tenPx);
          assert.ok(tenPx(shown) <= width, name);
          const parts = [
            { part: "typed text", rect: { x: head.x, y: lay.top + head.value, w: width, h: HEADER_VALUE_H }, radius: 0 },
            { part: "caret", rect: { x: caretX(head, scr, tenPx(shown)), y: lay.top + head.value + 1, w: 2, h: HEADER_VALUE_H - 2 }, radius: 0 },
          ];
          if (labelled) parts.push({ part: "label", rect: { x: head.x, y: lay.top + head.label, w: width, h: HEADER_LABEL_H }, radius: 0 });
          if (secret) parts.push({ part: "show button", rect: head.button, radius: 8 });
          for (const { part, rect, radius } of parts) {
            assert.ok(clearOfCorners(rect, radius, scr, corner), `${name}: ${part} ${JSON.stringify(rect)}`);
            assert.ok(rect.y + rect.h <= lay.top + lay.previewH, `${name}: ${part} below the header`);
          }
          if (labelled) assert.ok(head.label + HEADER_LABEL_H <= head.value, `${name}: label over text`);
          if (secret) {
            const b = head.button;
            assert.equal(b.y + b.h / 2, lay.top + head.value + HEADER_VALUE_H / 2, `${name}: button off the typed line`);
            assert.ok(head.x + width + 6 <= b.x && parts[1].rect.x + 2 <= b.x - 6, `${name}: text reaches the button`);
            assert.ok(b.w >= 48 && b.h >= 26, `${name}: button size`);
          }
        }
      }
    }
  }
}
// PicoKVM and Pro have square corners and keep their header.
assert.deepEqual(keyHeader(layoutKeys("text", 0, { w: 240, h: 240 }, "picokvm"), { w: 240, h: 240 }, true, true),
  { x: 16, right: 70, label: 3, value: 17, button: { x: 178, y: 6, w: 48, h: 30 } });
const goText = layoutKeys("text", 0, { w: 284, h: 240 }, "nanokvm-go");
const goGroups = goText.caps.filter((cap) => cap.chars.length > 1);
assert.equal(goGroups.length, 9);
assert.ok(goGroups.every((cap) => cap.w >= 86 && cap.h >= 43), "Go letter groups");
const goActions = goText.caps.filter((cap) => cap.chars.length === 0);
assert.equal(goActions.length, 5);
assert.ok(goActions.every((cap) => cap.w >= 48 && cap.h >= 43), "Go action row");
assert.ok(layoutKeys("ipv4", 0, { w: 284, h: 240 }, "nanokvm-go").caps.every((cap) => cap.w >= 86 && cap.h >= 34), "Go IPv4 keys");
// The top-left group's letters stay off the rounded corner and the panel edge.
const goChips = pickChips(goGroups[0], goText, { w: 284, h: 240 });
assert.ok(goChips[0].x >= cornerInset(40) && goChips[0].y >= cornerInset(40));
// PicoKVM keeps its board exactly.
const picoText = layoutKeys("text", 0, { w: 240, h: 240 }, "picokvm");
assert.equal(picoText.previewH, 40);
assert.deepEqual([picoText.caps[0].x, picoText.caps[0].y, picoText.caps[0].w, picoText.caps[0].h], [5, 40, 74, 46]);
// The setup preview walk (host-linux-fb/src/init_preview_tests.rs) holds these bottom-right groups.
for (const [machine, scr, rect] of [
  ["nanokvm-go", { w: 284, h: 240 }, [189, 141, 86, 43]],
  ["nanokvm-go", { w: 240, h: 284 }, [159, 167, 71, 52]],
  ["picokvm", { w: 240, h: 240 }, [161, 140, 74, 46]],
] as const) {
  const last = layoutKeys("text", 0, scr, machine).caps.filter((cap) => cap.chars.length > 1).at(-1)!;
  assert.deepEqual([last.x, last.y, last.w, last.h], rect, `${machine} ${scr.w}x${scr.h} preview group`);
}
assert.deepEqual(pickChips({ x: 5, ly: 40, w: 74, chars: ["a", "b", "c"] }, picoText, { w: 240, h: 240 })[0], { x: 2, y: 0, size: 36 });
// Long text shows its end, where typing continues.
const charWidth = (text: string) => Array.from(text).length * 10;
assert.equal(tailFit("short", 100, charWidth), "short");
assert.equal(tailFit("abcdefghijklmnop", 100, charWidth), "…hijklmnop");
assert.equal(tailFit("***************", 60, charWidth), "…*****");
assert.ok(keyRows("ipv4", 0).flat().includes("/"));
assert.ok(keyRows("ipv4", 0).flat().includes("."));
assert.equal(keyRows("ipv6", 0).flat().includes("/"), false);
assert.ok(keyRows("ipv6", 0).flat().includes(":"));
assert.ok(keyRows("ipv6", 0).flat().includes("a"));
assert.ok(keyRows("number", 0).flat().includes("0"));
assert.ok(keyRows("text", 0).flat().includes("OK"));
const picoKeys = layoutKeys("text", 0, { w: 240, h: 240 });
assert.equal(picoKeys.board, "nine");
assert.equal(picoKeys.caps.some((cap) => cap.token === "OK" && cap.icon === "enter"), true);
assert.equal(picoKeys.caps.some((cap) => cap.icon === "backspace"), true);
assert.equal(picoKeys.caps.find((cap) => cap.token === "SP")?.icon, "space");
assert.equal(picoKeys.caps.find((cap) => cap.token === "SP")?.label, "");
assert.equal(layoutKeys("text", 0, { w: 320, h: 172 }).caps.find((cap) => cap.token === "SP")?.icon, "space");
assert.ok(picoKeys.caps.every((cap) => cap.h >= 36));
const letters = picoKeys.caps.flatMap((cap) => cap.chars).join("");
for (const ch of "abcdefghijklmnopqrstuvwxyz") assert.ok(letters.includes(ch), ch);
assert.equal(picoKeys.caps.find((cap) => cap.token === "MD")?.label, "abc");
const picoNums = layoutKeys("text", 1, { w: 240, h: 240 });
assert.equal(picoNums.caps.find((cap) => cap.token === "MD")?.label, "123");
for (const digit of "0123456789") {
  assert.equal(picoNums.caps.some((cap) => cap.token === digit && cap.chars.length === 1), true, digit);
}
assert.ok(picoNums.caps.every((cap) => cap.h >= 36));
assert.equal(layoutKeys("text", 2, { w: 240, h: 240 }).caps.find((cap) => cap.token === "MD")?.label, "ABC");
// The grid keeps three modes and names the next one on the mode key.
assert.deepEqual([0, 1, 2].map((mode) => nextKeyMode(mode, { w: 320, h: 172 }, "nanokvm-pro")), [1, 2, 0]);
assert.deepEqual([0, 1, 2].map((mode) => layoutKeys("text", mode, { w: 320, h: 172 }, "nanokvm-pro").caps.find((cap) => cap.token === "MD")?.label), ["123", "ABC", "abc"]);
const proWide = layoutKeys("text", 0, { w: 320, h: 172 });
assert.ok(proWide.previewH >= KEY_HEADER_H);
assert.ok(proWide.caps.every((cap) => cap.h <= 20 && cap.h >= 14));
assert.ok(proWide.caps.every((cap) => cap.ly >= proWide.previewH));
assert.ok(proWide.caps.every((cap) => cap.y >= proWide.top + proWide.previewH));
assert.equal(layoutKeys("text", 0, { w: 172, h: 320 }).board, "grid");
assert.equal(layoutKeys("text", 0, { w: 240, h: 240 }, "nanokvm-pro").board, "grid");
assert.equal(layoutFor({ w: 240, h: 240 }).keyboard, "nine");
assert.equal(layoutFor({ w: 240, h: 240 }).welcome, "stack");
assert.equal(layoutFor({ w: 172, h: 320 }).keyboard, "grid");
assert.equal(layoutFor({ w: 320, h: 172 }).machine, "nanokvm-pro");
assert.equal(layoutFor({ w: 320, h: 172 }).welcome, "split");
assert.equal(welcomeBottom(1), 0);
assert.equal(welcomeBottom(2), WELCOME_PAGER_H);
for (const scr of [{ w: 284, h: 240 }, { w: 240, h: 284 }, { w: 240, h: 240 }, { w: 172, h: 320 }, { w: 320, h: 172 }]) {
  // The page dots sit at the bottom centre, clear of the rounded corners and the forward control.
  const pager = welcomePager(scr, 2);
  assert.equal(pager.dots.length, 2);
  assert.equal(pager.dots[0].x + pager.dots[1].x, scr.w);
  for (const dot of pager.dots) {
    assert.ok(dot.y + pager.ring / 2 <= scr.h - 4);
    assert.ok(dot.x - pager.ring / 2 >= pager.hit.x && dot.x + pager.ring / 2 <= pager.hit.x + pager.hit.w);
    assert.ok(dot.x > EDGE * 3 && dot.x < scr.w - EDGE * 3);
  }
  assert.equal(pager.hit.y + pager.hit.h, scr.h);
  const ip = welcomeLayout(scr, true, undefined, welcomeBottom(2));
  assert.ok(ip.next.y + ip.next.h <= pager.hit.y, `${scr.w}x${scr.h} forward control covers the page dots`);
  assert.ok(ip.next.x >= EDGE && ip.next.x + ip.next.w <= scr.w - EDGE);
  assert.ok((ip.hint?.x ?? 0) + (ip.hint?.w ?? 0) <= scr.w - 8);
  const plainFace = welcomeLayout(scr, false, undefined, welcomeBottom(2));
  assert.ok(plainFace.next.y + plainFace.next.h <= pager.hit.y);
}
assert.equal(welcomeLayout({ w: 284, h: 240 }, true, "split").next.y, 240 - EDGE - 48);
// Go's landscape panel stacks the logo, the addresses and the button, centred.
for (const bottom of [0, WELCOME_PAGER_H]) {
  const go = welcomeLayout({ w: 284, h: 240 }, true, undefined, bottom);
  const split = welcomeLayout({ w: 284, h: 240 }, true, "split", bottom);
  assert.ok(go.hint);
  assert.equal(go.hint.align, "center");
  assert.deepEqual(go.next, split.next, "the button keeps its size and place");
  // Wordmark columns of logo.png: 20..223 of 256.
  const inkCentre = go.logo.x + (go.logo.w * (20 + 223)) / 2 / 256;
  assert.ok(Math.abs(inkCentre - 142) <= 1, "wordmark centred");
  assert.equal(go.hint.x * 2 + go.hint.w, 284);
  // Wordmark rows of logo.png: 40..88 of 128.
  const inkTop = go.logo.y + (go.logo.h * 40) / 128;
  const inkBottom = go.logo.y + (go.logo.h * 88) / 128;
  assert.ok(go.logo.y >= 0 && inkTop >= EDGE, "the wordmark clears the top corners");
  assert.ok(inkBottom <= go.hint.y, "addresses below the logo");
  assert.ok(go.hint.y + go.hint.h <= go.next.y, "button below the addresses");
  assert.ok(go.next.y + go.next.h <= 240 - Math.max(EDGE, bottom));
  for (const ip of ["192.168.100.200", "255.255.255.255"]) {
    for (const line of welcomeHintLines("en", ip, 284)) {
      // Globe icon, gap and 14 px text.
      assert.ok(18 + 4 + estimateText(line, 1) <= go.hint.w, `${line} is clipped`);
    }
  }
}
assert.equal(welcomeLayout({ w: 320, h: 172 }, true).hint?.align, "start", "Pro Desk keeps the split face");
assert.equal(welcomeLayout({ w: 284, h: 240 }, true, "split", WELCOME_PAGER_H).next.y, 240 - WELCOME_PAGER_H - 48);
assert.equal(welcomeSwipeFace(0, -40, 4, 2), 1);
assert.equal(welcomeSwipeFace(1, -40, 4, 2), 0);
assert.equal(welcomeSwipeFace(0, 40, 4, 2), 1);
assert.equal(welcomeSwipeFace(0, -20, 0, 2), null, "a short drag is not a page turn");
assert.equal(welcomeSwipeFace(0, -40, 60, 2), null, "a vertical drag is not a page turn");
assert.equal(welcomeSwipeFace(0, -40, 0, 1), null);
assert.deepEqual(stepDots("language", 284).dots.map((dot) => dot.state), ["current", "next", "next", "next"]);
assert.deepEqual(stepDots("network", 284).dots.map((dot) => dot.state), ["done", "done", "current", "next"]);
assert.equal(stepDots("password", 284).dots[3].x + 3, 284 - TITLE_X);
assert.ok(stepDots("password", 172).dots[0].x - 3 >= 172 - stepDots("password", 172).right);
assert.deepEqual(wrapText("Scan to connect", 80, 8, estimateText), ["Scan to", "connect"]);
assert.deepEqual(wrapText("ABCDEFGH", 30, 0, estimateText), ["ABCD", "EFGH"]);
assert.deepEqual(wrapText("OneKVM", 200, 2, estimateText), ["OneKVM"]);
assert.equal(welcomeFaceAt(0, 2), 0);
assert.equal(welcomeFaceAt(19999, 2), 0);
assert.equal(welcomeFaceAt(20000, 2), 1);
assert.equal(welcomeFaceAt(40000, 2), 0);
assert.equal(welcomeFaceAt(20000, 1), 0);
assert.equal(welcomeFaceIndex(1, 0, 2), 1);
assert.equal(welcomeFaceIndex(1, 19999, 2), 1);
assert.equal(welcomeFaceIndex(1, 20000, 2), 0);
assert.equal(welcomeFaceIndex(1, 40000, 2), 1);
assert.equal(welcomeKnobFace(0, 1, 2), 1);
assert.equal(welcomeKnobFace(1, 1, 2), 0);
assert.equal(welcomeKnobFace(0, -1, 2), 1);
assert.equal(welcomeKnobFace(1, -3, 2), 0);
assert.equal(welcomeKnobFace(0, 5, 1), 0);
assert.equal(welcomeFaceProgress(0), 0);
assert.equal(welcomeFaceProgress(10000), 0.5);
const railWide = welcomeLayout({ w: 292, h: 172 }, true, "split");
assert.equal(railWide.hint?.align, "start");
assert.ok(railWide.logo.x + railWide.logo.w <= (railWide.hint?.x ?? 0));
assert.ok(railWide.next.x + railWide.next.w <= 292);
const apCopy = { title: "扫码连接", ssidLabel: "Wi-Fi", passwordLabel: "密码", ssid: "OneKVM", password: "ABCD2345EFGH" };
const apBox = (lay: ReturnType<typeof apFaceLayout>) => lay.lines.map((line) => ({
  ...line, w: estimateText(line.text, line.slot),
}));
for (const [scr, bottom] of [
  [{ w: 284, h: 240 }, WELCOME_PAGER_H], [{ w: 240, h: 284 }, WELCOME_PAGER_H], [{ w: 240, h: 240 }, WELCOME_PAGER_H],
  [{ w: 172, h: 320 }, WELCOME_PAGER_H], [{ w: 320, h: 172 }, WELCOME_PAGER_H], [{ w: 284, h: 240 }, 0],
] as const) {
  for (const copy of [apCopy, { ...apCopy, title: "Scan to connect", passwordLabel: "Password" },
    { ...apCopy, ssid: "Office network, second floor 5G", password: "A".repeat(63) }]) {
    const lay = apFaceLayout(scr, 29, copy, estimateText, bottom);
    const name = `${scr.w}x${scr.h} ${copy.ssid}`;
    assert.equal(lay.qr.size, lay.qr.module * (29 + 8), `${name} keeps a four-module quiet zone`);
    assert.ok(lay.qr.x >= EDGE && lay.qr.y >= EDGE, name);
    assert.ok(lay.qr.x + lay.qr.size <= scr.w - EDGE, name);
    assert.ok(lay.qr.y + lay.qr.size <= scr.h - Math.max(EDGE, bottom), `${name} code covers the page dots`);
    for (const line of apBox(lay)) {
      assert.ok(line.x >= 8 && line.x + line.w <= scr.w - 8, `${name}: ${line.text} leaves the panel`);
      assert.ok(line.y >= EDGE && line.y + 16 <= scr.h - Math.max(EDGE, bottom) + 4, `${name}: ${line.text} covers the page dots`);
      const besideCode = line.y < lay.qr.y + lay.qr.size && line.y + 16 > lay.qr.y;
      if (besideCode) assert.ok(line.x >= lay.qr.x + lay.qr.size || line.x + line.w <= lay.qr.x, `${name}: ${line.text} overlaps the code`);
    }
    assert.equal(lay.lines.map((line) => line.text).join("").replace(/ /g, "").includes(copy.password), true, name);
  }
}
// Go's landscape panel: a 4 px module (148 px code) beside 16 px credentials.
const goAp = apFaceLayout({ w: 284, h: 240 }, 29, apCopy, (text, slot) => Math.ceil(estimateText(text, slot) * 0.88), WELCOME_PAGER_H);
assert.equal(goAp.qr.module, 4);
assert.ok(goAp.lines.some((line) => line.text === "ABCD2345EFGH" && line.slot === 2));
// Pro's portrait panel stacks the title, the code and the credentials.
const proAp = apFaceLayout({ w: 172, h: 320 }, 29, apCopy, estimateText, WELCOME_PAGER_H);
assert.equal(proAp.qr.module, 4);
assert.ok(proAp.lines[0].tone === "title" && proAp.lines[0].y + 19 <= proAp.qr.y);
assert.ok(proAp.lines.slice(1).every((line) => line.y >= proAp.qr.y + proAp.qr.size));
const wide = welcomeLayout({ w: 320, h: 172 }, true);
assert.ok(wide.hint);
assert.ok(wide.logo.x < wide.hint.x);
assert.ok(wide.logo.x + wide.logo.w <= wide.hint.x);
assert.equal(wide.hint.align, "start");
assert.ok(wide.logo.y + wide.logo.h <= wide.next.y);
assert.ok(wide.hint.y + wide.hint.h <= wide.next.y);
const key = { x: 10, y: 100, w: 70, h: 52, token: "a", chars: ["a", "b", "c"] };
assert.equal(releaseKey([key], 0, 20, 110, false, 0), "a");
assert.equal(releaseKey([key], 0, 95, 140, false, 0), "a");
assert.equal(releaseKey([key], 0, 200, 110, false, 0), null);
assert.equal(releaseKey([key], 0, 200, 110, true, 2), "c");
assert.equal(releaseKey([key], -1, 20, 110, false, 0), null);
const row = [{ x: 10, size: 36 }, { x: 50, size: 36 }, { x: 90, size: 36 }];
assert.equal(chipAt(row, 10), 0);
assert.equal(chipAt(row, 45), 0);
assert.equal(chipAt(row, 47), 0);
assert.equal(chipAt(row, 48), 1);
assert.equal(chipAt(row, 125), 2);
assert.equal(chipAt(row, -40), 0);
assert.equal(chipAt(row, 300), 2);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const layout of MACHINE_LAYOUTS) {
  const file = JSON.parse(readFileSync(join(root, "packaging/onekvm/layouts", `${layout.machine}.json`), "utf8"));
  assert.equal(file.machine, layout.machine);
  assert.equal(file.keyboard, layout.keyboard);
  assert.equal(file.match.width, layout.match.width);
  assert.equal(file.match.height, layout.match.height);
  assert.equal(file.welcome, layout.welcome);
  assert.equal(file.corner, layout.corner);
}

console.log("flow tests ok");

for (const lang of ["zh", "zh_tw", "en"]) {
  for (const code of ["storage-unmounted", "storage-read-only", "storage-full", "storage-io", "storage-permission", "storage-write", "boot-slot", "system-files", "config-invalid", "persistence-failed", "persistence-skipped", "persistence-starting", "core-starting", "core-failed", "core-unreachable", "status-unavailable", "check-timeout"]) {
    assert.ok(startupMessage(code, lang), `${code} has no ${lang} explanation`);
  }
}
