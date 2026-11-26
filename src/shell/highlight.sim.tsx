import assert from "node:assert/strict";
import { nextTick } from "vue";
import { PAGE_SLIDE_MS } from "./motion";

const { mount } = await import("@pocketjs/framework/vue-vapor");
const { rootMirror } = await import("@pocketjs/framework/renderer");
const { default: Shell } = await import("./Shell.tsx");
const { __packTouch } = await import("../../../tmp/pocketjs/framework/src/touch.ts");

type Mirror = {
  id: number;
  text?: string;
  children: Mirror[];
  domAttrs?: { class?: unknown };
};

const apps = [
  { id: "settings", title: "Settings", icon: "settings.png", controls: ["rotary"] },
  { id: "stream", title: "Stream", icon: "stream.png", controls: ["rotary"] },
  { id: "stick", title: "Touchpad", icon: "stick.png", controls: ["rotary"] },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `extra-${index}`, title: `Extra ${index}`, icon: "power.png", controls: ["rotary"],
  })),
];

const staleWifiSetup = JSON.stringify({
  ssid: "shell-regression",
  password: "12345678",
  size: 21,
  runs: [],
});

const keys = new Map<string, string>([
  ["knobOn", "1"],
  ["knob", "0"],
  ["knobClick", "0"],
  ["knobHold", "0"],
  ["knobSeq", "0"],
  ["screenW", "320"],
  ["screenH", "172"],
  ["touchOn", process.env.SETTINGS_SIM_TOUCH === "1" ? "1" : "0"],
  ["appView", "list"],
  ["language", "en"],
  ["apps", JSON.stringify(apps)],
  ["controls", JSON.stringify(["rotary"])],
  ["layout", "{}"],
  ["system", JSON.stringify({ network: { ip: "192.0.2.5" }, system: { cpu_percent: 12 } })],
  ["launcher", "{}"],
  ["shellPage", "0"],
  // Finished devices may retain this host value. Only the separate init guest
  // may render it; the normal shell must ignore it completely.
  ["wifiSetup", staleWifiSetup],
]);
const animations: number[][] = [];
const propSets: number[][] = [];
const surfaceBindings: number[][] = [];

function testOps() {
  let nextId = 2;
  const noop = () => {};
  return {
    createNode: () => nextId++,
    destroyNode: noop,
    insertBefore: noop,
    removeChild: noop,
    setStyle: noop,
    setProp: (...args: number[]) => {
      propSets.push(args);
    },
    setText: noop,
    replaceText: noop,
    uploadTexture: () => 1,
    setImage: noop,
    setCompositorSurface: (...args: number[]) => { surfaceBindings.push(args); },
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
    __surfaces: Object.fromEntries(Array.from({ length: 32 }, (_, slot) => [`screen-display/home-widget-${slot}`, slot])),
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

function selectedTitles(): string[] {
  const out: string[] = [];
  const walk = (node: Mirror) => {
    if (isSelectedClass(classOf(node)) && classOf(node).includes("rounded-xl")) {
      const title = texts(node).find((line) => apps.some((app) => app.title === line));
      if (title) out.push(title);
    }
    for (const child of node.children) walk(child);
  };
  walk(rootMirror as unknown as Mirror);
  return out;
}

function appRow(node: Mirror, title: string): Mirror | undefined {
  if (classOf(node).includes("rounded-xl") && texts(node).includes(title)) return node;
  for (const child of node.children) {
    const found = appRow(child, title);
    if (found) return found;
  }
}

const ops = testOps();
(globalThis as { ui?: typeof ops }).ui = ops;
(globalThis as { onekvm?: { get: (key: string) => string; set: (key: string, value: string) => void } }).onekvm = {
  get(key) {
    return keys.get(key) ?? "";
  },
  set(key, value) {
    if (key === "shellPage" && value === "1" && keys.get("appListAuthorized") === "0") {
      keys.set("launch", "settings");
      return;
    }
    keys.set(key, value);
  },
};

mount(() => <Shell />, { ops });

function frame(touches: number[] = [], hits: number[] = []) {
  const tick = (globalThis as { frame?: (buttons: number, analog: number, touches: number[], hits: number[]) => void }).frame;
  if (!tick) throw new Error("shell did not install a frame tick");
  tick(0, 0, touches, hits);
}

async function contact(x?: number, y?: number, hit = 0, cancel = false) {
  frame(x === undefined ? [] : [(__packTouch(0, x, y!) | (cancel ? 0x40000000 : 0)) >>> 0], [hit]);
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
assert.equal(texts(rootMirror as unknown as Mirror).includes("Scan to connect"), false, "shell rendered init Wi-Fi setup");
assert.deepEqual(selectedTitles(), [], `idle highlight ${selectedTitles().join(",")}`);

function textNode(node: Mirror, text: string): Mirror | undefined {
  if (node.text === text) return node;
  for (const child of node.children) {
    const found = textNode(child, text);
    if (found) return found;
  }
}
const titleNode = textNode(rootMirror as unknown as Mirror, "IP ADDRESS");
const ipNode = textNode(rootMirror as unknown as Mirror, "192.0.2.5");
assert.ok(titleNode && ipNode, "overview failed to render");
const originalNow = Date.now;
try {
  const nextSample = Date.now() + 6000;
  Date.now = () => nextSample;
  keys.set("system", JSON.stringify({ network: { ip: "192.0.2.5" }, system: { cpu_percent: 34 } }));
  frame();
  await nextTick();
  assert.ok(textNode(rootMirror as unknown as Mirror, "34"), "live CPU text did not update");
  assert.equal(textNode(rootMirror as unknown as Mirror, "IP ADDRESS")?.id, titleNode.id, "CPU update recreated the static IP label");
  assert.equal(textNode(rootMirror as unknown as Mirror, "192.0.2.5")?.id, ipNode.id, "CPU update recreated the unchanged IP widget");
} finally { Date.now = originalNow; }

// An App consumed the new knob sequence and returned to the launcher.
// The parked Shell must honor that page even when it had no focused row.
keys.set("shellPage", "1");
await act({});
assert.equal(keys.get("shellPage"), "1", "consumed App input sent the launcher back home");
assert.deepEqual(selectedTitles(), []);
keys.set("shellPage", "0");
frame();
await nextTick();

const homeToAppsAnimations = animations.length;
const homeToAppsPropSets = propSets.length;
await act({ knob: 1 });
assert.deepEqual(selectedTitles(), ["Settings"], `first app ${selectedTitles().join(",")}`);
assert.ok(animations.length > homeToAppsAnimations, "home to apps did not animate");
const homeToAppsSlide = animations
  .slice(homeToAppsAnimations)
  .find((call) => call[2] === -320 && call[3] === PAGE_SLIDE_MS);
assert.ok(homeToAppsSlide, "home to apps used no page slide");
assert.equal(
  propSets.slice(homeToAppsPropSets).some((call) =>
    call[0] === homeToAppsSlide[0] && call[1] === homeToAppsSlide[1] && call[2] === -320
  ),
  false,
  "home to apps animation was cancelled by a direct position reset",
);

await act({ knob: 1 });
assert.deepEqual(selectedTitles(), ["Stream"], `second app ${selectedTitles().join(",")}`);
const second = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(second.length, 8, "launcher did not provide a complete list layer");
assert.equal(second[1], 0, "a highlight-only move scrolled the viewport");
assert.ok(second[4] > 1 && second[5] > 0, "missing native list mirror");

await act({ knob: 1 });
assert.deepEqual(selectedTitles(), ["Touchpad"]);
const third = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(third[0], 1, "forward scroll direction inverted");
assert.ok(third[6] > second[6], "forward target offset did not increase");

await act({ knob: -1 });
assert.deepEqual(selectedTitles(), ["Stream"]);

await act({ knob: -1 });
assert.deepEqual(selectedTitles(), ["Settings"], `back to first ${selectedTitles().join(",")}`);
assert.equal(keys.get("appScrollTransition")?.split(":")[0], "-1", "reverse scroll direction inverted");

const appsToHomeAnimations = animations.length;
const appsToHomePropSets = propSets.length;
await act({ knob: -1 });
assert.deepEqual(selectedTitles(), [], `return home ${selectedTitles().join(",")}`);
const appsToHomeSlide = animations
  .slice(appsToHomeAnimations)
  .find((call) => call[2] === 0 && call[3] === PAGE_SLIDE_MS);
assert.ok(appsToHomeSlide, "apps to home used no page slide");
assert.equal(
  propSets.slice(appsToHomePropSets).some((call) =>
    call[0] === appsToHomeSlide[0] && call[1] === appsToHomeSlide[1] && call[2] === 0
  ),
  false,
  "apps to home animation was cancelled by a direct position reset",
);

// A parked launcher must not consume vertical Home gestures.
const listNode = third[4];
const settingsRow = appRow(rootMirror as unknown as Mirror, "Settings")!;
const homeOffset = translateY(listNode);
keys.delete("appScrollTransition");
await contact(160, 140, settingsRow.id);
await contact(160, 90, settingsRow.id);
await contact();
assert.equal(translateY(listNode), homeOffset, "hidden app list consumed a Home gesture");
assert.equal(keys.has("appScrollTransition"), false);

keys.set("shellPage", "1");
frame();
await nextTick();
frame();
await nextTick();
const startOffset = -translateY(listNode);
await contact(160, 140, settingsRow.id);
await contact(163, 90, settingsRow.id);
assert.equal(translateY(listNode), -startOffset - 50, "app list did not follow the finger");
await contact();
const touchScroll = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(touchScroll[6], startOffset + 144, "app list did not settle from the displayed position");
assert.equal(keys.has("launch"), false, "list drag launched an app");

const longStart = translateY(listNode);
await contact(160, 168);
await contact(160, 8);
const longEnd = translateY(listNode);
assert.equal(longEnd, longStart - 160);
await contact();
assert.equal(translateY(listNode), longEnd, "long list drag snapped back to one page");

keys.set("appScrollPosition", `${listNode}:17`);
await contact(160, 140);
assert.equal(translateY(listNode), -17, "grabbing cached app list motion jumped to its old target");
keys.delete("appScrollPosition");
await contact(160, 100);
assert.equal(translateY(listNode), -57);
keys.delete("appScrollTransition");
await contact(160, 100, 0, true);
await contact();
assert.equal(translateY(listNode), -57, "cancelled list drag rewound the list");
assert.equal(keys.has("appScrollTransition"), false, "cancelled list drag started a new animation");

await contact(160, 10);
await contact(160, 170);
assert.ok(translateY(listNode) === 0, "app list overscrolled its top");
await contact();
await contact(160, 60, settingsRow.id);
await contact();
assert.equal(keys.get("launch"), "settings", "scrollable app list no longer opens a tapped app");
keys.delete("launch");
keys.set("appView", "icons");
keys.set("appsGen", "2");
frame(); await nextTick(); frame(); await nextTick();
assert.equal(appRow(rootMirror as unknown as Mirror, "Settings"), undefined, "list remained after switching to icons");
keys.set("appView", "list");
keys.set("appsGen", "3");
frame(); await nextTick(); frame(); await nextTick();
const updatedRow = appRow(rootMirror as unknown as Mirror, "Settings");
assert.ok(updatedRow, "switching back to list needed a shell restart");
await contact(160, 140, updatedRow.id);
await contact(162, 90, updatedRow.id);
await contact();
assert.equal(keys.has("launch"), false, "drag after changing view launched a row");

// Authentication belongs to the launcher entrance. A locked detent must not
// move the guest strip or reveal an App row before the native PIN page opens.
keys.set("shellPage", "0");
keys.set("appListAuthorized", "0");
frame(); await nextTick(); frame(); await nextTick();
const lockedAnimations = animations.length;
await act({ knob: 1 });
assert.equal(keys.get("launch"), "settings", "list entrance did not request PIN");
assert.equal(keys.get("shellPage"), "0", "locked entrance exposed the app list");
assert.equal(animations.slice(lockedAnimations).some(call => call[2] === -320), false, "locked entrance animated the app list");
keys.delete("launch");
if (keys.get("touchOn") === "0") {
  await contact(280, 80);
  await contact(120, 80);
  await contact();
  assert.equal(keys.get("shellPage"), "0", "locked touch swipe exposed the app list");
  assert.equal(keys.get("launch"), "settings", "touch entrance did not request PIN");
  keys.delete("launch");
}
// The host returns to the list after PIN, without relocking on Shell frames.
keys.set("appListAuthorized", "1");
keys.set("shellPage", "1");
frame(); await nextTick(); frame(); await nextTick();
await act({ knob: 1 });
await act({ click: true });
assert.equal(keys.get("launch"), "settings", "unlocked list did not open its selected App");
assert.equal(keys.get("shellPage"), "1", "unlocked list returned home unexpectedly");
keys.delete("launch");
keys.set("shellPage", "0");
keys.set("widgetMedia", "1");
keys.set("layout", JSON.stringify({
  face: "screen-display/dashboard", dashboard_layout: true, mode: "free",
  home_widgets: [
    { id: "hidden", widget: "screen-display/media", kind: "media", hidden: true },
    { id: "card", widget: "screen-display/rect", kind: "rect" },
    { id: "movie", widget: "screen-display/media", kind: "media" },
    { id: "hdmi-image", widget: "screen-display/status", kind: "status", status_inactive_image: "picture" },
  ],
}));
keys.set("appsGen", "4");
frame(); await nextTick(); frame(); await nextTick();
assert.ok(surfaceBindings.some(([, handle]) => handle === 2), "home media never entered the native painter sequence");
assert.ok(surfaceBindings.some(([, handle]) => handle === 3), "status image never entered the native painter sequence");
assert.equal(surfaceBindings.some(([, handle]) => handle === 0), false, "hidden media was bound to a native surface");

// Exercise the real guest node order on a live layout update, including moving
// the clock between two native surfaces. The source slots must remain 2 and 3.
function homePaintOrder(): string[] {
  const order: string[] = [];
  const walk = (node: Mirror) => {
    if (node.text === "LAYER CARD") order.push("card");
    else if (node.text === ":") order.push("clock");
    const surface = surfaceBindings.findLast(([id]) => id === node.id);
    if (surface) order.push(`surface-${surface[1]}`);
    node.children.forEach(walk);
  };
  walk(rootMirror as unknown as Mirror);
  return order;
}
const layered = JSON.parse(keys.get("layout")!);
layered.home_widgets[1].text = "LAYER CARD";
layered.layer_order = ["hidden", "movie", "clock", "hdmi-image", "card"];
keys.set("layout", JSON.stringify(layered));
keys.set("appsGen", "5");
frame(); await nextTick(); frame(); await nextTick();
assert.deepEqual(homePaintOrder(), ["surface-2", "clock", "surface-3", "card"], "saved layer depth was not applied to the guest painter order");
layered.layer_order = ["card", "hdmi-image", "movie", "hidden", "clock"];
keys.set("layout", JSON.stringify(layered));
keys.set("appsGen", "6");
frame(); await nextTick(); frame(); await nextTick();
assert.deepEqual(homePaintOrder(), ["card", "surface-3", "surface-2", "clock"], "live layer changes left stale guest nodes behind");
console.log("shell launcher lock, live view switching, touch scrolling and native media layer order ok");
