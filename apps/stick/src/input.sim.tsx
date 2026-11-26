import assert from "node:assert/strict";
import { nextTick } from "vue";
import { stickLayout } from "./layout";

const { mount } = await import("@pocketjs/framework/vue-vapor");
const { default: Stick } = await import("./Stick");
const { __packTouch } = await import("../../../../tmp/pocketjs/framework/src/touch.ts");
const w = Number(process.env.STICK_SIM_WIDTH || 320);
const h = w === 320 ? 172 : 240;
const keys = new Map([
  ["controls", '["touch","rotary"]'], ["screenW", String(w)], ["screenH", String(h)],
  ["hid", "1"], ["stickSpeed", "40"], ["knobSeq", "0"],
]);
const writes: [string, string][] = [];
const noop = () => {};
let nextId = 2;
const ops = {
  createNode: () => nextId++, destroyNode: noop, insertBefore: noop, removeChild: noop,
  setStyle: noop, setProp: noop, setText: noop, replaceText: noop, uploadTexture: () => 1,
  setImage: noop, setSprite: noop, animate: () => 1, cancelAnim: noop,
  setFocus: noop, setActive: noop, measureText: () => 8, __textures: {}, __viewport: { w, h },
};
Object.assign(globalThis, {
  ui: ops,
  onekvm: {
    get: (key: string) => keys.get(key) ?? "",
    set(key: string, value: string) { keys.set(key, value); writes.push([key, value]); },
  },
});
mount(() => <Stick />, { ops });
async function contact(x?: number, y?: number, cancel = false) {
  const tick = (globalThis as { frame?: (buttons: number, analog: number, touches: number[], hits: number[]) => void }).frame!;
  tick(0, 0, x === undefined ? [] : [(__packTouch(0, x, y!) | (cancel ? 0x40000000 : 0)) >>> 0], [0]);
  await nextTick();
}
const buttonWrites = () => writes.filter(([key]) => key === "btn").map(([, value]) => value);
const clickWrites = () => writes.filter(([key]) => key === "click").map(([, value]) => value);

await contact();
const layout = stickLayout({ w, h });
const cx = layout.joystick.x + layout.joystick.w / 2, cy = layout.joystick.y + layout.joystick.h / 2;
await contact(cx, cy); await contact();
assert.deepEqual(clickWrites(), ["1"], "joystick tap must emit one click");
assert.equal(keys.get("stickX"), "0");
assert.equal(keys.get("stickY"), "0");

// No hit node: exercise the real geometry fallback on both screen sizes.
for (const [rect, button] of [[layout.left, "1"], [layout.left, "1"], [layout.right, "2"]] as const) {
  await contact(rect.x + rect.w / 2, rect.y + rect.h / 2);
  assert.equal(keys.get("btn"), button, "button did not press after joystick tap");
  await contact();
  assert.equal(keys.get("btn"), "0", "stationary button did not release");
}
assert.deepEqual(buttonWrites(), ["1", "0", "1", "0", "2", "0"]);
assert.deepEqual(clickWrites(), ["1"], "button press also activated joystick");

const lx = layout.left.x + layout.left.w / 2, ly = layout.left.y + layout.left.h / 2;
await contact(lx, ly);
await contact(lx, ly, true);
assert.equal(keys.get("btn"), "0", "cancelled touch retained a pressed button");
assert.equal(keys.get("hot"), "0");
await contact();
await contact(cx, cy); await contact();
assert.deepEqual(clickWrites(), ["1", "1"], "joystick stopped clicking after button cancellation");
const before = buttonWrites().length;
await contact(layout.speed.x + layout.speed.w * .75, layout.speed.y + layout.speed.h / 2);
await contact();
assert.equal(keys.get("stickSpeed"), "75", "speed slider did not respond");
assert.equal(buttonWrites().length, before, "speed slider also pressed a mouse button");
assert.deepEqual(clickWrites(), ["1", "1"], "speed slider also clicked the joystick");
console.log(`touchpad ${w}×${h}: joystick, repeated buttons and cancellation passed`);
