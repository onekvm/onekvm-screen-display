export type ServiceAction = "start" | "stop" | "restart";
export interface Service {
  id: string;
  name: string;
  running: boolean;
  enabled: boolean;
  actions: ServiceAction[];
}

export function parseServices(value: unknown): Service[] {
  if (!Array.isArray(value)) throw new Error("invalid service catalog");
  const seen = new Set<string>();
  return value.slice(0, 512).flatMap(item => {
    if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id)) return [];
    seen.add(item.id);
    // Bundles have baked glyphs. Provider IDs remain readable even for an
    // extension whose custom title needs glyphs absent from this bundle.
    const name = typeof item.name === "string" && /^[\x20-\x7e]+$/.test(item.name) ? item.name : item.id;
    return [{ id: item.id, name: name.slice(0, 160), running: item.running === true, enabled: item.enabled === true,
      actions: Array.isArray(item.actions) ? item.actions.filter((a: unknown): a is ServiceAction => a === "start" || a === "stop" || a === "restart") : [] }];
  });
}

export function canAct(service: Service | undefined, action: ServiceAction): boolean {
  return !!service && service.actions.includes(action) && (action === "start" ? !service.running : service.running);
}
