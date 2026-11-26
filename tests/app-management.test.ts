import { describe, expect, test } from "bun:test";
import { appLayoutUpdate, managedApps } from "../apps/settings/src/appManagement";

const catalog = JSON.stringify([
  { id: "settings", title: "Settings" },
  { id: "stream", title: "Stream" },
  { id: "power", title: "Power" },
]);

describe("local App management", () => {
  test("lists hidden Apps in saved order so they can be shown again", () => {
    const apps = managedApps(catalog, JSON.stringify({ apps: ["power", "settings"], apps_hidden: ["power"] }));
    expect(apps.map(app => [app.id, app.hidden])).toEqual([["power", true], ["settings", false], ["stream", false]]);
  });

  test("visibility changes preserve widgets, media, order and unavailable Apps", () => {
    const layout = { face: "custom/face", apps: ["power", "settings"], apps_hidden: ["missing"],
      home_widgets: [{ id: "video", media_asset: "original" }], background_crop: { x: 20, y: 80, zoom: 2 } };
    const hidden = appLayoutUpdate(catalog, JSON.stringify(layout), "stream", "hide")!;
    expect(JSON.parse(hidden)).toEqual({ ...layout, apps_hidden: ["missing", "stream"] });
    expect(JSON.parse(appLayoutUpdate(catalog, hidden, "stream", "show")!)).toEqual(layout);
  });

  test("reorders known Apps while retaining unavailable Apps in their saved slots", () => {
    const layout = { apps: ["settings", "missing", "stream", "power"], apps_hidden: ["stream"] };
    const moved = JSON.parse(appLayoutUpdate(catalog, JSON.stringify(layout), "power", "up")!);
    expect(moved).toEqual({ apps: ["settings", "missing", "power", "stream"], apps_hidden: ["stream"] });
    expect(managedApps(catalog, JSON.stringify(moved)).map(app => app.id)).toEqual(["settings", "power", "stream"]);
  });

  test("newly installed Apps can be moved into an existing saved order", () => {
    const moved = appLayoutUpdate(catalog, '{"apps":["settings"]}', "power", "up")!;
    expect(managedApps(catalog, moved).map(app => app.id)).toEqual(["settings", "power", "stream"]);
  });

  test("edges, missing Apps and invalid layouts do not write settings", () => {
    expect(appLayoutUpdate(catalog, "{}", "settings", "up")).toBeNull();
    expect(appLayoutUpdate(catalog, "{}", "power", "down")).toBeNull();
    expect(appLayoutUpdate(catalog, "{}", "missing", "hide")).toBeNull();
    expect(appLayoutUpdate(catalog, "bad", "power", "hide")).toBeNull();
    expect(appLayoutUpdate(catalog, "[]", "power", "hide")).toBeNull();
    expect(appLayoutUpdate(catalog, "{}", "power", "show")).toBeNull();
  });

  test("duplicate or invalid catalog rows never create duplicate actions", () => {
    expect(managedApps('[null,{}, {"id":"a"}, {"id":"a","title":"duplicate"}]', "{}")).toEqual([
      { id: "a", title: "a", hidden: false },
    ]);
  });

  test("home surfaces and widgets are excluded just like the launcher", () => {
    const mixed = JSON.stringify([
      { id: "home", slots: ["home"] }, { id: "widget", slots: ["widget"] },
      { id: "app", slots: ["app", "widget"] }, { id: "legacy" },
    ]);
    expect(managedApps(mixed, "{}").map(app => app.id)).toEqual(["app", "legacy"]);
    expect(appLayoutUpdate(mixed, "{}", "widget", "hide")).toBeNull();
  });
});
