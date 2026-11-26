import assert from "node:assert/strict";
import { nextTick } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { rootMirror } from "@pocketjs/framework/renderer";
import { PROP } from "../../tmp/pocketjs/contracts/spec/spec";
import Stream from "../apps/stream/src/Stream";

const [width, height] = (process.env.SCREEN_SIM_SIZE || "320x172").split("x").map(Number);
const keys = new Map(Object.entries({
  screenW: String(width), screenH: String(height), controls: '["touch","rotary"]',
  knobSeq: "0", stream: "1", zoom: "1", panX: "500", panY: "500",
}));
(globalThis as any).onekvm = {
  get: (key: string) => keys.get(key) || "",
  set: (key: string, value: string) => keys.set(key, value),
};
let now = 1000;
Date.now = () => now;
let id = 2;
const values = new Map<string, number>();
const noop = () => {};
const ops = {
  createNode: () => id++, destroyNode: noop, insertBefore: noop, removeChild: noop,
  setStyle: noop, setProp: (node: number, prop: number, value: number) => values.set(`${node}:${prop}`, value),
  setText: noop, replaceText: noop, setImage: noop, setSprite: noop,
  uploadTexture: () => 1, setFocus: noop, setActive: noop, measureText: () => 8, __textures: {},
};
(globalThis as any).ui = ops;
type Node = { id: number; parent: Node; children: Node[]; domAttrs?: { src?: string } };
function findGlass(node = rootMirror as unknown as Node): Node | undefined {
  if (node.domAttrs?.src === "zoom.png") return node.parent;
  return node.children.map(child => findGlass(child)).find(Boolean);
}
const unmount = mount(() => <Stream />, { ops });
async function frame(time = now, point?: [number, number], cancel = false) {
  now = time;
  const packed = point ? [((point[1] << 9) | point[0]) >>> 0] : cancel ? [0x40000000] : [];
  (globalThis as any).frame(0, 0, packed);
  await nextTick();
}
await frame();
const glass = findGlass()!;
assert.ok(glass, "the touch Stream must render a magnifier");
const value = (prop: number) => values.get(`${glass.id}:${prop}`);
const visible = () => value(PROP.opacity);
const center = (): [number, number] => [Math.round(value(PROP.insetL)! + 28), Math.round(value(PROP.insetT)! + 28)];
assert.deepEqual(center(), [width / 2, height / 2], "button position must represent the existing crop center");
await frame(5999);
assert.equal(visible(), 1);
await frame(6000);
assert.equal(visible(), 0, "hide at five seconds, without another input or reactive frame");
assert.notEqual(keys.get("hot"), "1", "the countdown must not keep the host hot");
await frame(6001, center());
assert.equal(visible(), 1);
await frame(12001, center());
assert.equal(visible(), 1, "a held contact must remain visible");
await frame(12002);
assert.equal(keys.get("zoom"), "1", "a reveal touch over the old button must not change zoom");
await frame(17001);
assert.equal(visible(), 1, "start the idle period on release");
await frame(17002);
assert.equal(visible(), 0);
// A rotary event also reveals it; the first touch after that is a normal tap.
keys.set("knobSeq", "1");
await frame(17003);
assert.equal(visible(), 1);
await frame(17004, center());
await frame(17005);
assert.equal(keys.get("zoom"), "2", "a visible button tap must still cycle zoom");

async function drag(x: number, y: number) {
  await frame(now + 1, center());
  await frame(now + 100, [x, y]);
  await frame(now + 6000, [x, y]);
  assert.equal(visible(), 1, "a paused drag must not disappear");
  await frame(now + 1);
  assert.equal(keys.get("hot"), "0");
}
for (const zoom of ["2", "4"]) {
  keys.set("zoom", zoom);
  for (const [x, y, panX, panY] of [
    [36, 36, "0", "0"], [width - 36, 36, "1000", "0"],
    [width - 36, height - 36, "1000", "1000"], [36, height - 36, "0", "1000"],
  ] as const) {
    await drag(x, y);
    assert.deepEqual([keys.get("panX"), keys.get("panY")], [panX, panY], `${zoom}× must reach the full crop at every corner`);
    assert.deepEqual(center(), [x, y]);
  }
}
// Cancellation must release hot state and start a fresh idle interval.
await frame(now + 1, center());
await frame(now + 1, [60, height - 36]);
await frame(now + 1, undefined, true);
assert.equal(keys.get("hot"), "0");
await frame(now + 5000);
assert.equal(visible(), 0);
unmount();
mount(() => <Stream />, { ops });
await frame();
const reopened = findGlass()!;
assert.equal(values.get(`${reopened.id}:${PROP.insetL}`), 8 + Number(keys.get("panX")) * (width - 72) / 1000);
assert.equal(values.get(`${reopened.id}:${PROP.insetT}`), 8 + Number(keys.get("panY")) * (height - 72) / 1000);
console.log(`Stream magnifier ${width}×${height}: idle, reveal, hold, cancel, zoom and four corners passed`);
