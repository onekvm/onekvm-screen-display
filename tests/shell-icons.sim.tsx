import assert from "node:assert/strict";
import { nextTick } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { rootMirror } from "@pocketjs/framework/renderer";
import Shell from "../src/shell/Shell";
import { knobRow } from "../src/shell/ListRow";
import { __packTouch } from "../../tmp/pocketjs/framework/src/touch";

const apps = Array.from({ length: 14 }, (_, i) => ({ id: `app-${i}`, title: `App ${i}`, icon: "settings.png", controls: ["rotary", "touch"] }));
const keys = new Map(Object.entries({ screenW: "320", screenH: "172", appView: "icons", apps: JSON.stringify(apps), appsGen: "1", controls: '["rotary","touch"]', knobOn: "1", touchOn: "1", shellPage: "0", shellCapturePage: "-1", knobSeq: "0", language: "en", layout: "{}" }));
const sets: number[][] = [], tweens: number[][] = [];
let id = 2, seq = 0, layoutReads = 0;
const noop = () => {};
const ops = { createNode: () => id++, destroyNode: noop, insertBefore: noop, removeChild: noop, setStyle: noop, setText: noop, replaceText: noop, setImage: noop, setSprite: noop, uploadTexture: () => 1, freeTexture: noop, setFocus: noop, setActive: noop, measureText: () => 8, __textures: {},
  setProp: (...args: number[]) => { sets.push(args); }, animate: (...args: number[]) => { tweens.push(args); return tweens.length; }, cancelAnim: noop };
(globalThis as any).ui = ops;
(globalThis as any).onekvm = { get: (key: string) => { if (key === "layout") layoutReads++; return keys.get(key) || ""; }, set: (key: string, value: string) => {
  if (key === "shellPage" && value === "1" && keys.get("appListAuthorized") === "0") { keys.set("launch", "settings"); return; }
  keys.set(key, value);
} };
async function frame(touches: number[] = []) { (globalThis as any).frame(0, 0, touches); await nextTick(); }
async function settle() { await frame(); await frame(); }
async function turn(step: number, click = false, hold = false) {
  keys.set("knobSeq", String(++seq)); keys.set("knob", String(step)); keys.set("knobClick", click ? "1" : "0"); keys.set("knobHold", hold ? "1" : "0");
  await settle();
}
function position() { return sets.findLast(call => call[1] === 128)?.[2] || 0; }
mount(() => <Shell />, { ops }); await settle();
await turn(7); assert.equal(knobRow.value, 6); assert.equal(position(), -640, "rotary did not show icon page 2");
assert.equal(keys.get("appPageTransition"), "1", "rotary did not request a cached slide");
assert.equal(tweens.length, 0, "rotary left an expensive guest page tween running");
await turn(6); assert.equal(knobRow.value, 12); assert.equal(position(), -960);
await turn(-7); assert.equal(knobRow.value, 5); assert.equal(position(), -320); assert.equal(keys.get("appPageTransition"), "-1");
await turn(2); assert.equal(knobRow.value, 7); assert.equal(position(), -640);
// Native cache refresh paints home and apps without performing navigation.
keys.set("appsGen", "2"); keys.set("shellCapturePage", "0"); await settle();
assert.equal(position(), 0, "cache capture did not render home"); assert.equal(knobRow.value, 7);
keys.set("shellCapturePage", "1"); await settle();
assert.equal(position(), -640, "cache capture forgot the current icon subpage"); assert.equal(knobRow.value, 7);
keys.set("shellCapturePage", "-1"); await settle();
assert.equal(position(), -640); assert.equal(keys.get("shellPage"), "1");
await turn(1); assert.equal(knobRow.value, 8); assert.equal(position(), -640);
// Reordering keeps the same App selected, and shortening cannot leave a blank page.
keys.set("apps", JSON.stringify([apps[13], ...apps.slice(0, 13)])); keys.set("appsGen", "3"); await settle();
assert.equal(knobRow.value, 9); assert.equal(position(), -640);
await turn(1, true); assert.equal(keys.get("launch"), "app-9", "turn + click opened the previous selection");
keys.delete("launch"); await settle();
keys.set("apps", JSON.stringify(apps.slice(0, 3))); keys.set("appsGen", "4"); await settle();
assert.equal(knobRow.value, 2); assert.equal(position(), -320, "catalog shrink left an empty icon page");
await turn(0, false, true); assert.equal(knobRow.value, -1); assert.equal(position(), 0);
keys.set("appListAuthorized", "0"); await turn(1, true);
assert.equal(keys.get("launch"), "settings"); assert.equal(keys.get("shellPage"), "0", "locked rotary revealed icons");
keys.delete("launch"); keys.set("appListAuthorized", "1"); await settle();
keys.set("apps", JSON.stringify(apps)); keys.set("appsGen", "5"); await settle();
// Touch swipes retain direct guest motion; the next detent starts on that page.
await frame([__packTouch(0, 280, 80)]); await frame([__packTouch(0, 80, 80)]); await frame(); await settle();
assert.equal(keys.get("shellPage"), "1"); assert.ok(tweens.length > 0, "touch paging stopped animating");
await turn(1); assert.equal(position(), -320);
await frame([__packTouch(0, 280, 80)]); await frame([__packTouch(0, 80, 80)]); await frame(); await settle();
assert.equal(keys.get("hot"), "1");
keys.set("appsGen", "6"); keys.set("shellCapturePage", "0"); await settle();
keys.set("shellCapturePage", "1"); await settle();
keys.set("shellCapturePage", "-1"); await settle();
assert.equal(position(), -640);
assert.equal(keys.get("hot"), "0", "cache refresh stranded a cancelled touch tween in the hot loop");
keys.set("hot", "1"); await settle();
assert.equal(keys.get("hot"), "0", "a native status wake left the idle launcher hot");
for (let n = 0; n < 25; n++) await frame();
assert.equal(keys.get("hot"), "0", "settled icons left the hot loop running");
const originalNow = Date.now;
let simulatedNow = 12345;
Date.now = () => simulatedNow;
try {
  keys.set("shellPage", "0");
  keys.set("layout", JSON.stringify({ face: "screen-display/minimal", clock_enabled: true, home_widgets: [] }));
  keys.set("homeGen", "minute");
  await settle();
  assert.equal(keys.get("shellFrameAfter"), "47655");
  const reads = layoutReads;
  for (let count = 0; count < 3; count++) { simulatedNow += 1000; await frame(); }
  assert.equal(layoutReads, reads, "unchanged home settings were polled on an invisible second");
  const delay = keys.get("shellFrameAfter");
  keys.set("shellCapturePage", "1"); await settle();
  assert.equal(keys.get("shellFrameAfter"), delay, "cache capture cancelled the home deadline");
  keys.set("shellCapturePage", "-1");
  keys.set("layout", JSON.stringify({ face: "screen-display/classic", clock_enabled: true, home_widgets: [] }));
  keys.set("homeGen", "ticks");
  await settle();
  assert.equal(keys.get("shellFrameAfter"), "655");
  keys.set("layout", JSON.stringify({ face: "screen-display/classic", clock_enabled: false, home_widgets: [] }));
  keys.set("homeGen", "hidden");
  await settle();
  assert.equal(keys.get("shellFrameAfter"), "0");
  keys.set("shellPage", "1"); await settle();
  assert.equal(keys.get("shellFrameAfter"), "0", "launcher requested an invisible clock frame");
} finally { Date.now = originalNow; }
function inspect(node: any) { assert.ok(!String(node.domAttrs?.class || "").includes("duration-160"), "icon highlight can freeze midway"); node.children.forEach(inspect); }
inspect(rootMirror);
console.log("Shell icons: multi-page rotary, burst/reversal, cache refresh, reorder/shrink, turn+click, lock, touch and idle passed");
