import assert from "node:assert/strict";
import { nextTick } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { rootMirror } from "@pocketjs/framework/renderer";
import Security from "../apps/security/src/Security";
import { fields, fieldValue, patchField, type Snapshot } from "../apps/security/src/model";
import { layoutKeys, nextKeyMode } from "../src/shell/keypad";
import { knobRow } from "../src/shell/ListRow";

import { __packTouch } from "../../tmp/pocketjs/framework/src/touch";

const [w, h] = (process.env.SCREEN_SIM_SIZE || "320x172").split("x").map(Number);
const language = process.env.SCREEN_SIM_LANG || "zh";
const labels = {
  en: { login: "Login protection", attempts: "Failed attempts", edit: "Edit", save: "Save", cancel: "Cancel", refresh: "Refresh", invalid: "Invalid value", bans: "Blocked addresses", unblock: "Unblock", add: "Block address", address: "Address / CIDR" },
  zh: { login: "登录保护", attempts: "失败次数", edit: "编辑", save: "保存", cancel: "取消", refresh: "刷新", invalid: "数值或格式无效", bans: "封禁地址", unblock: "解除封禁", add: "封禁地址", address: "地址／网段" },
  zh_tw: { login: "登入保護", attempts: "失敗次數", edit: "編輯", save: "儲存", cancel: "取消", refresh: "重新整理", invalid: "數值或格式無效", bans: "封鎖位址", unblock: "解除封鎖", add: "封鎖位址", address: "位址／網段" },
}[language as "en" | "zh" | "zh_tw"];
const keys = new Map(Object.entries({ screenW: String(w), screenH: String(h), controls: '["touch","rotary"]', knobSeq: "0", language, securityGeneration: "1", knobOn: "1", touchOn: "1" }));
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

const snapshot: Snapshot = { settings: {}, bans: [{ id: "test-ban", address: "192.0.2.10", reason: "Test", source: "manual", expires_at: null }], honeypot: { enabled: true } };
for (const list of Object.values(fields)) for (const field of list) {
  const value = field.kind === "boolean" ? true : field.kind === "number" ? (field.key.endsWith("max_failures") ? 5 : Math.max(field.min!, 10)) : field.kind === "choice" ? field.choices![0] : field.key.endsWith("trusted_proxies") ? ["192.0.2.1"] : "X-Forwarded-For";
  const [parent, child] = field.key.split(".");
  if (child) { (snapshot.settings[parent] ??= {} as any); (snapshot.settings[parent] as any)[child] = value; }
  else snapshot.settings[parent] = value;
}
async function reveal(text: string) { assert.ok(button(text), `not found in continuous list: ${text}`); }
async function key(token: string, kind: "number" | "text" = "number", mode = 0) {
  const cap = layoutKeys(kind, mode, { w, h }).caps.find(cap => cap.token === token)!;
  assert.ok(cap, `key ${token}`);
  await frame([__packTouch(0, Math.floor(cap.x + cap.w / 2), Math.floor(cap.y + cap.h / 2))]); await frame(); await frame();
}
mount(() => <Security />, { ops }); await frame(); await frame();
assert.equal(requests.length, 1); assert.equal(requests[0].method, "get");
await rotary(1); assert.equal(knobRow.value, 1, "loading skipped navigation rows and moved focus to Back");
await rotary(-1); assert.equal(knobRow.value, 0); assert.equal(requests.length, 1);
await reply(snapshot, true, "", "foreign"); assert.equal(requests.length, 1);
await reply(snapshot);
assert.equal(button("›"), undefined, "security still has a pager");
const rootListText = texts().join(" ");
assert.ok(!/\d+\/\d+/.test(rootListText), "security still shows page numbers");
await frame([__packTouch(0, Math.floor(w/2), h-20)]);
await frame([__packTouch(0, Math.floor(w/2), h-80)]);
assert.ok(propSets.some(([, prop, value]) => prop === 129 && value === -60), "security list did not follow the finger");
await frame(); await frame();
const glide = keys.get("appScrollTransition")!.split(":").map(Number);
assert.equal(glide.length, 8); assert.equal(glide[2], 40); assert.equal(glide[3], h-40);
keys.set("appScrollPosition", `${glide[4]}:17`);
await frame([__packTouch(0, Math.floor(w/2), h-20)]); await frame(); keys.delete("appScrollPosition");
assert.ok(propSets.some(([node, prop, value]) => node === glide[4] && prop === 129 && value === -17), "touch grab ignored the visible native scroll position");
await rotary(1); await rotary(-1);
assert.equal(keys.get("appScrollTransition")!.split(":")[6], "0", "rotary did not reveal the first row");
for (let n = 0; n < 100; n++) { keys.set("appStateGeneration", String(n)); keys.set("servicesGeneration", String(n)); await frame(); }
assert.equal(requests.length, 1, "idle and unrelated notifications do not reload security"); assert.equal(keys.get("hot"), "0");
await rotary(3);
const beforeCategory = scrollTransitions.length;
await rotary(0, true);
assert.equal(scrollTransitions.length, beforeCategory, "removed list scrolled over the new category");
await tapBack();
await tap(labels.login); assert.ok(texts().includes(labels.login), "category header did not update");
// Opening an editor must not send one last scroll from the list being removed.
// The native compositor otherwise caches the old list over the new editor.
await rotary(6);
const beforeEditor = scrollTransitions.length;
await rotary(0, true);
assert.equal(scrollTransitions.length, beforeEditor, "removed list scrolled over the editor");
assert.equal(button(labels.cancel), undefined, "editor still has a redundant Cancel button");
await tapBack();
await rotary(2); await rotary(0, true);
await tap(labels.edit); await key("BS"); await key("7"); await key("OK");
// An external configuration change must not overwrite the visible draft.
keys.set("securityGeneration", "2"); await frame(); await reply(snapshot);
assert.ok(texts().includes("7"));
await tap(labels.save); assert.equal(requests.at(-1).method, "save");
assert.deepEqual(requests.at(-1).request, { login_protection_max_failures: 7 });
snapshot.settings.login_protection_max_failures = 7; await reply(snapshot);
await reveal(labels.attempts); await tap(labels.attempts); await tap(labels.edit); await key("BS"); await key("0"); await key("OK");
const count = requests.length; await tap(labels.save); assert.equal(requests.length, count); assert.ok(texts().includes(labels.invalid));
await tapBack(); await tapBack();
await reveal(labels.bans); await tap(labels.bans); await reply(snapshot);
await reveal("192.0.2.10"); await tap("192.0.2.10"); await tap(labels.unblock);
assert.deepEqual(requests.at(-1).request, { id: "test-ban" }); assert.equal(requests.at(-1).method, "remove-ban");
snapshot.bans = []; await reply(snapshot);
await reveal(labels.add); await tap(labels.add); await tap(labels.address); await tap(labels.edit);
// Step the mode key to the first mode, in the board's own order, that has each character.
let textMode = 0;
for (const char of "192.0.2.1") {
  const want = [0, 1, 2, 3].find((mode) => layoutKeys("text", mode, { w, h }).caps.some((cap) => cap.token === char))!;
  while (textMode !== want) { await key("MD", "text", textMode); textMode = nextKeyMode(textMode, { w, h }); }
  await key(char, "text", textMode);
}
await key("OK", "text", textMode); await tap(labels.save);
await reveal(labels.add); await tap(labels.add); assert.equal(requests.at(-1).method, "add-ban"); assert.equal(requests.at(-1).request.address, "192.0.2.1");
await reply(null, false, "invalid ban address"); assert.equal(requests.at(-1).method, "get");
await reply(snapshot); assert.ok(texts().includes(labels.invalid));
assert.ok(texts().includes("192.0.2.1"), "failed ban keeps the edited address");
// Refresh remains reachable after a failure, and failed state forbids writes.
keys.set("securityGeneration", "3"); await frame(); await reply(null, false, "Core unavailable");
const failed = requests.length; await reveal(labels.add); await tap(labels.add);
assert.equal(requests.length, failed);
await tapBack();
const refreshButton = (() => { function find(node: Node): Node | undefined { if (node.onPress && texts(node).some(s => s === labels.refresh)) return node; return node.children.map(find).find(Boolean); } return find(root); })();
assert.ok(refreshButton); refreshButton!.onPress!(); await frame(); await reply(snapshot);
assert.equal(keys.get("hot"), "0");
await tapBack(); // banned-address list -> root
await rotary(0, true); // Login protection
await rotary(0, true); // Enabled
await rotary(0, true); // Change draft
await rotary(1); await rotary(0, true); // Save
assert.equal(requests.at(-1).method, "save");
assert.deepEqual(requests.at(-1).request, { login_protection_enabled: false });
snapshot.settings.login_protection_enabled = false; await reply(snapshot);
await rotary(6); await rotary(0, true); // Scroll to IPv6 prefix
assert.ok(texts().includes("IPv6 prefix") || texts().includes("IPv6 前缀") || texts().includes("IPv6 前綴"));
await rotary(1); await rotary(0, true); // Header Back; disabled Save is skipped.
assert.equal(button(labels.edit), undefined, "header Back did not leave the clean editor");
await rotary(0, false, true); assert.equal(keys.get("launch"), "shell");
assert.deepEqual(patchField(fields.proxy[8], "false"), { reverse_proxy: { hsts_enabled: false } });
assert.throws(() => fieldValue(fields.login[2], "101"));
console.log(`Security ${w}×${h}/${language}: editing, partial save, draft retention, bans, failures, touch, rotary and idle passed`);
