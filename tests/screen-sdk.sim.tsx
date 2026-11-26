import assert from "node:assert/strict";
import { nextTick, shallowRef } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { View, Text, useScreen, usePluginState } from "@onekvm/screen-sdk";

const requests: any[] = [];
const context = { version: 1, role: "widget", instanceId: "test", width: 56, height: 32, visible: true, settings: {} };
const keys = new Map<string, string>(Object.entries({ pluginId: "example", knobSeq: "0", appStateGeneration: "1", screenState: '{"network":{"ip":"one"}}' }));
(globalThis as any).onekvm = {
  get: (key: string) => key === "surfaceContext" ? JSON.stringify(context) : keys.get(key) || "",
  set: (key: string, value: string) => { if (key === "appRequest") requests.push(JSON.parse(value)); },
};
let id = 2;
const noop = () => {};
const ops = { createNode: () => id++, destroyNode: noop, insertBefore: noop, removeChild: noop,
  setStyle: noop, setProp: noop, setText: noop, replaceText: noop, setImage: noop, setSprite: noop,
  uploadTexture: () => 1, setFocus: noop, setActive: noop, measureText: () => 8, __textures: {} };
const show = shallowRef(true);
let networkChanges = 0;
let status: ReturnType<typeof usePluginState<{ count: number }>>;
function Child() {
  const screen = useScreen();
  screen.on("network", () => networkChanges++);
  status = usePluginState<{ count: number }>();
  return <Text>{status.state.value?.count ?? -1}</Text>;
}
function Root() { return <View>{show.value && <Child />}</View>; }
mount(Root, { ops });
async function frame() { (globalThis as any).frame(0, 0, []); await nextTick(); await Promise.resolve(); }
async function reply(count: number) {
  keys.set("appResponse", JSON.stringify({ requestId: requests.at(-1).requestId, busy: false, ok: true, response: { count } }));
  await frame(); await frame();
}
await frame(); await frame();
assert.equal(requests.length, 1);
keys.set("appStateGeneration", "2"); await frame();
await reply(1);
assert.equal(requests.length, 2, "an invalidation during RPC must be read after completion");
await reply(2);
assert.equal(status!.state.value?.count, 2);
for (let n = 0; n < 120; n++) await frame();
assert.equal(requests.length, 2, "idle surfaces must not poll the plugin");
context.visible = false; await frame();
keys.set("appStateGeneration", "3"); await frame();
assert.equal(requests.length, 2);
context.visible = true; await frame(); await frame();
assert.equal(requests.length, 3, "resume and invalidation in one frame should coalesce");
await reply(3);
assert.equal(requests.length, 3);
keys.set("screenState", '{"network":{"ip":"two"}}'); await frame();
assert.equal(networkChanges, 1);
show.value = false; await frame(); await frame();
keys.set("screenState", '{"network":{"ip":"three"}}'); await frame();
keys.set("appStateGeneration", "4"); await frame();
assert.equal(networkChanges, 1, "unmounted components must unsubscribe");
assert.equal(requests.length, 3, "unmounted plugin subscriptions must stop reading");
console.log("Screen SDK: rendered state, in-flight invalidation, resume coalescing, idle and scope cleanup passed");
