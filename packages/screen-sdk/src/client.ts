/** Version 1 public surface bridge; deliberately independent of Vue and I/O. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Settings = Readonly<Record<string, Json>>;
export interface Bridge { get?(key: string): string; set?(key: string, value: string): void }
export interface ScreenState {
  readonly network: Readonly<{ ip?: string; ipv4_addresses?: readonly string[]; hostname?: string; ethernet_connected?: boolean; wifi_connected?: boolean }>;
  readonly video: Readonly<{ active?: boolean; session_count?: number; hdmi_connected?: boolean; codec?: string; actual_fps?: number; fps?: number; input_width?: number; input_height?: number }>;
  readonly hid: Readonly<{ connected?: boolean }>;
  readonly system: Readonly<{ cpu_percent?: number; memory_used_bytes?: number; memory_total_bytes?: number; storage_available_bytes?: number; storage_total_bytes?: number }>;
  readonly uptime_seconds?: number;
  readonly machine?: string;
  readonly version?: string;
}
export interface SurfaceContext {
  readonly version: 1;
  readonly instanceId: string;
  readonly role: "home" | "widget";
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly settings: Settings;
}
export interface ScreenEvents {
  state: ScreenState;
  network: ScreenState["network"];
  video: ScreenState["video"];
  hid: ScreenState["hid"];
  resources: ScreenState["system"];
  language: string;
  config: Settings;
  visibility: boolean;
  focus: boolean;
  rotary: Readonly<{ step: number; confirm: boolean }>;
  "plugin-state": Readonly<{ generation: string }>;
}
type Listener<K extends keyof ScreenEvents> = (event: ScreenEvents[K]) => void;
interface Pending {
  id: string;
  method: string;
  request: Json;
  configure: boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function object(raw: string | undefined): Record<string, unknown> {
  try { const value: unknown = JSON.parse(raw || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  catch { return {}; }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function stateFrom(raw: string | undefined): ScreenState {
  return freeze({ network: {}, video: {}, hid: {}, system: {}, ...object(raw) }) as ScreenState;
}
function utf8Size(value: string): number {
  let size = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}

export class ScreenClient {
  state: ScreenState;
  context: SurfaceContext;
  language: string;
  private listeners = new Map<keyof ScreenEvents, Set<(event: never) => void>>();
  private generation: string;
  private sequence: string;
  private nextId = 0;
  private queue: Pending[] = [];
  private pending: Pending | undefined;
  private closed = false;

  constructor(readonly bridge: Bridge) {
    this.state = stateFrom(bridge.get?.("screenState"));
    this.context = this.readContext();
    this.language = bridge.get?.("language") || "en";
    this.generation = bridge.get?.("appStateGeneration") || "0";
    this.sequence = bridge.get?.("knobSeq") || "0";
  }

  private readContext(): SurfaceContext {
    return freeze({ version: 1, instanceId: "", role: "widget", width: 240, height: 240,
      visible: true, focused: false, settings: {}, ...object(this.bridge.get?.("surfaceContext")) }) as SurfaceContext;
  }

  on<K extends keyof ScreenEvents>(event: K, listener: Listener<K>): () => void {
    if (this.closed) throw new Error("Screen session is closed");
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, set = new Set());
    const callback = listener as (event: never) => void;
    set.add(callback);
    return () => set.delete(callback);
  }

  private emit<K extends keyof ScreenEvents>(event: K, value: ScreenEvents[K]): void {
    for (const listener of [...(this.listeners.get(event) || [])]) listener(value as never);
  }

  /** Host wake/frame callback. This reads cached bridge values and performs no I/O. */
  tick(): void {
    if (this.closed) return;
    const context = this.readContext();
    const previous = this.context;
    this.context = context;
    if (JSON.stringify(context.settings) !== JSON.stringify(previous.settings)) this.emit("config", context.settings);
    if (context.visible !== previous.visible) this.emit("visibility", context.visible);
    if (context.focused !== previous.focused) this.emit("focus", context.focused);
    if (context.visible) {
      const state = stateFrom(this.bridge.get?.("screenState"));
      const old = this.state;
      this.state = state;
      if (JSON.stringify(state) !== JSON.stringify(old)) this.emit("state", state);
      for (const [field, event] of [["network", "network"], ["video", "video"], ["hid", "hid"], ["system", "resources"]] as const) {
        if (JSON.stringify(state[field]) !== JSON.stringify(old[field])) this.emit(event, state[field]);
      }
      const language = this.bridge.get?.("language") || "en";
      if (language !== this.language) { this.language = language; this.emit("language", language); }
      const generation = this.bridge.get?.("appStateGeneration") || "0";
      if (generation !== this.generation) { this.generation = generation; this.emit("plugin-state", freeze({ generation })); }
      const sequence = this.bridge.get?.("knobSeq") || "0";
      // The press that enters a widget belongs to the shell. Focus gain and
      // resume must not replay the host's previously latched rotary input.
      if (context.focused && !previous.focused) this.sequence = sequence;
      if (sequence !== this.sequence) {
        this.sequence = sequence;
        if (sequence !== "0") this.emit("rotary", freeze({ step: Math.trunc(Number(this.bridge.get?.("knob") || "0")) || 0, confirm: this.bridge.get?.("knobClick") === "1" }));
      }
    }
    const reply = object(this.bridge.get?.("appResponse"));
    // Never let a late reply or another channel's response resolve this call.
    if (this.pending && reply.requestId === this.pending.id && reply.busy === false) {
      const pending = this.pending;
      this.pending = undefined;
      if (reply.ok === true) pending.resolve(reply.response);
      else pending.reject(new Error(typeof reply.error === "string" ? reply.error : "Plugin call failed"));
    }
    this.dispatch();
  }

  invoke<T = unknown>(method: string, request: Json = {}): Promise<T> { return this.call<T>(method, request, false); }
  configure(settings: Record<string, Json>): Promise<{ saved: true }> { return this.call("", settings, true); }

  private call<T>(method: string, request: Json, configure: boolean): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Screen session is closed"));
    if (!configure && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(method)) return Promise.reject(new Error("Invalid plugin method"));
    if (this.queue.length >= 32) return Promise.reject(new Error("Too many pending plugin calls"));
    // Snapshot mutable caller data before the call is queued.
    let payload: Json;
    try {
      const raw = JSON.stringify(request);
      if (utf8Size(raw) > 4096) return Promise.reject(new Error("Plugin payload exceeds 4096 bytes"));
      payload = JSON.parse(raw);
    }
    catch { return Promise.reject(new Error("Plugin request must be JSON")); }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id: `sdk-${++this.nextId}`, method, request: payload, configure, resolve: value => resolve(value as T), reject });
      this.dispatch();
    });
  }

  private dispatch(): void {
    if (this.pending || !this.queue.length || !this.context.visible || this.closed) return;
    const pending = this.queue.shift()!;
    const owner = this.bridge.get?.("pluginId");
    if (!owner || !this.bridge.set) { pending.reject(new Error("Plugin bridge is unavailable")); this.dispatch(); return; }
    this.pending = pending;
    try {
      this.bridge.set("appRequest", JSON.stringify({ requestId: pending.id, extension: owner,
        ...(pending.configure ? { operation: "configure" } : { method: pending.method }), request: pending.request }));
    } catch (error) { this.pending = undefined; pending.reject(error instanceof Error ? error : new Error(String(error))); this.dispatch(); }
  }

  openApp(id: string): void { this.bridge.set?.("launch", id); }
  openLauncher(): void { this.bridge.set?.("launch", "launcher"); }
  requestFrame(delayMs = 16): void { this.bridge.set?.("frameAfter", String(Math.max(16, Math.min(60_000, Math.round(delayMs))))); }
  animate(active: boolean): void { this.bridge.set?.("hot", active ? "1" : "0"); }

  close(): void {
    this.closed = true;
    const error = new Error("Screen session is closed");
    this.pending?.reject(error);
    this.pending = undefined;
    for (const pending of this.queue.splice(0)) pending.reject(error);
    this.listeners.clear();
  }
}
