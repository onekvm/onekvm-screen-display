import assert from "node:assert/strict";
import { nextTick } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { rootMirror } from "@pocketjs/framework/renderer";
import Power from "../apps/extension-screen/src/Power";
import ExtensionApp from "../apps/extension-screen/src/App";
import { CONFIG } from "../apps/extension-screen/src/config";
import TailscaleApp from "../../onekvm-extension-tailscale/screen-app/src/App";
import { CONFIG as tailscale } from "../../onekvm-extension-tailscale/screen-app/src/config";
import NetbirdApp from "../../onekvm-extension-netbird/screen-app/src/App";
import { CONFIG as netbird } from "../../onekvm-extension-netbird/screen-app/src/config";
import ZerotierApp from "../../onekvm-extension-zerotier/screen-app/src/App";
import { CONFIG as zerotier } from "../../onekvm-extension-zerotier/screen-app/src/config";
import EasytierApp from "../../onekvm-extension-easytier/screen-app/src/App";
import { CONFIG as easytier } from "../../onekvm-extension-easytier/screen-app/src/config";
import WakeApp from "../../onekvm-extension-wake-on-lan/screen-app/src/App";
import { CONFIG as wake } from "../../onekvm-extension-wake-on-lan/screen-app/src/config";
import Stream from "../apps/stream/src/Stream";
import Stick from "../apps/stick/src/Stick";
import { HomePill } from "../src/chrome/HomePill";
import { COLOR } from "../packages/screen-ui/src/theme";
import { __packTouch } from "../../tmp/pocketjs/framework/src/touch";
import { PROP } from "../../tmp/pocketjs/contracts/spec/spec";

type Node = { id: number; text?: string; children: Node[]; onPress?(): void; domAttrs?: { class?: string; src?: string } };
const scene = process.argv[2];
const language = process.argv[3] || "zh";
const labels = {
  en: { on: "On", off: "Off", reset: "Reset", back: "Back", noSignal: "No signal", zoom: "Turn to zoom 1×", resetHint: "Press to reset", left: "Left", right: "Right", speed: "Speed", disconnected: "Disconnected", failed: "Failed. Try again." },
  zh: { on: "开机", off: "关机", reset: "重启", back: "返回", noSignal: "无信号", zoom: "旋转缩放 1×", resetHint: "按下复位", left: "左键", right: "右键", speed: "速度", disconnected: "未连接", failed: "操作失败，请重试" },
  zh_tw: { on: "開機", off: "關機", reset: "重啟", back: "返回", noSignal: "無訊號", zoom: "旋轉縮放 1×", resetHint: "按下重設", left: "左鍵", right: "右鍵", speed: "速度", disconnected: "未連線", failed: "操作失敗，請重試" },
}[language as "en" | "zh" | "zh_tw"];
const isPower = scene.startsWith("power");
const rotary = scene === "power-rotary";
const width = Number(process.env.SCREEN_SIM_WIDTH || 320);
const keys = new Map<string, string>([
  ["screenW", String(width)], ["screenH", width === 320 ? "172" : "240"], ["knobSeq", "0"], ["language", language],
  ["system", JSON.stringify({ power: { available: true, pwr_led: true } })],
  ["homePill", "1"],
  ["controls", JSON.stringify(scene === "stream" ? ["rotary"] : rotary ? ["touch", "rotary"] : ["touch"])],
  ["hid", "0"],
]);
const isContributed = ["tailscale", "netbird", "zerotier", "easytier", "wake-on-lan"].includes(scene);
if (isContributed) {
  keys.set("knobSeq", "9");
  keys.set("knobClick", "1");
}
const requests: string[] = [];
const powerCommands: string[] = [];
const qrPayloads: string[] = [];
let statusPending = false;
let statusFixture: Record<string, unknown> = {};
let syntheticResponse = "";
let hostSequence = 0;
(globalThis as any).onekvm = {
  get: (key: string) => keys.get(key) || "",
  set: (key: string, value: string) => {
    keys.set(key, value);
    if (key === "powerAction") powerCommands.push(value);
    if (key === "qrCode") {
      qrPayloads.push(value);
      keys.set("qrCode", value ? JSON.stringify({ size: 29, runs: [[0, 0, 7], [0, 1, 1], [6, 1, 1]] }) : "");
    }
    if (key === "appRequest") {
      requests.push(value);
      if (JSON.parse(value).method === "status") statusPending = true;
    }
  },
};
let id = 2;
const noop = () => {};
const props: number[][] = [];
const backgrounds = new Map<number, number>();
const ops = {
  createNode: () => id++, destroyNode: noop, insertBefore: noop, removeChild: noop,
  setStyle: noop, setProp: (...args: number[]) => {
    props.push(args);
    if (args[1] === PROP.bgColor) backgrounds.set(args[0], args[2] >>> 0);
  },
  setText: noop, replaceText: noop, setImage: noop, setSprite: noop,
  uploadTexture: () => 1, setFocus: noop, setActive: noop, measureText: () => 8,
  __textures: {},
};
(globalThis as any).ui = ops;
Date.now = () => 1000;
const contributedApps = {
  tailscale: { App: TailscaleApp, config: tailscale },
  netbird: { App: NetbirdApp, config: netbird },
  zerotier: { App: ZerotierApp, config: zerotier },
  easytier: { App: EasytierApp, config: easytier },
  "wake-on-lan": { App: WakeApp, config: wake },
};
const contributed = contributedApps[scene as keyof typeof contributedApps];
const Guest = contributed?.App || ExtensionApp;
mount(() => isPower ? <Power /> : scene === "plugin" || contributed ? <Guest /> : scene === "stream" ? <Stream /> : scene === "stick" ? <Stick /> : <HomePill />, { ops });
async function frame(touches: number[] = []) {
  const response = keys.get("appResponse") || "";
  if (response && response !== syntheticResponse) {
    const payload = JSON.parse(response).response;
    if (payload && typeof payload === "object") statusFixture = payload;
  }
  if (statusPending) {
    statusPending = false;
    syntheticResponse = JSON.stringify({ id: ++hostSequence, busy: false, ok: true, response: statusFixture });
    keys.set("appResponse", syntheticResponse);
  }
  (globalThis as any).frame(0, 0, touches, [0]);
  await nextTick();
}
function texts(node: Node): string[] {
  return [...(node.text ? [node.text] : []), ...node.children.flatMap(texts)];
}
function imageSources(node: Node): string[] {
  return [...(node.domAttrs?.src ? [node.domAttrs.src] : []), ...node.children.flatMap(imageSources)];
}
function buttonWithText(label: string, node: Node = rootMirror as unknown as Node): Node | undefined {
  if (node.onPress && texts(node).includes(label)) return node;
  return node.children.map(child => buttonWithText(label, child)).find(Boolean);
}
function backButton(node: Node = rootMirror as unknown as Node): Node | undefined {
  if (node.children.some(child => child.domAttrs?.src === "screen-ui/back.png")) return node;
  return node.children.map(child => backButton(child)).find(Boolean);
}
function selected(node: Node = rootMirror as unknown as Node): string[] {
  if (backgrounds.get(node.id) === COLOR.primary) return imageSources(node).includes("screen-ui/back.png") ? [labels.back] : texts(node);
  return node.children.flatMap(child => selected(child));
}
async function tapBack(drag = false) {
  await frame([__packTouch(0, 30, 20)]);
  if (drag) await frame([__packTouch(0, 100, 20)]);
  await frame();
}
let seq = Number(keys.get("knobSeq"));
async function input(step: number, click = false, hold = false) {
  keys.set("knobSeq", String(++seq));
  keys.set("knob", String(step));
  keys.set("knobClick", click ? "1" : "0");
  keys.set("knobHold", hold ? "1" : "0");
  await frame();
  await frame();
}
await frame();
await frame();
if (scene === "stream" || scene === "stick") {
  const expected = scene === "stream" ? [labels.noSignal, labels.zoom, labels.resetHint] : [labels.left, labels.right, labels.speed, labels.disconnected];
  const rendered = texts(rootMirror as unknown as Node);
  for (const label of expected) assert.ok(rendered.includes(label), `missing ${language} label: ${label}`);
} else if (contributed) {
  assert.equal(requests.filter(raw => JSON.parse(raw).method !== "status").length, 0, "opening an App must not replay an old confirm event");
  if (scene === "wake-on-lan") {
    buttonWithText({ en: "Wake", zh: "唤醒", zh_tw: "喚醒" }[language as "en" | "zh" | "zh_tw"])!.onPress!();
    await frame();
    assert.equal(requests.filter(raw => JSON.parse(raw).method !== "status").length, 0, "an unconfigured wake must be rejected by the extension's business rule");
  }
  keys.set("appResponse", JSON.stringify({ ok: true, response: { online: true, loggedIn: true, backendState: "Running", ready: true, configured: true, daemonStatus: "Connected", networks: [{}, {}] } }));
  await frame();
  const expected = {
    en: ["Connected", "Connected", "2 networks", "Ready", "Ready to wake"],
    zh: ["已连接", "已连接", "2 个网络", "已就绪", "可唤醒"],
    zh_tw: ["已連線", "已連線", "2 個網路", "已就緒", "可喚醒"],
  }[language as "en" | "zh" | "zh_tw"][["tailscale", "netbird", "zerotier", "easytier", "wake-on-lan"].indexOf(scene)];
  assert.ok(texts(rootMirror as unknown as Node).includes(expected), `missing ${scene} ${language} state: ${expected}`);
  const buttons = {
    en: { wake: "Wake", connect: "Connect", disconnect: "Disconnect" },
    zh: { wake: "唤醒", connect: "连接", disconnect: "断开" },
    zh_tw: { wake: "喚醒", connect: "連線", disconnect: "中斷" },
  }[language as "en" | "zh" | "zh_tw"];
  for (const action of contributed.config.actions) {
    const label = buttons[action.method as keyof typeof buttons];
    assert.ok(texts(rootMirror as unknown as Node).includes(label), `missing ${scene} ${language} action: ${label}`);
  }
  assert.ok(backButton(), "every service screen must have a visible Back button");
  if (contributed.config.actions.length) {
    await input(1);
    const index = contributed.config.actions.length;
    const backSelected = index === contributed.config.actions.length;
    assert.deepEqual(selected(), [backSelected ? labels.back : buttons[contributed.config.actions[index].method as keyof typeof buttons]], "rotary selection must include visible Back");
    const beforeConfirm = requests.length;
    await input(0, true);
    if (backSelected) {
      assert.equal(keys.get("launch"), "launcher");
      assert.equal(requests.length, beforeConfirm, "Back must not dispatch a service action");
    } else {
      const request = JSON.parse(keys.get("appRequest")!);
      assert.equal(request.extension, scene);
      assert.equal(request.method, contributed.config.actions[index].method);
    }
    const count = requests.length;
    await frame();
    await input(0, true);
    assert.equal(requests.length, count, "a held event or busy action must not send duplicate requests");
  }
  keys.set("appResponse", JSON.stringify({ busy: true }));
  await frame();
  const busyLabel = { en: "Working…", zh: "处理中", zh_tw: "處理中" }[language as "en" | "zh" | "zh_tw"];
  assert.ok(texts(rootMirror as unknown as Node).includes(busyLabel), "busy state must update through StatusCard props");
  keys.set("appResponse", JSON.stringify({ ok: false, error: "backend diagnostics must not appear as untranslated UI" }));
  await frame();
  assert.ok(texts(rootMirror as unknown as Node).includes(labels.failed), "RPC failures must use a localized message");
  if (contributed.config.actions.length) {
    await input(-3);
    const count = contributed.config.actions.length + 1;
    const index = ((contributed.config.actions.length - 3) % count + count) % count;
    assert.deepEqual(selected(), [scene === "netbird" || scene === "tailscale" ? buttons.disconnect : index === contributed.config.actions.length ? labels.back : buttons[contributed.config.actions[index].method as keyof typeof buttons]], "negative batched detents must skip disabled actions and include Back");
    if (scene === "netbird" || scene === "tailscale") {
      keys.set("appResponse", JSON.stringify({ ok: true, response: { online: true, authState: "idle", daemonStatus: "Disconnected", backendState: "NeedsLogin", loggedIn: false } }));
      await frame(); await frame();
    }
    function button(node: Node): Node | undefined {
      if (node.onPress && texts(node).includes(buttons[contributed.config.actions[0].method as keyof typeof buttons])) return node;
      return node.children.map(button).find(Boolean);
    }
    const touchButton = button(rootMirror as unknown as Node);
    assert.ok(touchButton, "the shared action must accept touch input");
    touchButton.onPress!();
    await frame();
    assert.equal(JSON.parse(requests.at(-1)!).method, contributed.config.actions[0].method, "touch must dispatch the same declared action");
  } else {
    await input(-3, true);
    assert.equal(requests.filter(raw => JSON.parse(raw).method !== "status").length, 0, "an App with no actions must safely ignore turn and click");
  }
  const beforeHold = requests.length;
  await input(0, true, true);
  assert.equal(keys.get("launch"), "shell", "hold must exit while a request is busy");
  assert.equal(requests.length, beforeHold, "hold plus click must never trigger an action");
  keys.set("appResponse", JSON.stringify({ ok: false, error: "touch action failed" }));
  await frame();
  const beforeBack = requests.length;
  keys.delete("launch");
  await tapBack(true);
  assert.equal(keys.has("launch"), false, "dragging away from Back must cancel the tap");
  await tapBack();
  assert.equal(keys.get("launch"), "launcher", "touch Back must work while a request is busy");
  assert.equal(requests.length, beforeBack, "touch Back must preserve the service and authorization");
  if (scene === "netbird" || scene === "tailscale") {
    await frame();
    function connectButton(node: Node): Node | undefined {
      if (node.onPress && texts(node).includes(buttons.connect)) return node;
      return node.children.map(connectButton).find(Boolean);
    }
    connectButton(rootMirror as unknown as Node)!.onPress!();
    keys.set("appResponse", JSON.stringify({ id: 99, ok: true, response: { started: true } }));
    await frame(); await frame();
    const link = "https://login.example/activate?user_code=ABCD-EFGH&next=%2Fdevice";
    keys.set("appResponse", JSON.stringify({ id: 100, ok: true, response: { online: true, authState: "pending", authURL: link } }));
    await frame(); await frame();
    assert.equal(qrPayloads.at(-1), link, "QR must encode the complete current device link");
    const scan = { en: "Scan to sign in", zh: "扫码绑定", zh_tw: "掃碼綁定" }[language as "en" | "zh" | "zh_tw"];
    assert.ok(texts(rootMirror as unknown as Node).includes(scan), "pending authorization must show the QR view");
    assert.ok(imageSources(rootMirror as unknown as Node).includes("src/logo.png"), "the App header must use its brand image");
    const hint = { en: "Scan within 5 min", zh: "5 分钟内扫码，过期重连", zh_tw: "5 分鐘內掃碼，過期重連" }[language as "en" | "zh" | "zh_tw"];
    assert.ok(texts(rootMirror as unknown as Node).includes(hint), "pending authorization must explain that the link expires");
    const cancel = { en: "Cancel", zh: "取消", zh_tw: "取消" }[language as "en" | "zh" | "zh_tw"];
    assert.ok(buttonWithText(cancel), "an unfinished authorization must say Cancel");
    assert.equal(texts(rootMirror as unknown as Node).includes(buttons.disconnect), false, "Disconnect is reserved for an established connection");
    const beforeDuplicate = requests.length;
    for (let n = 0; n < 3; n++) buttonWithText(buttons.connect)!.onPress!();
    await frame();
    assert.equal(requests.length, beforeDuplicate, "pending authorization must disable repeated Connect presses");
    const beforePendingBack = requests.length;
    keys.delete("launch");
    await tapBack();
    assert.equal(keys.get("launch"), "launcher", "the pending QR page must have touch Back");
    assert.equal(requests.length, beforePendingBack, "leaving the QR page must not cancel or restart authorization");
    keys.delete("launch");
    keys.set("back", "1"); await frame(); keys.delete("back");
    assert.equal(keys.get("launch"), "launcher", "swipe Back must return to the App list");
    const before = requests.length, encoded = qrPayloads.length;
    for (let n = 0; n < 100; n++) await frame();
    assert.equal(requests.length, before, "waiting for browser approval must not poll status");
    assert.equal(qrPayloads.length, encoded, "idle frames must not re-encode the QR");
    keys.set("appResponse", JSON.stringify({ id: 101, ok: true, response: { online: true, authState: "expired", authURL: link } }));
    await frame(); await frame();
    const expired = { en: "QR expired. Retry.", zh: "二维码已过期，请重试", zh_tw: "QR 碼已過期，請重試" }[language as "en" | "zh" | "zh_tw"];
    assert.ok(texts(rootMirror as unknown as Node).includes(expired), "expired authorization must replace the QR with retry instructions");
    assert.equal(texts(rootMirror as unknown as Node).includes(scan), false);
    keys.set("appResponse", JSON.stringify({ id: 102, ok: true, response: { online: true, loggedIn: true, backendState: "Running", daemonStatus: "Connected", authState: "pending", authURL: link } }));
    await frame(); await frame();
    assert.ok(texts(rootMirror as unknown as Node).includes({ en: "Connected", zh: "已连接", zh_tw: "已連線" }[language as "en" | "zh" | "zh_tw"]));
    assert.equal(texts(rootMirror as unknown as Node).includes(scan), false, "authorization completion must retire the QR");
    keys.set("appResponse", JSON.stringify({ id: 103, ok: false, error: "touch action failed" }));
    await frame();
  }
} else if (scene === "pill") {
  props.length = 0;
  keys.set("homePill", "0");
  (globalThis as any).frame(0);
  assert.ok(props.some(call => call[2] === 0), "idle expiry must hide the pill in the same host frame");
  props.length = 0;
  keys.set("homePill", "1");
  (globalThis as any).frame(0);
  assert.ok(props.some(call => call[2] === 1), "confirmation must reveal the pill in the same host frame");
} else {
  if (isPower) {
    assert.ok(backButton(), "Power must have the shared Back arrow even without a rotary control");
    assert.ok(imageSources(rootMirror as unknown as Node).includes("power.png"), "Power header must use a packaged image");
    assert.equal(texts(rootMirror as unknown as Node).some(text => text.includes("⚡")), false, "Power header must not depend on a lightning glyph");
  }
  assert.deepEqual(selected(), [], "entry must not preselect a power operation");
  await input(1);
  assert.deepEqual(selected(), [labels.back], "the first rotary detent must select Back like HDMI loopback");
  await input(1);
  assert.deepEqual(selected(), [labels.on]);
  await input(1);
  assert.deepEqual(selected(), [labels.off], "rotary selection must repaint");
  await input(-1);
  assert.deepEqual(selected(), [labels.on]);
  await input(-1);
  assert.deepEqual(selected(), [labels.back], "Back must be reachable when wrapping backwards");
  await input(-1);
  assert.deepEqual(selected(), [labels.reset], "negative detent must wrap");
  await input(2);
  assert.deepEqual(selected(), [labels.on], "batched detents must include Back in the cycle");
  await input(1);
  assert.deepEqual(selected(), [labels.off], "batched detents must keep their magnitude");
  await input(0, true);
  if (isPower) assert.equal(keys.get("powerAction"), "off");
  else assert.equal(JSON.parse(keys.get("appRequest")!).method, "off");
  if (isPower) {
    const count = powerCommands.length;
    for (const label of [labels.on, labels.off, labels.reset]) buttonWithText(label)!.onPress!();
    await input(0, true);
    assert.equal(powerCommands.length, count, "busy power controls must reject duplicate touch and rotary commands");
    await input(1);
    assert.deepEqual(selected(), [labels.back], "busy rotary navigation must skip disabled power actions");
  } else {
    await input(2);
  }
  assert.deepEqual(selected(), [labels.back]);
  const beforeBack = requests.length;
  await input(0, true);
  assert.equal(keys.get("launch"), "launcher", "Back must return to the App list even while a power request is busy");
  assert.equal(requests.length, beforeBack, "Back must not send a service command");
  if (isPower) {
    assert.deepEqual(powerCommands, ["off"], "Back must not send a power command");
    keys.delete("launch");
    await tapBack(true);
    assert.equal(keys.has("launch"), false, "dragging the Power Back arrow must cancel its tap");
    await tapBack();
    assert.equal(keys.get("launch"), "launcher", "Power must support touch Back while busy");
    keys.set("back", "1"); keys.delete("launch"); await frame(); keys.delete("back");
    assert.equal(keys.get("launch"), "launcher", "Power swipe Back must return to the App list");
    await input(0, true, true);
    assert.equal(keys.get("launch"), "shell", "Power hold must return home without a command");
    keys.set("appResponse", JSON.stringify({ busy: false, ok: false })); await frame();
    assert.ok(texts(rootMirror as unknown as Node).includes(labels.failed));
    assert.equal(texts(rootMirror as unknown as Node).some(text => text.startsWith({ en: "Power LED", zh: "电源灯", zh_tw: "電源燈" }[language as "en" | "zh" | "zh_tw"])), false, "an error must replace low-priority LED details on the compact card");
    keys.set("system", JSON.stringify({ power: { available: false, pwr_led: true } })); await frame();
    for (const label of [labels.on, labels.off, labels.reset]) buttonWithText(label)!.onPress!();
    assert.deepEqual(powerCommands, ["off"], "unavailable power control must disable all power commands");
    keys.set("appResponse", JSON.stringify({ busy: false, ok: true })); await frame();
  }
}
if (scene !== "pill") {
  keys.set("language", language === "en" ? "zh-TW" : "en-US");
  await frame();
  await frame();
  const expected = language === "en"
    ? isPower || scene === "plugin" ? "電源控制" : scene === "stream" ? "無訊號" : scene === "stick" ? "左鍵" : "操作失敗，請重試"
    : isPower || scene === "plugin" ? "Power control" : scene === "stream" ? "No signal" : scene === "stick" ? "Left" : "Failed. Try again.";
  const rendered = texts(rootMirror as unknown as Node);
  assert.ok(rendered.some(text => text.includes(expected)), `running ${scene} must follow a language change: ${expected}`);
  if (isPower) assert.ok(rendered.includes(language === "en" ? "電源燈 亮" : "Power LED On"), "LED text must follow the language too");
}
console.log(`${scene} ${language} ${width}px controls and language switching ok`);
