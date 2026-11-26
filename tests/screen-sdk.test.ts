import { expect, test } from "bun:test";
import { ScreenClient, type Bridge } from "../packages/screen-sdk/src/client";
import { parseLayout, parseContributedWidgets } from "../web/display/types";

function fixture() {
  const keys = new Map<string, string>(Object.entries({ pluginId: "companion", knobSeq: "0", appStateGeneration: "1",
    screenState: JSON.stringify({ network: { ip: "10.0.0.1" }, system: { cpu_percent: 3 } }),
    surfaceContext: JSON.stringify({ role: "widget", instanceId: "first", visible: true, settings: {} }),
  }));
  const sent: Record<string, unknown>[] = [];
  const bridge: Bridge = { get: key => keys.get(key) || "", set: (key, value) => {
    keys.set(key, value); if (key === "appRequest") sent.push(JSON.parse(value));
  } };
  const client = new ScreenClient(bridge);
  const reply = (id: unknown, response: unknown, ok = true) => { keys.set("appResponse", JSON.stringify({ requestId: id, busy: false, ok, response, error: "Denied" })); client.tick(); };
  return { keys, sent, client, reply };
}

test("subscriptions emit changed groups once, preserve readonly snapshots and unsubscribe", () => {
  const { keys, client } = fixture();
  const network: unknown[] = [], resources: unknown[] = [], notifications: unknown[] = [];
  const off = client.on("network", value => network.push(value));
  client.on("resources", value => resources.push(value));
  client.on("plugin-state", value => notifications.push(value));
  client.tick();
  expect(network).toHaveLength(0);
  keys.set("screenState", JSON.stringify({ network: { ip: "10.0.0.2" }, system: { cpu_percent: 3 } }));
  keys.set("appStateGeneration", "2"); client.tick(); client.tick();
  expect(network).toEqual([{ ip: "10.0.0.2" }]);
  expect(resources).toHaveLength(0);
  expect(notifications).toEqual([{ generation: "2" }]);
  expect(Object.isFrozen(client.state.network)).toBe(true);
  off();
  keys.set("screenState", JSON.stringify({ network: { ip: "10.0.0.3" } })); client.tick();
  expect(network).toHaveLength(1);
  expect(resources).toEqual([{}]);
});

test("plugin calls share a FIFO, bind the companion identity and correlate exact request IDs", async () => {
  const { keys, sent, client, reply } = fixture();
  const first = client.invoke<{ count: number }>("status");
  const payload = { count: 2 };
  const second = client.invoke("increment", payload);
  payload.count = 99;
  expect(sent).toHaveLength(1);
  expect(sent[0].extension).toBe("companion");
  reply("foreign", { count: 99 });
  expect(sent).toHaveLength(1);
  reply(sent[0].requestId, { count: 1 });
  expect(await first).toEqual({ count: 1 });
  expect(sent).toHaveLength(2);
  expect(sent[1].request).toEqual({ count: 2 });
  reply(sent[0].requestId, { count: 3 });
  expect(keys.get("appResponse")).toContain(String(sent[0].requestId));
  reply(sent[1].requestId, { count: 2 });
  expect(await second).toEqual({ count: 2 });
});

test("denied calls reject, configuration uses its own envelope and queues continue", async () => {
  const { sent, client, reply } = fixture();
  const denied = client.invoke("increment");
  const failure = denied.catch(error => error);
  const configured = client.configure({ title: "Example" });
  reply(sent[0].requestId, null, false);
  expect((await failure).message).toBe("Denied");
  expect(sent[1]).toMatchObject({ extension: "companion", operation: "configure", request: { title: "Example" } });
  expect(sent[1]).not.toHaveProperty("enabled");
  reply(sent[1].requestId, { saved: true });
  expect(await configured).toEqual({ saved: true });
});

test("hidden surfaces pause new RPCs; visibility, config and input events resume correctly", async () => {
  const { keys, sent, client, reply } = fixture();
  const events: unknown[] = [];
  client.on("visibility", visible => events.push(visible));
  client.on("config", settings => events.push(settings));
  client.on("rotary", input => events.push(input));
  keys.set("surfaceContext", JSON.stringify({ visible: false, settings: { city: "Tokyo" } })); client.tick();
  const pending = client.invoke("status");
  expect(sent).toHaveLength(0);
  keys.set("surfaceContext", JSON.stringify({ visible: true, settings: { city: "Tokyo" } }));
  keys.set("knobSeq", "1"); keys.set("knob", "2"); keys.set("knobClick", "1"); client.tick();
  expect(events).toEqual([{ city: "Tokyo" }, false, true, { step: 2, confirm: true }]);
  reply(sent[0].requestId, {}); await pending;
});

test("closing the session rejects active and queued calls and clears subscriptions", async () => {
  const { client } = fixture();
  const first = client.invoke("status"), second = client.invoke("status");
  const failures = Promise.all([first.catch(error => error), second.catch(error => error)]);
  client.close();
  expect((await failures).map(error => error.message)).toEqual(["Screen session is closed", "Screen session is closed"]);
  await expect(client.invoke("status")).rejects.toThrow("closed");
});

test("focus entry and resume do not replay the rotary press that selected a widget", () => {
  const { keys, client } = fixture();
  const events: unknown[] = [];
  client.on("rotary", input => events.push(input));
  keys.set("surfaceContext", JSON.stringify({ visible: true, focused: true, settings: {} }));
  keys.set("knobSeq", "1"); keys.set("knobClick", "1"); client.tick();
  expect(events).toEqual([]);
  keys.set("knobSeq", "2"); client.tick();
  expect(events).toEqual([{ step: 0, confirm: true }]);
  keys.set("surfaceContext", JSON.stringify({ visible: false, focused: false, settings: {} })); client.tick();
  keys.set("knobSeq", "3");
  keys.set("surfaceContext", JSON.stringify({ visible: true, focused: true, settings: {} })); client.tick();
  expect(events).toHaveLength(1);
  keys.set("knobSeq", "4"); client.tick();
  expect(events).toHaveLength(2);
});

test("oversized UTF-8 payloads reject locally without blocking subsequent calls", async () => {
  const { sent, client, reply } = fixture();
  await expect(client.invoke("status", { text: "中".repeat(1400) })).rejects.toThrow("4096");
  expect(sent).toHaveLength(0);
  const pending = client.invoke("status");
  reply(sent[0].requestId, {});
  await pending;
});

test("saving designer layouts retains selected home and independent widget settings", () => {
  const layout = { home: "companion/home", home_settings: { city: "Tokyo" }, home_widgets: [
    { id: "first", widget: "companion/widget", settings: { server: "alpha" } },
    { id: "second", widget: "companion/widget", settings: { server: "beta" } },
  ] };
  const roundtrip = parseLayout(JSON.stringify(parseLayout(JSON.stringify(layout))));
  expect(roundtrip.home).toBe(layout.home);
  expect(roundtrip.home_settings).toEqual(layout.home_settings);
  expect(roundtrip.home_widgets.map(widget => widget.settings)).toEqual([{ server: "alpha" }, { server: "beta" }]);
  expect(parseContributedWidgets(JSON.stringify([{ id: "companion/widget", data: { bundle: "screen-widget" } }]))[0].programmable).toBe(true);
});
