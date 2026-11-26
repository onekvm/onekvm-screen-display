import assert from "node:assert/strict";
import { nextTick } from "vue";

const { mount } = await import("@pocketjs/framework/vue-vapor");
const { rootMirror } = await import("@pocketjs/framework/renderer");
const { default: Settings } = await import("./Settings.tsx");
const { rowArmed } = await import("../../../src/shell/ListRow");
const { __packTouch } = await import("../../../../tmp/pocketjs/framework/src/touch.ts");
const { layoutKeys } = await import("../../../src/shell/keypad");
const { pinKeypad } = await import("./pinKeypad");

type Mirror = {
  id: number;
  onPress?: () => void;
  text?: string;
  children: Mirror[];
  domAttrs?: { class?: unknown; src?: unknown };
};

const keys = new Map<string, string>([
  ["knobOn", "1"],
  ["knob", "0"],
  ["knobClick", "0"],
  ["knobHold", "0"],
  ["knobSeq", "0"],
  ["back", "0"],
  ["appScrollTransition", ""],
  ["screenW", "320"],
  ["screenH", "172"],
  ["touchOn", process.env.SETTINGS_SIM_TOUCH === "1" ? "1" : "0"],
  ["language", "zh"],
  ["timezone", "UTC"],
  ["brightness", "40"],
  ["rotate", process.env.SETTINGS_SIM_TOUCH === "1" ? "0" : "270"],
  ["rotations", process.env.SETTINGS_SIM_TOUCH === "1" ? "[0,180]" : "[0,90,180,270]"],
  ["appView", "list"],
  ["apps", "[]"],
  ["layout", "{}"],
  ["system", "{}"],
  ["blankSeconds", "0"],
  ["links", "[]"],
  ["wifiScan", "[]"],
  ["wifiSsid", ""],
  ["ip", ""],
  ["systemCapabilities", '{"reboot":true,"factory-reset":true,"recovery":true}'],
  ["localRecoveryAvailable", "1"],
  ["adbDebugStatus", '{"state":"off"}'],
  ["systemReady", "1"],
  ["systemHoldReady", "1"],
  ["knobPressed", "0"],
]);
const animations: number[][] = [];
const networkReads: string[] = [];
const networkWrites: string[] = [];
const hotspotWrites: string[] = [];
const propSets: number[][] = [];

function testOps() {
  let nextId = 2;
  const noop = () => {};
  return {
    createNode: () => nextId++,
    destroyNode: noop,
    insertBefore: noop,
    removeChild: noop,
    setStyle: noop,
    setProp: (...args: number[]) => { propSets.push(args); },
    setText: noop,
    replaceText: noop,
    uploadTexture: () => 1,
    setImage: noop,
    setSprite: noop,
    animate: (...args: number[]) => {
      animations.push(args);
      return animations.length;
    },
    cancelAnim: noop,
    setFocus: noop,
    setActive: noop,
    measureText: () => 8,
    __textures: {} as Record<string, number>,
  };
}

function classOf(node: Mirror): string {
  return String(node.domAttrs?.class ?? "");
}

function isSelectedClass(value: string): boolean {
  return value.split(/\s+/).includes("bg-blue-500");
}

function texts(node: Mirror): string[] {
  const out: string[] = [];
  if (node.text) out.push(node.text);
  for (const child of node.children) out.push(...texts(child));
  return out;
}

function imageSources(node: Mirror): string[] {
  return [
    ...(typeof node.domAttrs?.src === "string" ? [node.domAttrs.src] : []),
    ...node.children.flatMap(imageSources),
  ];
}

function selectedTitles(): string[] {
  const out: string[] = [];
  const walk = (node: Mirror) => {
    const cls = classOf(node);
    if (isSelectedClass(cls) && cls.includes("rounded-xl")) {
      const title = texts(node).find((line) => line.trim().length > 0);
      if (title) out.push(title);
    }
    for (const child of node.children) walk(child);
  };
  walk(rootMirror as unknown as Mirror);
  return [...new Set(out)];
}

const ops = testOps();
(globalThis as { ui?: typeof ops }).ui = ops;
(globalThis as { onekvm?: { get: (key: string) => string; set: (key: string, value: string) => void } }).onekvm = {
  get(key) {
    if (["ip", "wifiSsid", "links"].includes(key)) networkReads.push(key);
    return keys.get(key) ?? "";
  },
  set(key, value) {
    keys.set(key, value);
    if (key === "layout" || key === "appView") {
      if (key === "appView") keys.set("layout", JSON.stringify({ ...JSON.parse(keys.get("layout") || "{}"), app_view: value }));
      keys.set("appsGen", String(Number(keys.get("appsGen") || 0) + 1));
    }
    if (key === "netApply" || key === "wifiApApply") {
      (key === "netApply" ? networkWrites : hotspotWrites).push(value);
      keys.set("setupBusy", "1");
      keys.set("setupError", "");
    }
    if (key === "appUnlock" || key === "appLockConfigure") {
      const state = JSON.parse(keys.get("appLockState") || "{}");
      keys.set("appLockState", JSON.stringify({ ...state, busy: true, result: "" }));
    }
  },
};

mount(() => <Settings />, { ops });

function frame(touches: number[] = []) {
  const tick = (globalThis as { frame?: (buttons: number, analog: number, touches: number[]) => void }).frame;
  if (!tick) throw new Error("settings did not install a frame tick");
  tick(0, 0, touches);
}

async function contact(x?: number, y?: number, cancel = false) {
  const touches = x === undefined ? [] : [(__packTouch(0, x, y!) | (cancel ? 0x40000000 : 0)) >>> 0];
  frame(touches);
  await nextTick();
}

function translateY(node: number): number {
  return propSets.findLast(([id, prop]) => id === node && prop === 129)?.[2] ?? 0;
}

let seq = 0;
async function act(input: { knob?: number; click?: boolean }) {
  seq += 1;
  keys.set("knob", String(input.knob ?? 0));
  keys.set("knobClick", input.click ? "1" : "0");
  keys.set("knobHold", "0");
  keys.set("knobSeq", String(seq));
  frame();
  await nextTick();
  frame();
  await nextTick();
}

frame();
await nextTick();
frame();
await nextTick();
assert.deepEqual(selectedTitles(), ["屏幕"], `home start ${selectedTitles().join(",")}`);
for (const icon of ["screen", "net", "region", "display", "about"]) {
  assert.ok(imageSources(rootMirror as unknown as Mirror).includes(`assets/${icon}.png`), `missing Settings icon ${icon}`);
}
assert.ok(imageSources(rootMirror as unknown as Mirror).includes("screen-ui/back.png"), "Settings must package the shared Back resource");
assert.ok(texts(rootMirror as unknown as Mirror).includes("返回"), "rotary home has no Back row");
for (const detail of ["永不", "未连接", "列表", "简体中文"]) {
  assert.equal(texts(rootMirror as unknown as Mirror).includes(detail), false, `home leaked ${detail}`);
}

await act({ knob: 1 });
assert.deepEqual(selectedTitles(), ["网络"], `home second ${selectedTitles().join(",")}`);
assert.equal(keys.get("appScrollTransition")?.split(":").length, 8, "settings did not provide a complete list layer");

for (const title of ["区域和时间", "App 锁定", "恢复", "App 显示方式", "关于 OneKVM", "返回"]) {
  await act({ knob: 1 });
  assert.deepEqual(selectedTitles(), [title], `home order ${selectedTitles().join(",")}`);
}
await act({ knob: -7 });
assert.deepEqual(selectedTitles(), ["屏幕"], `home order reset ${selectedTitles().join(",")}`);

await act({ knob: -1 });
const pageAnimations = animations.length;
await act({ click: true });
assert.ok(selectedTitles().includes("亮度"), `screen page ${selectedTitles().join(",")}`);
assert.ok(texts(rootMirror as unknown as Mirror).includes("返回"), "rotary subpage has no Back row");
assert.equal(keys.get("appPageTransition"), "1", "screen page did not request a host transition");
assert.equal(animations.length, pageAnimations, "screen page still ran a guest-side slide");

networkReads.length = 0;
await act({ knob: 1 });
assert.deepEqual(networkReads, [], "screen scroll waited on unrelated network status");
assert.ok(selectedTitles().includes("熄屏"), `blank row ${selectedTitles().join(",")}`);
assert.ok(keys.get("appScrollTransition")?.startsWith("1:"), "scroll did not request a host transition");
assert.equal(selectedTitles().includes("亮度"), false, selectedTitles().join(","));
const blankScroll = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(blankScroll.length, 8);
assert.ok(blankScroll[4] > 1 && blankScroll[5] > 0, "missing settings list mirror");
assert.ok(blankScroll[6] > 0 && blankScroll[7] > 172, "list cache contains only the viewport");

const drawerAnimations = animations.length;
await act({ click: true });
assert.ok(keys.get("appDrawerTransition")?.startsWith("1:"), "option drawer did not request a host enter transition");
assert.equal(animations.length, drawerAnimations, "option drawer still ran a guest-side enter animation");
const drawerExitAnimations = animations.length;
await act({ click: true });
assert.ok(keys.get("appDrawerTransition")?.startsWith("0:"), "option drawer did not request a host exit transition");
assert.equal(animations.length, drawerExitAnimations, "option drawer still ran a guest-side exit animation");

await act({ knob: 1 });
assert.ok(selectedTitles().includes("旋转方向"), `rotate row ${selectedTitles().join(",")}`);
assert.equal(selectedTitles().includes("熄屏"), false, selectedTitles().join(","));
await act({ click: true });
const rotationLabels = texts(rootMirror as unknown as Mirror).filter(text => /^\d+°$/.test(text));
if (process.env.SETTINGS_SIM_TOUCH === "1") {
  assert.ok(rotationLabels.includes("0°") && rotationLabels.includes("180°"));
  assert.ok(!rotationLabels.includes("90°") && !rotationLabels.includes("270°"), "Pro must hide sideways rotations");
  await act({ knob: 1 });
  await act({ click: true });
  assert.equal(keys.get("rotate"), "180", "Pro's second rotary choice must be 180°, not 90°");
} else {
  for (const label of ["0°", "90°", "180°", "270°"]) assert.ok(rotationLabels.includes(label));
  await act({ click: true });
}

// A fast encoder turn may arrive as several detents in one frame. The
// viewport and cursor must advance together instead of scrolling past the
// highlighted row.
await act({ knob: 2 });
assert.ok(selectedTitles().includes("返回"), `fast scroll cursor ${selectedTitles().join(",")}`);
await act({ knob: -2 });
assert.ok(selectedTitles().includes("熄屏"), `fast scroll reverse ${selectedTitles().join(",")}`);

keys.set("back", "1");
frame();
await nextTick();
keys.set("back", "0");
frame();
await nextTick();
assert.deepEqual(selectedTitles(), ["屏幕"], `back to home ${selectedTitles().join(",")}`);
assert.equal(keys.get("appPageTransition"), "-1", "back did not request a reverse host transition");
keys.set("back", "1");
frame();
await nextTick();
keys.set("back", "0");
assert.equal(keys.get("launch"), "shell", "right-swipe Back at settings root did not leave the app");
keys.delete("launch");

networkReads.length = 0;
keys.set("settingsPage", "network");
frame();
await nextTick();
assert.ok(networkReads.includes("ip") && networkReads.includes("wifiSsid") && networkReads.includes("links"), "network page stopped refreshing live status");

function pressRow(title: string, node: Mirror = rootMirror as unknown as Mirror): boolean {
  if (node.children.some(child => pressRow(title, child))) return true;
  if (node.onPress && texts(node).includes(title)) {
    node.onPress();
    return true;
  }
  return false;
}
const hotspot = {
  available: true, ap_interface: "onekvm-ap0", ap_enabled: true, ap_ssid: "OneKVM",
  ap_band: "2.4", ap_channel: 6, ap_channels: [1, 6, 11, 36, 40],
  ap_network: { address: "192.168.77.1/24", dhcp_enabled: true, dhcp_start: "192.168.77.100", dhcp_end: "192.168.77.199" },
};
keys.set("wifiAp", JSON.stringify(hotspot));
// A legacy host may classify the AP as Wi-Fi. Its Core role must still win.
keys.set("links", JSON.stringify([{ kind: "wifi", name: "onekvm-ap0" }, { kind: "wifi", name: "wlan0" }]));
keys.delete("wifiScan");
frame(); await nextTick();
assert.ok(pressRow("无线热点"));
frame(); await nextTick(); frame(); await nextTick();
for (const label of ["热点名称", "频段", "信道", "DHCP", "192.168.77.1/24"]) assert.ok(texts(rootMirror as unknown as Mirror).includes(label), label);
assert.equal(keys.has("wifiScan"), false, "hotspot opened the station scanner");
await act({ knob: 7 });
assert.ok(selectedTitles().includes("地址池起始"), "DHCP row is not reachable");
const hotspotScroll = keys.get("appScrollTransition")!.split(":").map(Number);
assert.ok(hotspotScroll[6] > 300 && hotspotScroll[7] > 600, "hotspot scroll bounds include only the first row");
await act({ knob: -7 });
assert.ok(pressRow("热点名称")); frame(); await nextTick();
const apCaps = layoutKeys("text", 0, { w: 320, h: 172 }).caps;
let apKey = 0;
for (const token of [...Array(6).fill("BS"), "a", "p", "l", "a", "b", "OK"]) {
  const next = apCaps.findIndex(cap => cap.token === token);
  await act({ knob: next - apKey }); apKey = next; await act({ click: true });
}
keys.set("wifiAp", JSON.stringify({ ...hotspot, ap_operating_channel: 6 })); frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("aplab"), "live status erased the hotspot draft");
assert.ok(pressRow("应用")); frame(); await nextTick();
const apRequest = JSON.parse(hotspotWrites[0]);
assert.equal(apRequest.action, "ap-config");
assert.equal(apRequest.request.ssid, "aplab");
assert.equal("password" in apRequest.request, false, "unchanged password must stay private and be preserved");
assert.deepEqual(apRequest.request.network, hotspot.ap_network);
assert.equal(networkWrites.length, 0, "AP settings reached the wired/station configuration API");
keys.set("setupBusy", "0"); keys.set("setupError", "invalid AP password"); frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("密码需 8～63 个字符"));
assert.ok(pressRow("重试")); frame(); await nextTick();
assert.equal(hotspotWrites.length, 2, "retry used a different network action");
keys.set("setupBusy", "0"); frame(); await nextTick();
assert.ok(pressRow("确定")); frame(); await nextTick();
assert.ok(pressRow("无线热点")); frame(); await nextTick();
assert.deepEqual(JSON.parse(hotspotWrites[2]), { action: "ap", request: { enabled: false } });
keys.set("setupBusy", "0"); keys.set("wifiAp", JSON.stringify({ ...hotspot, ap_enabled: false })); frame(); await nextTick();
assert.ok(pressRow("确定")); frame(); await nextTick();
keys.set("back", "1"); frame(); await nextTick(); keys.set("back", "0");
keys.set("links", JSON.stringify([{ kind: "wifi", name: "wlan0" }])); frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("无线热点"), "disabled hotspot lost its configuration entry");
assert.ok(pressRow("wlan0")); frame(); await nextTick();
assert.equal(keys.get("wifiScan"), "1", "station no longer opens its network scanner");
keys.set("wifiGeneration", "Wi-Fi 6");
keys.set("wifiScan", JSON.stringify([
  { ssid: "Wi-Fi 7 router", secure: true, security: "wpa2", bands: ["5"], generation: "Wi-Fi 7" },
  { ssid: "Wi-Fi 5 router", secure: true, security: "wpa2", bands: ["5"], generation: "Wi-Fi 5" },
]));
frame(); await nextTick();
let wifiLabels = texts(rootMirror as unknown as Mirror);
assert.equal(wifiLabels.filter(label => label === "Wi-Fi 6").length, 2, "network badges must use the device hardware maximum");
assert.ok(!wifiLabels.includes("Wi-Fi 7") && !wifiLabels.includes("Wi-Fi 5"), "hotspot standards replaced hardware capability");
keys.set("wifiGeneration", ""); frame(); await nextTick();
wifiLabels = texts(rootMirror as unknown as Mirror);
assert.ok(!wifiLabels.includes("Wi-Fi 6") && !wifiLabels.includes("Wi-Fi 7"), "unknown hardware capability must not fall back to hotspot data");
keys.set("back", "1"); frame(); await nextTick(); keys.set("back", "0");
keys.set("wifiAp", "");
keys.set("links", JSON.stringify([{ kind: "eth", name: "eth0" }]));
frame();
await nextTick();
assert.ok(pressRow("eth0"), "wired interface could not be opened");
frame();
await nextTick();
assert.ok(pressRow("应用"), "Apply row did not dispatch a press");
frame();
await nextTick();
assert.equal(JSON.parse(networkWrites[0]).parent, "eth0");
assert.ok(texts(rootMirror as unknown as Mirror).includes("正在应用…"), "Apply has no pending feedback");
assert.ok(texts(rootMirror as unknown as Mirror).includes("正在保存网络配置"), "network progress has no modal content");
assert.ok(texts(rootMirror as unknown as Mirror).includes("应用"), "Apply row became the progress indicator");
assert.ok(pressRow("应用"));
assert.equal(networkWrites.length, 1, "repeated Apply queued duplicate network changes");
await act({ knob: 3 });
await act({ click: true });
keys.set("back", "1"); frame(); await nextTick(); keys.set("back", "0");
assert.ok(texts(rootMirror as unknown as Mirror).includes("正在应用…"), "Back or rotary input dismissed a pending operation");
assert.equal(networkWrites.length, 1, "pending modal allowed a repeated rotary submit");
keys.set("setupBusy", "0");
keys.set("setupError", "org.onekvm.Core1.Error.Failed: network.ipv4_address must use address/prefix format");
frame();
await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("应用失败"), "network failure was swallowed");
assert.ok(texts(rootMirror as unknown as Mirror).includes("检查 IP 地址和前缀"), "network failure lost its actionable reason");
assert.ok(!texts(rootMirror as unknown as Mirror).some(text => text.includes("org.onekvm.Core1")), "backend diagnostics overflow the panel");
assert.ok(texts(rootMirror as unknown as Mirror).includes("返回修改"));
assert.ok(texts(rootMirror as unknown as Mirror).includes("重试"));
await act({ knob: 1 });
await act({ click: true });
frame();
await nextTick();
keys.set("setupBusy", "0");
frame();
await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("已应用"), "successful Apply has no completion feedback");
assert.equal(networkWrites.length, 2, "failed network Apply could not be retried");
assert.ok(texts(rootMirror as unknown as Mirror).includes("确定"), "success modal has no dismissal action");
await act({ knob: 5 });
await act({ click: true });
assert.ok(!texts(rootMirror as unknown as Mirror).includes("已应用"), "rotary confirmation did not close the success modal");
assert.ok(texts(rootMirror as unknown as Mirror).includes("应用"), "closing the modal lost the edited form");
assert.ok(pressRow("应用")); frame(); await nextTick();
keys.set("setupBusy", "0"); keys.set("setupError", "vlan"); frame(); await nextTick();
await act({ click: true });
assert.equal(networkWrites.length, 3, "default error action retried instead of returning to edit");
assert.ok(!texts(rootMirror as unknown as Mirror).includes("应用失败"));
assert.ok(pressRow("应用")); frame(); await nextTick();
keys.set("setupBusy", "0"); keys.set("setupError", "gateway"); frame(); await nextTick();
assert.ok(pressRow("重试")); frame(); await nextTick();
assert.equal(networkWrites.length, 5, "touch Retry did not resubmit the preserved form");
keys.set("setupBusy", "0"); frame(); await nextTick();
assert.ok(pressRow("确定")); frame(); await nextTick();
assert.ok(!texts(rootMirror as unknown as Mirror).includes("已应用"), "touch confirmation did not close the success modal");

keys.set("touchOn", "1");
keys.set("knobOn", "0");
keys.set("settingsPage", "screen");
frame();
await nextTick();
frame();
await nextTick();
assert.equal(texts(rootMirror as unknown as Mirror).includes("返回"), false, "pure touch gained a list Back row");
const unchanged = keys.get("brightness");
await contact(160, 80);
assert.equal(keys.get("brightness"), unchanged, "brightness changed on DOWN");
await contact(230, 80);
await contact();
assert.equal(keys.get("brightness"), unchanged, "unarmed horizontal drag changed brightness");
assert.equal(rowArmed.value, false, "drag accidentally entered brightness editing");
assert.ok(texts(rootMirror as unknown as Mirror).includes("恢复"), "right swipe on a resting brightness row did not return Home");
assert.equal(keys.get("appPageTransition"), "-1");
keys.set("settingsPage", "screen");
frame();
await nextTick();

// Broad content Back must reject short, leftward and vertical gestures.
for (const [dx, dy] of [[20, 0], [-60, 0], [15, 40]]) {
  keys.delete("appPageTransition");
  await contact(160, 30);
  await contact(160 + dx, 30 + dy);
  await contact();
  assert.equal(keys.has("appPageTransition"), false, `non-Back drag ${dx},${dy} navigated`);
}

// Only a released tap enters adjustment; even a far-right tap keeps the value.
await contact(270, 80);
await contact();
assert.equal(rowArmed.value, true, "tap did not enter brightness adjustment");
assert.equal(keys.get("brightness"), unchanged, "opening tap changed brightness");
await contact(140, 80);
assert.equal(keys.get("brightness"), unchanged, "adjustment DOWN jumped to finger position");
await contact(168, 80);
assert.equal(keys.get("brightness"), "50", "relative drag did not adjust by its travel");
await contact();
assert.ok(texts(rootMirror as unknown as Mirror).includes("亮度"), "armed slider swipe navigated away");

keys.delete("appScrollTransition");
await contact(160, 80);
await contact(160, 50);
await contact();
assert.equal(keys.get("brightness"), "50", "vertical drag changed brightness");
assert.equal(keys.has("appScrollTransition"), false, "brightness editing allowed page scrolling");
await contact(160, 80);
await contact(160, 80, true);
await contact();
assert.equal(rowArmed.value, true, "cancel was mistaken for a finishing tap");

keys.delete("appPageTransition");
keys.set("back", "1");
frame();
await nextTick();
keys.set("back", "0");
assert.equal(rowArmed.value, false, "Back did not exit brightness adjustment");
assert.equal(keys.has("appPageTransition"), false, "Back left the screen page instead of adjustment");

await contact(160, 100);
await contact(160, 60);
await contact();
const dragScroll = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(dragScroll[1], 30, "release animation restarted from the pre-drag position");
assert.equal(dragScroll[6], 70, "page drag did not settle at the screen-page boundary");
assert.equal(translateY(dragScroll[4]), -70);
keys.delete("appScrollTransition");
await contact(160, 80);
await contact(220, 80);
assert.equal(translateY(dragScroll[4]), -70, "foreign gesture cancellation rewound the list");
await contact();
assert.equal(keys.has("appScrollTransition"), false, "cancelled observer emitted an animation");
assert.equal(keys.get("appPageTransition"), "-1", "central content swipe did not return");

// Grabbing a cached rotary animation adopts the actually displayed offset.
keys.set("settingsPage", "home");
frame();
await nextTick();
keys.set("settingsPage", "screen");
frame();
await nextTick();
keys.set("knobOn", "1");
frame();
await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("返回"), "late rotary detection did not show Back");
await act({ knob: 1 });
const rotary = keys.get("appScrollTransition")!.split(":").map(Number);
keys.set("appScrollPosition", `${rotary[4]}:3`);
await contact(240, 120);
assert.equal(translateY(rotary[4]), -3, "mid-animation grab jumped to the old target");
keys.delete("appScrollPosition");
await contact(240, 80);
assert.equal(translateY(rotary[4]), -43, "touch did not continue from the displayed offset");
await contact();
assert.equal(keys.get("appScrollTransition")!.split(":")[1], "82");

// Dual-input devices keep the same focusable Back row, row count, scroll
// bounds and activation as rotary-only devices on every settings subpage.
for (const page of ["screen", "region", "timezone", "display", "about", "restore", "lock"]) {
  keys.set("settingsPage", "home");
  frame();
  await nextTick();
  keys.set("settingsPage", page);
  frame();
  await nextTick();
  assert.ok(texts(rootMirror as unknown as Mirror).includes("返回"), `${page} has no dual-input Back row`);
  await act({ knob: 999 });
  assert.deepEqual(selectedTitles(), page === "timezone" ? ["UTC", "返回"] : ["返回"], `${page} Back is not reachable by rotary`);
  if (page === "screen") {
    const scroll = keys.get("appScrollTransition")!.split(":").map(Number);
    assert.equal(scroll[6], 138, "dual-input scroll bounds omit the Back row");
    assert.equal(scroll[7], 288, "dual-input cached list omits the Back row");
  }
  await act({ click: true });
  assert.equal(keys.get("appPageTransition"), "-1", `${page} Back did not reverse navigation`);
  assert.deepEqual(selectedTitles(), [page === "timezone" ? "语言" : "屏幕"], `${page} Back went to the wrong parent`);
}
keys.set("settingsPage", "home");
frame();
await nextTick();
await act({ knob: 999 });
assert.deepEqual(selectedTitles(), ["返回"], "dual-input root Back is not reachable");
await act({ click: true });
assert.equal(keys.get("launch"), "shell", "dual-input root Back did not leave Settings");

const realNow = Date.now;
let now = realNow();
Date.now = () => now;
keys.delete("systemExecute");
keys.set("settingsPage", "restore");
frame();
await nextTick();
await act({ click: true });
assert.equal(keys.get("systemPrepare"), "reboot");
assert.ok(texts(rootMirror as unknown as Mirror).includes("请等待 5 秒"));
await act({ knob: 1 }); // Explicitly select Confirm, not safe-default Cancel.
keys.set("knobPressed", "1");
frame();
now += 6000;
frame();
await nextTick();
assert.equal(keys.has("systemExecute"), false, "holding during countdown bypassed fresh press");
keys.set("knobPressed", "0");
frame();
keys.set("knobPressed", "1");
frame();
now += 1999;
frame();
assert.equal(keys.has("systemExecute"), false, "short hold executed reboot");
now += 1;
frame();
assert.equal(keys.get("systemExecute"), "reboot", "full rotary hold did not submit");
keys.set("systemStatus", "error:mock lifecycle error");
keys.set("knobPressed", "0");
frame();
await nextTick();
keys.set("back", "1");
frame();
keys.set("back", "0");
await nextTick();
assert.equal(keys.get("systemPrepare"), "", "failed action cannot be dismissed");

keys.delete("systemExecute");
await act({ knob: 1 });
await act({ click: true });
assert.equal(keys.get("systemPrepare"), "factory-reset");
assert.ok(texts(rootMirror as unknown as Mirror).includes("清除全部配置和数据，无法撤销。"));
now += 5000;
frame();
await contact(160, 130);
now += 1000;
frame([__packTouch(0, 160, 130)]);
await contact(160, 80); // Drag out cancels the dangerous hold.
now += 3000;
frame([__packTouch(0, 160, 80)]);
await contact();
assert.equal(keys.has("systemExecute"), false, "dragging out still executed factory reset");
await contact(90, 55);
await contact(150, 55);
await contact();
assert.equal(keys.get("systemPrepare"), "", "content Back did not dismiss recovery confirmation");
// Recovery remains local when Core-backed status is unavailable.
keys.set("system", "{}");
keys.delete("diagnosticsStart");
keys.delete("adbDebugSet");
assert.ok(pressRow("导出诊断")); frame(); await nextTick();
assert.equal(keys.has("diagnosticsStart"), false, "opening diagnostics collected logs");
await act({ click: true }); // Safe-default Cancel.
assert.equal(keys.has("diagnosticsStart"), false, "cancel collected logs");
assert.ok(pressRow("导出诊断")); frame(); await nextTick();
await act({ knob: 1 }); await act({ click: true });
assert.equal(keys.get("diagnosticsStart"), "1");
keys.set("diagnosticsStatus", '{"state":"running"}'); now += 501; frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("正在收集诊断日志…"));
keys.set("diagnosticsStatus", '{"state":"done"}'); now += 501; frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("导出完成"));
await act({ click: true });
assert.equal(keys.has("adbDebugSet"), false, "diagnostics completion enabled ADB");
assert.ok(pressRow("USB ADB 调试")); frame(); await nextTick();
assert.equal(keys.has("adbDebugSet"), false, "opening ADB enabled debugging");
await act({ click: true }); // Safe-default Cancel.
assert.equal(keys.has("adbDebugSet"), false);
assert.ok(pressRow("USB ADB 调试")); frame(); await nextTick();
await act({ knob: 1 }); await act({ click: true });
assert.equal(keys.get("adbDebugSet"), "1");
keys.set("adbDebugStatus", '{"state":"on"}'); frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("USB ADB 已开启"));
await act({ knob: -1 }); await act({ click: true });
assert.equal(keys.get("adbDebugSet"), "0");
keys.set("adbDebugStatus", '{"state":"off"}'); frame(); await nextTick();
await act({ click: true });
Date.now = realNow;

keys.set("settingsPage", "lock");
frame();
await nextTick();
await act({ click: true });
assert.ok(texts(rootMirror as unknown as Mirror).includes("设置新密码"));
const pinKeys = pinKeypad({ w: 320, h: 172 });
await contact(pinKeys[0].x + 20, pinKeys[0].y + 8);
await contact(pinKeys[1].x + 20, pinKeys[1].y + 8);
await contact();
assert.equal(texts(rootMirror as unknown as Mirror).includes("*"), false, "drag across PIN keys typed a digit");
async function pinTouch(value: string) {
  for (const token of [...value, "OK"]) {
    const cap = pinKeys.find((key) => key.token === token)!;
    await contact(cap.x + cap.w / 2, cap.y + cap.h / 2);
    await contact();
  }
}
await pinTouch("1234");
assert.ok(texts(rootMirror as unknown as Mirror).includes("再次输入密码"));
assert.equal(texts(rootMirror as unknown as Mirror).some((line) => line.includes("1234")), false, "PIN leaked into rendered text");
await pinTouch("1235");
assert.ok(texts(rootMirror as unknown as Mirror).includes("两次密码不一致"));
assert.equal(keys.has("appLockConfigure"), false, "mismatched confirmation saved a PIN");
await pinTouch("1234");
assert.equal(JSON.parse(keys.get("appLockConfigure")!).pin, "1234");
keys.set("appLockState", JSON.stringify({ enabled: true, timeout: 60, pending: "", result: "ok", busy: false, wait: 0 }));
frame();
await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("修改密码"));
keys.set("appLockState", JSON.stringify({ enabled: true, timeout: 60, pending: "launcher", result: "", busy: false, wait: 0 }));
frame();
await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("输入密码进入 App 列表"));
await pinTouch("4321");
assert.equal(keys.get("appUnlock"), "4321");
keys.set("appLockState", JSON.stringify({ enabled: true, timeout: 60, pending: "launcher", result: "error:pin", busy: false, wait: 30 }));
frame();
await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("请等待 30 秒，X 取消"));
keys.set("appLockState", JSON.stringify({ enabled: true, timeout: 60, pending: "launcher", result: "error:pin", busy: false, wait: 0 }));
frame();
await nextTick();
let pinFocus = 0;
for (const token of ["1", "2", "3", "4", "OK"]) {
  const index = pinKeys.findIndex((key) => key.token === token);
  await act({ knob: index - pinFocus });
  pinFocus = index;
  await act({ click: true });
}
assert.equal(keys.get("appUnlock"), "1234", "rotary PIN entry did not submit");
keys.set("appLockState", JSON.stringify({ enabled: true, timeout: 60, pending: "", result: "ok", busy: false, wait: 0 }));
frame(); await nextTick();
keys.set("appLockState", JSON.stringify({ enabled: true, timeout: 60, pending: "launcher", result: "", busy: false, wait: 0 }));
frame(); await nextTick();
keys.delete("appUnlock");
await pinTouch("1234");
assert.equal(keys.get("appUnlock"), "1234", "a cached PIN page remained busy at the next list entrance");

if (process.env.SETTINGS_SIM_TOUCH === "1") {
  keys.set("appLockState", JSON.stringify({ enabled: true, timeout: 60, pending: "", result: "ok", busy: false, wait: 0 }));
  keys.set("settingsPage", "screen");
  frame(); await nextTick();
  assert.ok(imageSources(rootMirror as unknown as Mirror).includes("screen-ui/back.png"));
  await contact(30, 10); await contact(30, 65); await contact();
  assert.ok(texts(rootMirror as unknown as Mirror).includes("亮度"), "dragging the shared header Back must cancel navigation");
  await contact(30, 10); await contact();
  assert.equal(texts(rootMirror as unknown as Mirror).includes("亮度"), false, "shared header Back must return from Settings subpages");
}

// App management uses the same touch rows and rotary actions as Settings.
keys.set("appLockState", JSON.stringify({ enabled: false, pending: "", result: "ok", busy: false, wait: 0 }));
keys.set("language", "zh");
keys.set("apps", JSON.stringify([
  { id: "settings", title: "设置" }, { id: "stream", title: "串流" }, { id: "power", title: "电源" },
]));
const homeWidgets = [{ id: "original", media_asset: "keep" }];
keys.set("layout", JSON.stringify({ face: "custom/original", home_widgets: homeWidgets, apps_hidden: ["power"] }));
keys.set("appsGen", "100");
keys.set("settingsPage", "display");
frame(); await nextTick(); frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("电源"), "hidden Apps must remain available for management");
await act({ knob: 1 });
assert.deepEqual(selectedTitles(), ["设置"]);
await act({ click: true });
assert.ok(texts(rootMirror as unknown as Mirror).includes("下移"), "App actions did not open");
assert.equal(texts(rootMirror as unknown as Mirror).includes("上移"), false, "first App can move above the list");

if (process.env.SETTINGS_SIM_TOUCH === "1") {
  const findAction = (node: Mirror, title: string): Mirror | undefined => {
    for (const child of node.children) { const found = findAction(child, title); if (found) return found; }
    const labels = texts(node);
    return node.onPress && labels.length === 1 && labels[0] === title ? node : undefined;
  };
  const hide = findAction(rootMirror as unknown as Mirror, "隐藏");
  assert.ok(hide?.onPress, "Hide has no touch handler");
  hide.onPress();
  frame(); await nextTick(); frame(); await nextTick();
} else await act({ click: true });
assert.deepEqual(JSON.parse(keys.get("layout")!).apps_hidden, ["power", "settings"]);
assert.deepEqual(selectedTitles(), ["设置"], "hiding an App lost its management row");
await act({ click: true });
await act({ click: true }); // Show is now the first action.
assert.deepEqual(JSON.parse(keys.get("layout")!).apps_hidden, ["power"]);
await act({ click: true });
await act({ knob: 1 }); // Move down, since the first App has no Move up.
await act({ click: true });
assert.deepEqual(JSON.parse(keys.get("layout")!).apps, ["stream", "settings", "power"]);
assert.deepEqual(selectedTitles(), ["设置"], "reordering lost the selected App");
assert.deepEqual(JSON.parse(keys.get("layout")!).home_widgets, homeWidgets);
assert.equal(JSON.parse(keys.get("layout")!).face, "custom/original");

if (process.env.SETTINGS_SIM_TOUCH === "1") {
  await act({ click: true });
  const offset = propSets.length;
  await contact(160, 145); await contact(160, 65); await contact();
  const scrolled = propSets.slice(offset).filter(([, prop, value]) => prop === 129 && value < 0).at(-1);
  assert.ok(scrolled, "touch cannot reveal the third App action");
  const position = translateY(scrolled[0]);
  frame(); await nextTick();
  assert.equal(translateY(scrolled[0]), position, "the rotary cursor snapped a touch-scrolled drawer back");
  keys.set("back", "1"); frame(); await nextTick(); keys.set("back", "0");
}

await act({ knob: 1 });
assert.deepEqual(selectedTitles(), ["电源"]);
await act({ click: true });
assert.equal(texts(rootMirror as unknown as Mirror).includes("下移"), false, "last App can move below the list");
await act({ knob: 1 });
await act({ click: true }); // Move the hidden App up.
assert.deepEqual(JSON.parse(keys.get("layout")!).apps, ["stream", "power", "settings"]);
await act({ knob: -999 });
await act({ click: true });
await act({ knob: -1 });
await act({ click: true });
assert.equal(keys.get("appView"), "icons", "App view did not switch to icons");
await act({ click: true });
await act({ knob: 1 });
await act({ click: true });
assert.equal(keys.get("appView"), "list", "App view did not switch back to list");
console.log("settings highlight, touch and App management input ok");
