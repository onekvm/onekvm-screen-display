import assert from "node:assert/strict";
import { nextTick } from "vue";
import { DRAWER_EXIT_MS } from "../shell/motion";

const { mount } = await import("@pocketjs/framework/vue-vapor");
const { rootMirror } = await import("@pocketjs/framework/renderer");
const { layoutKeys, pickChips, revealBox } = await import("../shell/keypad.ts");
const { COLOR } = await import("../shell/ui.ts");
const { default: Init } = await import("./Init.tsx");
const screen = {
  w: Number(process.env.INIT_SIM_WIDTH || 240),
  h: Number(process.env.INIT_SIM_HEIGHT || 240),
};
const realNow = Date.now;
let now = 1000;
Date.now = () => now;

type Mirror = {
  id: number;
  onPress?: () => void;
  text?: string;
  children: Mirror[];
  domAttrs?: { class?: unknown; style?: unknown };
};

const keys = new Map<string, string>([
  ["knobOn", "0"],
  ["knob", "0"],
  ["knobClick", "0"],
  ["knobHoldN", "0"],
  ["knobSeq", "0"],
  ["screenW", String(screen.w)],
  ["screenH", String(screen.h)],
  ["language", "zh"],
  ["timezone", "Asia/Shanghai"],
  ["blankSeconds", "0"],
  ["ip", "192.168.10.20"],
  ["iface", "eth0"],
  ["wifi", "0"],
  ["nfs", "0"],
  ["links", JSON.stringify([{ kind: "eth", name: "eth0" }])],
  ["setupBusy", "0"],
  ["setupError", ""],
  ["adbDebugStatus", JSON.stringify({ state: "off" })],
  ["wifiScan", "[]"],
]);
const sets: { key: string; value: string }[] = [];
const animations: number[][] = [];
const networkReads: string[] = [];
const propSets: number[][] = [];

function testOps() {
  let nextId = 2;
  const noop = () => {};
  const ops = {
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
    __viewport: screen,
  };
  return ops;
}

function classOf(node: Mirror): string {
  return String(node.domAttrs?.class ?? "");
}

function insetT(node: Mirror): number {
  const style = node.domAttrs?.style;
  if (!style || typeof style !== "object") return 0;
  const value = (style as { insetT?: unknown }).insetT;
  return typeof value === "number" ? value : Number(value) || 0;
}

function isSelectedClass(value: string): boolean {
  return value.split(/\s+/).includes("bg-blue-500");
}

function subtreeSelected(node: Mirror): boolean {
  if (isSelectedClass(classOf(node))) return true;
  return node.children.some(subtreeSelected);
}

function texts(node: Mirror): string[] {
  const out: string[] = [];
  if (node.text) out.push(node.text);
  for (const child of node.children) out.push(...texts(child));
  return out;
}

function isPositionedRow(node: Mirror): boolean {
  if (!classOf(node).includes("absolute")) return false;
  if (!texts(node).some((line) => line.trim())) return false;
  return insetT(node) % 64 === 0;
}

function listSheet(node: Mirror): Mirror | null {
  const rows = node.children.filter(isPositionedRow).sort((a, b) => insetT(a) - insetT(b));
  if (rows.length >= 2 && insetT(rows[0]) === 0 && insetT(rows[1]) === 64) return node;
  for (const child of node.children) {
    const found = listSheet(child);
    if (found) return found;
  }
  return null;
}

function dump(node: Mirror, depth = 0): string[] {
  const cls = classOf(node);
  const line = `${"  ".repeat(depth)}${node.text ?? ""} ${cls} t=${insetT(node)}`.trim();
  return [line, ...node.children.flatMap((child) => dump(child, depth + 1))];
}

function listRows(): Mirror[] {
  const sheet = listSheet(rootMirror as unknown as Mirror);
  if (!sheet) throw new Error(`init list is not on screen\n${dump(rootMirror as unknown as Mirror).join("\n")}`);
  return sheet.children.filter(isPositionedRow).sort((a, b) => insetT(a) - insetT(b));
}

function selectedIndices(): number[] {
  return listRows().flatMap((row, index) => (subtreeSelected(row) ? [index] : []));
}

function paintLine(where: string, got: number[]): string {
  const rows = listRows();
  const labels = rows.map((row) => texts(row).join("/") || "(empty)");
  return `${where}: painted ${got.join(",") || "none"} of ${rows.length} [${labels.join(" | ")}]`;
}

function assertSelected(index: number, where: string) {
  const rows = listRows();
  const got = rows.flatMap((row, i) => (subtreeSelected(row) ? [i] : []));
  console.log(paintLine(where, got));
  if (got.length !== 1 || got[0] !== index) {
    const classes = (node: Mirror): string[] => [classOf(node), ...node.children.flatMap(classes)].filter(Boolean);
    console.log(rows.map((row, i) => `${i} ${texts(row).join("/")} ${classes(row).join(" | ")}`).join("\n"));
  }
  assert.deepEqual(got, [index], `${where}: selected ${got.join(",") || "none"}`);
}

function assertNoneSelected(where: string) {
  const got = selectedIndices();
  console.log(paintLine(where, got));
  assert.deepEqual(got, [], `${where}: selected ${got.join(",")}`);
}

const ops = testOps();
(globalThis as { ui?: typeof ops }).ui = ops;
(globalThis as { onekvm?: { get: (key: string) => string; set: (key: string, value: string) => void } }).onekvm = {
  get(key) {
    if (["ip", "links", "wifiSsid", "wifiIp", "iface", "wifi"].includes(key)) networkReads.push(key);
    return keys.get(key) ?? "";
  },
  set(key, value) {
    keys.set(key, value);
    sets.push({ key, value });
  },
};

mount(() => <Init />, { ops });

function frame(touches: number[] = [], hits?: number[]) {
  const tick = (globalThis as { frame?: (buttons: number, analog: number, touches: number[], hits?: number[]) => void }).frame;
  if (!tick) throw new Error("init did not install a frame tick");
  tick(0, 0, touches, hits);
}

const { __packTouch } = await import("../../../tmp/pocketjs/framework/src/touch.ts");
async function contact(x?: number, y?: number, hit?: number) {
  const touches = x === undefined ? [] : [__packTouch(0, x, y!)];
  for (let i = 0; i < 2; i++) {
    frame(touches, hit === undefined ? undefined : [hit]);
    await nextTick();
  }
}

async function rightBack(edge = false) {
  // A natural content swipe need not start within the bezel strip.
  await contact(edge ? 8 : 80, edge ? 70 : 26);
  await contact(edge ? 68 : 140, edge ? 72 : 28);
  await contact();
}

function listOffset(): number {
  const node = listSheet(rootMirror as unknown as Mirror)!;
  return -(propSets.findLast(([id, prop]) => id === node.id && prop === 129)?.[2] ?? 0);
}

function pressTarget(node: Mirror): Mirror | undefined {
  return node.onPress ? node : node.children.map(pressTarget).find(Boolean);
}

let seq = 0;
async function act(input: { knob?: number; click?: boolean; hold?: number }, touches: number[] = []) {
  seq += 1;
  keys.set("knob", String(input.knob ?? 0));
  keys.set("knobClick", input.click ? "1" : "0");
  keys.set("knobHoldN", String(input.hold ?? 0));
  keys.set("knobSeq", String(seq));
  frame(touches);
  await nextTick();
  frame(touches);
  await nextTick();
}

function rowLabel(index: number): string {
  return texts(listRows()[index] ?? { id: 0, children: [] }).join(" ");
}

// Local startup faults appear before account entry and never export logs.
// Before the language step they are in English, although the device still
// stores "zh" from an earlier setup.
const startupReasons = {
  "storage-unmounted": "Data partition is not mounted.", "storage-read-only": "Data partition is read-only.",
  "storage-full": "Data partition is full.", "storage-io": "Storage read/write failed.",
  "storage-permission": "Configuration is not writable.", "storage-write": "Cannot write configuration.",
  "boot-slot": "Boot slot information is invalid.", "system-files": "System files are missing or unreadable.",
  "config-invalid": "Configuration file is invalid.", "persistence-failed": "Persistent storage setup failed.",
  "core-failed": "Core service failed to start.", "core-unreachable": "Cannot reach the local Core service.",
};
const allText = () => texts(rootMirror as unknown as Mirror).join("\n");
async function startupFrame(state: string, code: string) {
  keys.set("startupHealth", JSON.stringify({ state, code }));
  frame(); await nextTick(); frame(); await nextTick();
}
function startupButton(label: string, node = rootMirror as unknown as Mirror): Mirror | undefined {
  if (node.onPress && texts(node).join("") === label) return node;
  return node.children.map((child) => startupButton(label, child)).find(Boolean);
}
// Ordered firstboot work can take longer than a single health check. Waiting
// keeps a spinner, rechecks automatically and closes when the host is ready.
const startupSetOffset = sets.length;
for (const code of ["persistence-starting", "core-starting"]) {
  await startupFrame("starting", code);
  assert.ok(allText().includes("Starting device"));
  assert.ok(allText().includes("Please wait."));
  assert.ok(!startupButton("Check again") && !startupButton("Back"));
  keys.set("setupError", "startup:" + code);
  const checks = sets.filter(({ key }) => key === "startupCheck").length;
  now += 2100; frame(); await nextTick(); frame(); await nextTick();
  assert.equal(sets.filter(({ key }) => key === "startupCheck").length, checks + 1);
  now += 15000; frame(); await nextTick(); frame(); await nextTick();
  assert.ok(!allText().includes("Startup check did not finish in time."));
  await startupFrame("ready", "");
  assert.ok(!allText().includes("Please wait."));
  keys.set("setupError", "");
}
sets.splice(startupSetOffset);
for (const [code, reason] of Object.entries(startupReasons)) {
  await startupFrame("error", code);
  assert.ok(allText().includes(reason), `${code} reason is hidden`);
  startupButton("Back")!.onPress!(); await nextTick();
  await startupFrame("error", code);
  assert.ok(!allText().includes("Device is not ready"), "dismissed fault reopened without a change");
  await startupFrame("ready", "");
}
await startupFrame("error", "storage-read-only");
startupButton("Check again")!.onPress!(); await nextTick();
assert.equal(sets.filter(({ key }) => key === "startupCheck").length, 1);
// A fast native check can finish between frames and return the same fault.
await startupFrame("error", "storage-read-only");
assert.ok(allText().includes("Data partition is read-only."));
startupButton("Check again")!.onPress!(); await nextTick();
await startupFrame("checking", "");
assert.ok(allText().includes("Checking startup status"));
now += 11000; frame(); await nextTick(); frame(); await nextTick();
assert.ok(allText().includes("Startup check did not finish in time."));
await startupFrame("ready", "");
assert.ok(!allText().includes("Device is not ready"));
assert.equal(sets.filter(({ key }) => key === "diagnosticsStart" || key === "authSetup").length, 0);
now = 1000;
frame();
await Promise.resolve();
const diagnosticsRequests = () => sets.filter(({ key }) => key === "diagnosticsStart").length;
assert.equal(diagnosticsRequests(), 0, "initialization automatically collected diagnostics");

// The hidden entry uses the real logo hit target and the shared feedback modal.
const logo = (function find(node: Mirror): Mirror | undefined {
  return (node as Mirror & { src?: string }).src === "logo.png" ? node : node.children.map(find).find(Boolean);
})(rootMirror as unknown as Mirror);
// Image source lives on renderer attributes in some simulator versions.
const logoTarget = logo ?? (function find(node: Mirror): Mirror | undefined {
  return node.onPress && !texts(node).length ? node : node.children.map(find).find(Boolean);
})(rootMirror as unknown as Mirror);
assert.ok(logoTarget?.onPress, "welcome logo is not an input target");
for (let i = 0; i < 4; i++) { logoTarget.onPress(); await nextTick(); }
assert.ok(!texts(rootMirror as unknown as Mirror).includes("Export diagnostics"));
assert.equal(diagnosticsRequests(), 0, "logo taps started collection before confirmation");
logoTarget.onPress();
await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("Export diagnostics"));
assert.equal(diagnosticsRequests(), 0, "opening the dialog started collection");
function pressText(label: string) {
  const find = (node: Mirror): Mirror | undefined => node.onPress && texts(node).length === 1 && texts(node)[0] === label
    ? node : node.children.map(find).find(Boolean);
  const target = find(rootMirror as unknown as Mirror);
  assert.ok(target?.onPress, `missing action ${label}`);
  target.onPress();
}
pressText("Cancel");
await nextTick();
assert.ok(!texts(rootMirror as unknown as Mirror).includes("Export diagnostics"));
assert.equal(diagnosticsRequests(), 0, "canceling the dialog started collection");
frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("USB ADB debugging"), "ADB confirmation must follow diagnostics");
assert.equal(sets.filter(({ key }) => key === "adbDebugSet").length, 0, "opening ADB confirmation enabled debugging");
pressText("Cancel"); await nextTick();
assert.ok(!texts(rootMirror as unknown as Mirror).includes("USB ADB debugging"));
for (let i = 0; i < 5; i++) { logoTarget.onPress(); await nextTick(); }
assert.ok(texts(rootMirror as unknown as Mirror).includes("Export diagnostics"));
assert.equal(diagnosticsRequests(), 0);
pressText("Export");
await nextTick();
assert.equal(diagnosticsRequests(), 1, "Export must send exactly one explicit request");
keys.set("diagnosticsStatus", JSON.stringify({ state: "done", error: "" }));
now += 600;
frame();
await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("Export complete"));
pressText("OK");
await nextTick();
assert.ok(!texts(rootMirror as unknown as Mirror).includes("Export complete"));
frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("USB ADB debugging"));
pressText("Enable"); await nextTick();
assert.deepEqual(sets.filter(({ key }) => key === "adbDebugSet").map(({ value }) => value), ["1"]);
keys.set("adbDebugStatus", JSON.stringify({ state: "busy" }));
frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("Enabling USB ADB…"));
keys.set("adbDebugStatus", JSON.stringify({ state: "on" }));
frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("USB ADB is enabled"));
pressText("Disable ADB"); await nextTick();
assert.deepEqual(sets.filter(({ key }) => key === "adbDebugSet").map(({ value }) => value), ["1", "0"]);
keys.set("adbDebugStatus", JSON.stringify({ state: "off" }));
frame(); await nextTick();
assert.ok(texts(rootMirror as unknown as Mirror).includes("USB ADB is disabled"));
pressText("OK"); await nextTick();

await act({ click: true });
assertNoneSelected("knob off");
assert.equal(keys.get("appPageTransition"), "1", "welcome did not request a cached page slide");
assert.equal(keys.get("hot"), "0", "static init list kept the guest hot");
keys.set("knobOn", "1");

const languageCount = listRows().length;
const listAnimations = animations.length;
await act({ knob: 1 });
assertSelected(1, "language second");
const second = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(second.length, 8, "init did not provide a complete list layer");
assert.equal(second[1], 0, "a highlight-only change moved the viewport");
assert.ok(second[4] > 1 && second[5] > 0, "missing init list node/parent");
assert.ok(second[7] > second[3], "init only cached the visible viewport");
assert.equal(selectedIndices().includes(0), false);
await act({ knob: languageCount - 2 });
assertSelected(languageCount - 1, "language last");
const last = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(last[0], 1);
assert.ok(last[6] > second[6], "multi-detent reveal did not advance");
// Touch grabs the last visible frame, not the encoder's settled target.
const visibleOffset = Math.min(24, last[6] - 1);
keys.set("appScrollPosition", `${last[4]}:${visibleOffset}`);
const beforeTouchRequests = sets.filter((item) => item.key === "appScrollTransition").length;
frame([__packTouch(0, 100, 90)]);
assert.equal(listOffset(), visibleOffset, "first touch frame jumped to the rotary target");
await nextTick();
await contact(100, 90);
assert.equal(listOffset(), visibleOffset, "touch-down jumped to the rotary target");
keys.delete("appScrollPosition");
await contact(100, 60);
assert.equal(listOffset(), Math.min(visibleOffset + 30, languageCount * 64 - last[3]), "touch drag was not direct");
await contact();
assert.equal(sets.filter((item) => item.key === "appScrollTransition").length, beforeTouchRequests,
  "touch drag incorrectly requested a rotary animation");
assertSelected(languageCount - 1, "touch preserves rotary selection");
await act({ knob: 1 - languageCount });
assertSelected(0, "language first again");
const first = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(first[0], -1);
assert.equal(first[6], 0, "reverse reveal did not return to the first row");
await act({ knob: -100 });
assertSelected(0, "language lower boundary");
assert.equal(animations.length, listAnimations, "init rotary motion still ran a guest tween");
await rightBack();
assert.equal(keys.get("appPageTransition"), "-1", "right swipe did not return to welcome");
assert.equal(listSheet(rootMirror as unknown as Mirror), null);
await act({ click: true });
assertSelected(0, "rotary resumes after touch back");
// The home gesture is intentionally inert until initialization completes.
await contact(Math.round(screen.w / 2), screen.h - 6);
await contact(Math.round(screen.w / 2), screen.h - 58);
await contact();
assert.equal(keys.get("launch"), undefined, "init home gesture escaped the setup flow");
assertSelected(0, "init bottom swipe stays on the page");
await act({ knob: 1 });
await act({ knob: -1 });
assert.equal(listOffset(), 0, "returning to language retained an old list offset");
await act({ knob: 1 });
assert.equal(rowLabel(1).includes("English"), true, rowLabel(1));
const englishTarget = pressTarget(listRows()[1])!;
await contact(80, 100, englishTarget.id);
await contact(undefined, undefined, englishTarget.id);
assert.equal(keys.get("language"), "en");
console.log(`applied language ${keys.get("language")}`);
assert.equal(keys.get("timezone"), "Asia/Shanghai");
assert.equal(sets.some((item) => item.key === "timezone"), false);

assertSelected(0, "blank start");
await act({ knob: 2 });
assertSelected(2, "blank third");
await act({ click: true });
assert.equal(keys.get("blankSeconds"), "60");
console.log(`applied blank ${keys.get("blankSeconds")}`);

assertSelected(0, "network start");
const networkLabels = listRows().map((row) => texts(row).join(""));
assert.equal(
  networkLabels.some((line) => /Never|30s|1 min|5 min|Custom|永不|30秒|1分钟|5分钟|自定义/.test(line)),
  false,
  networkLabels.join(" | "),
);
assert.equal(networkLabels.some((line) => line.includes("eth0")), true, networkLabels.join(" | "));
console.log(`network rows ${networkLabels.join(" | ")}`);
networkReads.length = 0;
await act({ knob: 1 });
assertSelected(1, "network second");
await act({ knob: -1 });
assert.deepEqual(networkReads, [], "rapid network input repeated synchronous status queries");
now += 1001;
frame();
await nextTick();
assert.ok(networkReads.includes("ip") && networkReads.includes("links"), "network status stopped refreshing");
await act({ click: true });
assert.equal(keys.get("appPageTransition"), "1", "network subpage did not request a forward slide");

// Init shares OptionDrawer with Settings, including its cached open/close
// requests and rotary cursor. Apply a choice by elapsed time, not JS ticks.
await act({ click: true });
assert.ok(keys.get("appDrawerTransition")?.startsWith("1:"), "init drawer did not open through the compositor");
await act({ knob: 1 });
const { drawerRow } = await import("../shell/ListRow");
assert.equal(drawerRow.value, 1, "init drawer cursor did not follow the encoder");
await rightBack();
assert.equal(drawerRow.value, -1, "right swipe did not dismiss the drawer");
assert.ok(rowLabel(0).includes("DHCP"), "drawer dismissal committed an unpicked choice");
await act({ click: true });
await act({ knob: 1 });
await act({ click: true });
assert.ok(keys.get("appDrawerTransition")?.startsWith("0:"), "init drawer did not request cached close");
for (let i = 0; i < 20; i++) {
  frame();
  await nextTick();
}
assert.ok(rowLabel(0).includes("DHCP"), "drawer choice depended on guest tick count");
now += DRAWER_EXIT_MS + 1;
frame();
await nextTick();
frame();
await nextTick();
assert.ok(rowLabel(0).includes("Static"), "drawer choice was not committed after close");
await act({ click: true });
await act({ knob: -1 });
await act({ click: true });
now += DRAWER_EXIT_MS + 1;
frame();
await nextTick();
frame();
await nextTick();
assert.ok(rowLabel(0).includes("DHCP"));
const nested = listRows().length;
await act({ knob: 1 });
assertSelected(1, "nested second");
await act({ knob: nested - 2 });
assertSelected(nested - 1, "nested last");
await act({ click: true });
assertSelected(0, "back on network");
assert.equal(keys.get("appPageTransition"), "-1", "network subpage back did not reverse the slide");

await act({ knob: 1 });
await act({ click: true });
assertSelected(0, "password start");
await act({ knob: 1 });
assertSelected(1, "password second");
await act({ knob: -1 });
assertSelected(0, "password first again");

async function typeSecret(word: string, clear = 0) {
  const caps = layoutKeys("text", 0, screen).caps;
  let pos = 0;
  if (clear > 0) await act({ hold: clear });
  for (const ch of word) {
    const at = caps.findIndex((cap) => cap.token === ch);
    assert.ok(at >= 0, `key ${ch}`);
    if (at !== pos) await act({ knob: at - pos });
    pos = at;
    await act({ click: true });
  }
  const ok = caps.findIndex((cap) => cap.token === "OK");
  assert.ok(ok >= 0, "OK");
  if (ok !== pos) await act({ knob: ok - pos });
  await act({ click: true });
}

function selectedKey(): number {
  const caps = layoutKeys("text", 0, screen).caps;
  const walk = (node: Mirror): number => {
    const style = node.domAttrs?.style as Record<string, number> | undefined;
    if (style?.bgColor === COLOR.primary) {
      const at = caps.findIndex((cap) => cap.x === style.insetL && cap.ly === style.insetT && cap.w === style.width && cap.h === style.height);
      if (at >= 0) return at;
    }
    for (const child of node.children) {
      const at = walk(child);
      if (at >= 0) return at;
    }
    return -1;
  };
  return walk(rootMirror as unknown as Mirror);
}

// Touch shows only the pressed key. Release hides it; the next encoder
// input reveals a cursor anchored at the last touched key.
await act({ click: true });
const usernameKeys = layoutKeys("text", 0, screen).caps;
const rotaryKey = usernameKeys.findIndex((cap) => cap.token === "g");
await act({ knob: rotaryKey });
assert.equal(selectedKey(), rotaryKey);
const touched = usernameKeys[0];
await contact(Math.round(touched.x + touched.w / 2), Math.round(touched.y + touched.h / 2));
assert.equal(selectedKey(), 0, "touch-down did not select the touched key");
await act({ knob: 2 }, [__packTouch(0, Math.round(touched.x + touched.w / 2), Math.round(touched.y + touched.h / 2))]);
assert.equal(selectedKey(), 0, "rotary input displaced the pressed touch key");
await contact();
assert.equal(selectedKey(), -1, "touch release left a rotary cursor visible");
for (let i = 0; i < 3; i++) {
  frame();
  await nextTick();
}
assert.equal(selectedKey(), -1, "idle frames restored a rotary cursor after touch");
await act({ knob: 1 });
assert.equal(selectedKey(), 1, "encoder did not continue from the touched key");
await act({ click: true });
const username = `admina${usernameKeys[1].token}`;
assert.ok(texts(rootMirror as unknown as Mirror).includes(username), "encoder typed a key from its old position");
// Holding a group selects the chip under the finger, starting with the one
// under the press point, so a right-column group reaches every letter.
function selectedChip(node = rootMirror as unknown as Mirror): number {
  const style = node.domAttrs?.style as Record<string, number> | undefined;
  if (style?.width === 36 && style.height === 36 && style.radius === 8 && style.bgColor === COLOR.primary) return style.insetL;
  for (const child of node.children) {
    const x = selectedChip(child);
    if (x >= 0) return x;
  }
  return -1;
}
let holdAnchor = 0;
async function holdGroup(token: string, edge: "left" | "middle" | "right", typed: string) {
  const index = usernameKeys.findIndex((cap) => cap.token === token);
  const cap = usernameKeys[index];
  const chips = pickChips(cap, layoutKeys("text", 0, screen), screen);
  const x = edge === "left" ? cap.x : edge === "middle" ? cap.x + Math.floor(cap.w / 2) : cap.x + cap.w - 1;
  const y = cap.y + Math.floor(cap.h / 2);
  for (let i = 0; i < 40; i++) { frame([__packTouch(0, x, y)]); await nextTick(); }
  // The chip under the press point, or the nearest one.
  const gap = (chip: { x: number; size: number }) => Math.max(chip.x - x, x - (chip.x + chip.size - 1), 0);
  const under = chips.reduce((best, chip, n) => (gap(chip) < gap(chips[best]) ? n : best), 0);
  assert.equal(selectedChip(), chips[under].x, `${token} ${edge} press did not select the chip under the finger`);
  const target = chips[cap.chars.indexOf(typed)];
  for (let i = 0; i < 3; i++) { frame([__packTouch(0, target.x + 18, y)]); await nextTick(); }
  assert.equal(selectedChip(), target.x, `${token} chip ${typed} not selected`);
  await contact();
  holdAnchor = index;
}
await holdGroup(".", "middle", "@");
await holdGroup("p", "right", "p");
await holdGroup("p", "left", "s");
assert.ok(texts(rootMirror as unknown as Mirror).includes(`${username}@ps`), "held groups typed the wrong letters");
await act({ hold: 3 });
assert.ok(texts(rootMirror as unknown as Mirror).includes(username));
await act({ knob: 1 - holdAnchor });
await act({ knob: usernameKeys.findIndex((cap) => cap.token === "OK") - 1 });
await act({ click: true });
assert.ok(rowLabel(0).includes(username), "account form did not keep the edited username");
await act({ knob: 1 });

await act({ click: true });
await rightBack(true);
assertSelected(1, "right swipe closes password keyboard without leaving the page");
await act({ click: true });
const passwordBoard = layoutKeys("text", 0, screen);
const eye = revealBox(passwordBoard, screen);
await contact(Math.round(eye.x + eye.w / 2), Math.round(eye.y + eye.h / 2));
await contact();
assert.equal(selectedKey(), -1, "password visibility left a stale key highlighted");
await act({ knob: -1 });
assert.equal(selectedKey(), passwordBoard.caps.length - 1, "encoder did not resume from password visibility");
await act({ knob: -passwordBoard.caps.length });
await typeSecret("aaaaaaaa");
await act({ knob: 1 });
await act({ click: true });
await typeSecret("dddddddd");
const mismatchSubmitted = sets.some((item) => item.key === "authSetup");
assert.equal(mismatchSubmitted, false, "mismatch must not submit");
const shown = texts(rootMirror as unknown as Mirror);
const mismatchText = shown.find((line) => line.includes("don't match")) ?? "";
assert.notEqual(mismatchText, "", shown.join("\n"));
console.log(`mismatch authSetup ${mismatchSubmitted} error ${JSON.stringify(mismatchText)}`);

await act({ click: true });
await act({ click: true });
await typeSecret("aaaaaaaa", 8);
await act({ knob: 1 });
const before = sets.filter((item) => item.key === "authSetup").length;
await act({ click: true });
const auth = sets.filter((item) => item.key === "authSetup");
assert.equal(auth.length, before + 1);
const body = JSON.parse(auth[auth.length - 1]?.value ?? "{}") as {
  username?: string;
  password?: string;
  language?: string;
  timezone?: string;
};
assert.equal(body.username, username);
assert.equal(body.password, "aaaaaaaa");
assert.equal(body.language, "en");
assert.equal(body.timezone, "UTC");
console.log(`auth ${JSON.stringify(body)}`);
// A slow retry on the account page keeps its spinner/timer alive, then idles.
now += 1000;
await startupFrame("error", "core-unreachable");
startupButton("Check again")!.onPress!(); await nextTick();
await startupFrame("checking", "");
assert.equal(sets.filter(({ key }) => key === "hot").at(-1)?.value, "1");
now += 11000; frame(); await nextTick(); frame(); await nextTick();
assert.ok(allText().includes("Startup check did not finish in time"));
assert.equal(sets.filter(({ key }) => key === "hot").at(-1)?.value, "0");
await startupFrame("ready", "");
console.log("init sim ok");
Date.now = realNow;
