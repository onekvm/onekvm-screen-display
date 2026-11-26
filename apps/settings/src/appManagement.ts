export type ListedApp = { id: string; title: string; hidden: boolean };
export type AppAction = "show" | "hide" | "up" | "down";

function readLayout(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export function managedApps(catalog: string, rawLayout: string): ListedApp[] {
  const layout = readLayout(rawLayout);
  const hidden = new Set(ids(layout?.apps_hidden));
  const all = new Map<string, ListedApp>();
  try {
    const parsed: unknown = JSON.parse(catalog || "[]");
    if (Array.isArray(parsed)) for (const item of parsed) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || all.has(item.id)) continue;
      if (Array.isArray(item.slots) && !item.slots.includes("app")) continue;
      all.set(item.id, {
        id: item.id,
        title: typeof item.title === "string" && item.title ? item.title : item.id,
        hidden: hidden.has(item.id),
      });
    }
  } catch { /* A missing catalog has no editable Apps. */ }
  const result: ListedApp[] = [];
  for (const id of [...ids(layout?.apps), ...all.keys()]) {
    const app = all.get(id);
    if (app) { result.push(app); all.delete(id); }
  }
  return result;
}

export function appLayoutUpdate(catalog: string, rawLayout: string, id: string, action: AppAction): string | null {
  const layout = readLayout(rawLayout);
  const apps = managedApps(catalog, rawLayout);
  const index = apps.findIndex(app => app.id === id);
  if (!layout || index < 0) return null;
  if (action === "show" || action === "hide") {
    const hidden = new Set(ids(layout.apps_hidden));
    if (hidden.has(id) === (action === "hide")) return null;
    if (action === "hide") hidden.add(id);
    else hidden.delete(id);
    return JSON.stringify({ ...layout, apps_hidden: [...hidden] });
  }
  const target = index + (action === "up" ? -1 : 1);
  if (target < 0 || target >= apps.length) return null;
  [apps[index], apps[target]] = [apps[target], apps[index]];
  const known = new Set(apps.map(app => app.id));
  const ordered = apps.map(app => app.id);
  const saved = [...new Set(ids(layout.apps))];
  // Retain unavailable Apps in their saved slots so reinstalling them keeps
  // their place. Fill the known slots with the newly selected order.
  let next = 0;
  const order = saved.map(savedId => known.has(savedId) ? ordered[next++] : savedId);
  order.push(...ordered.slice(next));
  return JSON.stringify({ ...layout, apps: order });
}
