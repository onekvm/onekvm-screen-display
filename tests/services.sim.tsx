import assert from "node:assert/strict";
import { nextTick } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { rootMirror } from "@pocketjs/framework/renderer";
import Services from "../apps/services/src/Services";
import { canAct, parseServices } from "../apps/services/src/model";
import { __packTouch } from "../../tmp/pocketjs/framework/src/touch";
import { knobRow } from "../src/shell/ListRow";

const [w, h] = (process.env.SCREEN_SIM_SIZE || "320x172").split("x").map(Number);
const language = process.env.SCREEN_SIM_LANG || "zh";
const labels = {
  en: { core: "OneKVM server", running: "Running", stopped: "Stopped", start: "Start", stop: "Stop", restart: "Restart", failed: "Timed out", missing: "Service unavailable" },
  zh: { core: "OneKVM 服务", running: "运行中", stopped: "已停止", start: "启动", stop: "停止", restart: "重启", failed: "操作超时，请刷新", missing: "服务不可用" },
  zh_tw: { core: "OneKVM 服務", running: "執行中", stopped: "已停止", start: "啟動", stop: "停止", restart: "重新啟動", failed: "操作逾時，請重試", missing: "服務無法使用" },
}[language as "en" | "zh" | "zh_tw"];
const keys = new Map(Object.entries({ screenW: String(w), screenH: String(h), controls: '["touch","rotary"]', knobSeq: "0", language, servicesGeneration: "1" }));
const requests: any[] = [];
const propSets: number[][] = [];
const scrollTransitions: string[] = [];
(globalThis as any).onekvm = {
  get: (key: string) => keys.get(key) || "",
  set: (key: string, value: string) => {
    keys.set(key, value);
    if (key === "appRequest") requests.push(JSON.parse(value));
    if (key === "appScrollTransition") scrollTransitions.push(value);
  },
};
let id = 2;
const noop = () => {};
const ops = { createNode: () => id++, destroyNode: noop, insertBefore: noop, removeChild: noop,
  setStyle: noop, setProp: (...args: number[]) => { propSets.push(args); }, setText: noop, replaceText: noop, setImage: noop, setSprite: noop,
  uploadTexture: () => 1, setFocus: noop, setActive: noop, measureText: () => 8, __textures: {} };
(globalThis as any).ui = ops;
type Node = { text?: string; children: Node[]; onPress?(): void; domAttrs?: { src?: string } };
const root = rootMirror as unknown as Node;
function texts(node = root): string[] { return [...(node.text ? [node.text] : []), ...node.children.flatMap(texts)]; }
function button(text: string, node = root): Node | undefined {
  if (node.onPress && texts(node).includes(text) && (!["‹", "›"].includes(text) || texts(node).length === 1)) return node;
  return node.children.map(child => button(text, child)).find(Boolean);
}
async function frame(touches: number[] = []) { (globalThis as any).frame(0, 0, touches); await nextTick(); }
async function tapBack() { await frame([__packTouch(0, 30, 20)]); await frame(); await frame(); }
async function tap(text: string) { assert.ok(button(text), `missing button ${text}`); button(text)!.onPress!(); await frame(); await frame(); }
let seq = 0;
async function rotary(step: number, click = false, hold = false) {
  keys.set("knobSeq", String(++seq)); keys.set("knob", String(step)); keys.set("knobClick", click ? "1" : "0"); keys.set("knobHold", hold ? "1" : "0");
  await frame(); await frame();
}
async function reply(response: unknown, ok = true, error = "", requestId = requests.at(-1).requestId) {
  keys.set("appResponse", JSON.stringify({ requestId, ok, response, error })); await frame(); await frame();
}
const catalog = [
  { id: "system.onekvm", name: "OneKVM", running: true, enabled: true, actions: [] },
  { id: "extension.demo", name: "Demo", running: false, enabled: false, actions: ["start", "stop", "restart"] },
  ...Array.from({ length: 5 }, (_, i) => ({ id: `extension.extra${i}`, name: `Extra ${i}`, running: true, enabled: true, actions: ["start", "stop", "restart"] })),
];
assert.equal(parseServices([...catalog, catalog[0], null, { id: "bad", name: "中文", actions: ["shell"] }]).length, 8);
assert.deepEqual(parseServices([{ id: "bad", name: "中文", actions: ["shell"] }])[0].actions, []);
assert.equal(canAct(parseServices(catalog)[0], "stop"), false);
mount(() => <Services />, { ops }); await frame(); await frame();
assert.equal(requests.length, 1); assert.equal(requests[0].method, "list");
await reply(catalog, true, "", "foreign-response");
assert.equal(requests.length, 1); assert.equal(texts().includes(labels.core), false);
await reply(catalog);
assert.ok(texts().includes(labels.core));
assert.ok(texts().includes("Extra 4"), "the complete catalog must be in one scroll strip");
assert.equal(button("›"), undefined, "services still has a next-page button");
assert.equal(button("‹"), undefined, "services still has a previous-page button");
assert.ok(!/\d+\/\d+/.test(texts().join(" ")), "services still shows page numbers");
await frame([__packTouch(0, Math.floor(w / 2), h - 20)]);
await frame([__packTouch(0, Math.floor(w / 2), h - 80)]);
assert.ok(propSets.some(([, prop, value]) => prop === 129 && value === -60), "service list did not follow the finger");
await frame(); await frame();
const glide = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(glide.length, 8); assert.equal(glide[2], 40); assert.equal(glide[3], h - 40);
assert.ok(glide[7] > h, "cached list omitted offscreen services");
keys.set("appScrollPosition", `${glide[4]}:17`);
await frame([__packTouch(0, Math.floor(w / 2), h - 20)]); await frame(); keys.delete("appScrollPosition");
assert.ok(propSets.some(([node, prop, value]) => node === glide[4] && prop === 129 && value === -17), "touch ignored the visible native scroll position");
await rotary(1); await rotary(-1);
assert.equal(knobRow.value, 0);
assert.equal(keys.get("appScrollTransition")!.split(":")[6], "0", "rotary did not reveal the first service");
for (let n = 0; n < 100; n++) { keys.set("appStateGeneration", String(n)); await frame(); }
assert.equal(requests.length, 1, "idle and unrelated widget/App notifications must not reload services"); assert.equal(keys.get("hot"), "0");
const beforeDetail = scrollTransitions.length;
await tap(labels.core);
assert.equal(scrollTransitions.length, beforeDetail, "outgoing service list cached over the detail page");
await tap(labels.stop); assert.equal(requests.length, 1, "read-only service must never dispatch");
keys.delete("frameAfter");
await tapBack();
assert.equal(keys.get("frameAfter"), "16", "header Back must schedule the restored list's first scroll frame");
await tap("Demo"); assert.ok(texts().includes(labels.stopped));
button(labels.start)!.onPress!(); button(labels.start)!.onPress!(); await frame();
assert.equal(requests.length, 2, "repeated presses must be serialized");
assert.equal(requests.at(-1).method, "start"); assert.deepEqual(requests.at(-1).request, { id: "extension.demo" });
keys.set("servicesGeneration", "2"); await frame();
assert.equal(requests.length, 2, "invalidation must wait for the pending command");
await reply({}); assert.equal(requests.length, 3); assert.equal(requests.at(-1).method, "list");
catalog[1].running = true; await reply(catalog);
assert.ok(texts().includes(labels.running)); assert.equal(requests.length, 3, "coalesce invalidation with action readback");
await tap(labels.restart); await reply(null, false, "operation timed out");
assert.equal(requests.at(-1).method, "list"); await reply(catalog);
assert.ok(texts().includes(labels.failed), "keep localized operation error after readback");
await tap(labels.stop); await reply({}); catalog[1].running = false; await reply(catalog);
assert.ok(texts().includes(labels.stopped));
keys.set("servicesGeneration", "3"); await frame(); await reply(null, false, "Core unavailable");
const beforeStale = requests.length; await tap(labels.start);
assert.equal(requests.length, beforeStale, "stale catalog must disable actions");
await tapBack();
// Rotary traverses the complete list and confirms the last service.
await rotary(catalog.length - 2); await rotary(0, true);
assert.ok(texts().includes("Extra 4"), "rotary selection must reach the last service");
keys.delete("frameAfter");
await tapBack();
assert.equal(keys.get("frameAfter"), "16");
assert.equal(knobRow.value, catalog.length - 1, "detail Back must restore the service selection");
await rotary(0, true);
keys.set("servicesGeneration", "4"); await frame(); await reply(catalog.slice(0, -1));
assert.ok(texts().includes(labels.missing), "removed service must not retain old actions");
const beforeMissing = requests.length; await tap(labels.stop); assert.equal(requests.length, beforeMissing);
await rotary(0, false, true); assert.equal(keys.get("launch"), "shell");
console.log(`Services ${w}×${h}/${language}: continuous touch/rotary scroll, detail, permissions, operations and idle passed`);
