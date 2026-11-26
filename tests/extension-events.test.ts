import { expect, mock, test } from "bun:test";

let frame: () => void;
mock.module("@pocketjs/framework/vue-vapor/lifecycle", () => ({ onFrame: (fn: () => void) => { frame = fn; } }));
const { useExtension } = await import("../packages/screen-ui/src/useExtension");

test("extension status follows invalidations and actions, including an event received while busy", () => {
  let generation = "1";
  let response = "";
  let sequence = 0;
  const calls: string[] = [];
  (globalThis as any).onekvm = {
    get: (key: string) => key === "appResponse" ? response : key === "appStateGeneration" ? generation : "",
    set: (_key: string, value: string) => calls.push(JSON.parse(value).method),
  };
  const state = useExtension({ extension: "example", title: "Example", icon: "src/logo.png", kind: "network", statusMethod: "status", actions: [{ method: "configure", title: "Enable" }] });
  const reply = (payload: object) => { response = JSON.stringify({ id: ++sequence, busy: false, ok: true, response: payload }); frame(); };
  frame();
  expect(calls).toEqual(["status"]);
  reply({ enabled: false });
  for (let n = 0; n < 1000; n++) frame();
  expect(calls).toEqual(["status"]);
  generation = "2";
  frame();
  expect(calls).toEqual(["status", "status"]);
  generation = "3";
  frame();
  expect(calls).toHaveLength(2);
  reply({ enabled: true });
  expect(calls).toEqual(["status", "status", "status"]);
  reply({ enabled: true });
  state.action(0);
  expect(calls.at(-1)).toBe("configure");
  reply({ saved: true });
  expect(state.state.value).toEqual({ enabled: true });
  expect(calls.at(-1)).toBe("status");
  reply({ enabled: false });
  for (let n = 0; n < 1000; n++) frame();
  expect(calls).toHaveLength(5);
  delete (globalThis as any).onekvm;
});
