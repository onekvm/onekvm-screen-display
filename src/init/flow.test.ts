import { startupMessage } from "./startup-copy";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keyboardMark, keyRows, layoutKeys, maskSecret, releaseKey, slidePick } from "../shell/keypad";
import { MACHINE_LAYOUTS, layoutFor } from "../shell/layouts";
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
  welcomeContentWidth,
  welcomeFaceAt,
  welcomeFaceIndex,
  welcomeKnobFace,
  welcomeFaceProgress,
  welcomeHintLines,
  welcomeLayout,
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
  const lines = welcomeHintLines("zh", "203.0.113.144", scr.w);
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
assert.deepEqual(welcomeHintLines("zh", "203.0.113.144", 240), [
  "find.onekvm.org",
  "203.0.113.144",
]);
assert.deepEqual(welcomeHintLines("zh_tw", "10.0.0.8", 240), ["find.onekvm.org", "10.0.0.8"]);
assert.deepEqual(welcomeHintLines("en", "10.0.0.8", 172), ["find.onekvm.org", "10.0.0.8"]);
assert.equal(copy("zh").onDevice, "在此屏幕设置");
assert.equal(copy("zh_tw").onDevice, "在此螢幕設定");
assert.equal(copy("en").onDevice, "Set up here");
assert.equal(copy("zh").dismiss, "知道了");
assert.equal(copy("en").dismiss, "OK");
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
  ip: "203.0.113.144",
  links: [
    { name: "eth0", kind: "eth" },
    { name: "wlan0", kind: "wifi" },
  ],
}));
assert.equal(addressed[0]?.detail, "203.0.113.144");
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
]) {
  for (const kind of ["text", "ipv4", "ipv6", "number"] as const) {
    for (const mode of [0, 2]) {
      const lay = layoutKeys(kind, mode, scr);
      assert.ok(lay.caps.length > 0);
      for (const cap of lay.caps) {
        assert.ok(cap.x >= 0 && cap.y >= 0, `${kind} ${scr.w}x${scr.h}`);
        assert.ok(cap.x + cap.w <= scr.w, `${kind} ${cap.token} x`);
        assert.ok(cap.y + cap.h <= scr.h, `${kind} ${cap.token} y`);
      }
    }
  }
}
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
assert.equal(picoKeys.caps.find((cap) => cap.token === "MD")?.label, "123");
const picoNums = layoutKeys("text", 1, { w: 240, h: 240 });
assert.equal(picoNums.caps.find((cap) => cap.token === "MD")?.label, "ABC");
for (const digit of "0123456789") {
  assert.equal(picoNums.caps.some((cap) => cap.token === digit && cap.chars.length === 1), true, digit);
}
assert.ok(picoNums.caps.every((cap) => cap.h >= 36));
assert.equal(layoutKeys("text", 2, { w: 240, h: 240 }).caps.find((cap) => cap.token === "MD")?.label, "abc");
const proWide = layoutKeys("text", 0, { w: 320, h: 172 });
assert.ok(proWide.previewH >= 40);
assert.ok(proWide.caps.every((cap) => cap.h <= 16 && cap.h >= 14));
assert.ok(proWide.caps.every((cap) => cap.ly >= proWide.previewH));
assert.ok(proWide.caps.every((cap) => cap.y >= proWide.top + proWide.previewH));
assert.equal(layoutKeys("text", 0, { w: 172, h: 320 }).board, "grid");
assert.equal(layoutKeys("text", 0, { w: 240, h: 240 }, "nanokvm-pro").board, "grid");
assert.equal(layoutFor({ w: 240, h: 240 }).keyboard, "nine");
assert.equal(layoutFor({ w: 240, h: 240 }).welcome, "stack");
assert.equal(layoutFor({ w: 172, h: 320 }).keyboard, "grid");
assert.equal(layoutFor({ w: 320, h: 172 }).machine, "nanokvm-pro");
assert.equal(layoutFor({ w: 320, h: 172 }).welcome, "split");
assert.equal(welcomeContentWidth(320, 1), 320);
assert.equal(welcomeContentWidth(320, 2), 292);
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
const wideAp = apFaceLayout({ w: 292, h: 172 }, 29);
assert.ok(wideAp.qr.x + wideAp.qr.size <= wideAp.text.x);
assert.ok(wideAp.text.w >= 80);
assert.ok(wideAp.qr.y + wideAp.qr.size <= 172);
assert.ok(wideAp.text.y + wideAp.text.row * 2 <= 172);
const tallAp = apFaceLayout({ w: 240, h: 240 }, 29);
assert.ok(tallAp.text.y >= tallAp.qr.y + tallAp.qr.size);
assert.ok(tallAp.qr.x + tallAp.qr.size <= 240);
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
assert.equal(slidePick(0, 4, 28), 0);
assert.equal(slidePick(28, 4, 28), 1);
assert.equal(slidePick(100, 4, 28), 3);
assert.equal(slidePick(-8, 4, 28), 0);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const layout of MACHINE_LAYOUTS) {
  const file = JSON.parse(readFileSync(join(root, "packaging/onekvm/layouts", `${layout.machine}.json`), "utf8"));
  assert.equal(file.machine, layout.machine);
  assert.equal(file.keyboard, layout.keyboard);
  assert.equal(file.match.width, layout.match.width);
  assert.equal(file.match.height, layout.match.height);
  assert.equal(file.welcome, layout.welcome);
}

console.log("flow tests ok");

for (const lang of ["zh", "zh_tw", "en"]) {
  for (const code of ["storage-unmounted", "storage-read-only", "storage-full", "storage-io", "storage-permission", "storage-write", "boot-slot", "system-files", "config-invalid", "persistence-failed", "persistence-skipped", "persistence-starting", "core-starting", "core-failed", "core-unreachable", "status-unavailable", "check-timeout"]) {
    assert.ok(startupMessage(code, lang), `${code} has no ${lang} explanation`);
  }
}
