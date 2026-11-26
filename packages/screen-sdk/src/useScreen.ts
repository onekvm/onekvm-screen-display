import { computed, onScopeDispose, shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { ScreenClient, type Bridge, type Json, type ScreenEvents } from "./client";

let client: ScreenClient | undefined;
function runtime(): ScreenClient {
  if (!client) client = new ScreenClient((globalThis as { onekvm?: Bridge }).onekvm || {});
  return client;
}

/** One RPC queue per guest, scoped subscriptions per component. */
export function useScreen() {
  const session = runtime();
  const state = shallowRef(session.state);
  const context = shallowRef(session.context);
  const language = shallowRef(session.language);
  onFrame(() => {
    session.tick();
    if (JSON.stringify(state.value) !== JSON.stringify(session.state)) state.value = session.state;
    if (JSON.stringify(context.value) !== JSON.stringify(session.context)) context.value = session.context;
    language.value = session.language;
  });
  function on<K extends keyof ScreenEvents>(event: K, handler: (value: ScreenEvents[K]) => void) {
    const unsubscribe = session.on(event, handler);
    onScopeDispose(unsubscribe);
    return unsubscribe;
  }
  return {
    state: computed(() => state.value), context: computed(() => context.value), language: computed(() => language.value), on,
    plugin: { invoke: <T = unknown>(method: string, request: Json = {}) => session.invoke<T>(method, request),
      configure: (settings: Record<string, Json>) => session.configure(settings) },
    openApp: (id: string) => session.openApp(id), openLauncher: () => session.openLauncher(),
    requestFrame: (delayMs?: number) => session.requestFrame(delayMs), animate: (active: boolean) => session.animate(active),
  };
}

/** Initial read, then coalesced producer invalidations; never periodic plugin RPC. */
export function usePluginState<T>(method = "status", request: Json = {}) {
  const screen = useScreen();
  const value = shallowRef<T>();
  const error = shallowRef<Error>();
  const busy = shallowRef(false);
  let dirty = true;
  let disposed = false;
  let running: Promise<void> | undefined;
  onScopeDispose(() => { disposed = true; });
  function refresh(): Promise<void> {
    dirty = true;
    if (running) return running;
    if (disposed || !runtime().context.visible) return Promise.resolve();
    busy.value = true;
    running = Promise.resolve().then(async () => {
      while (dirty && !disposed && runtime().context.visible) {
        dirty = false;
        try { const result = await screen.plugin.invoke<T>(method, request); if (!disposed) { value.value = result; error.value = undefined; } }
        catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause : new Error(String(cause)); }
      }
    }).finally(() => { running = undefined; if (!disposed) busy.value = false; });
    return running;
  }
  screen.on("plugin-state", () => { void refresh(); });
  screen.on("visibility", visible => { if (visible) void refresh(); });
  void refresh();
  return { state: computed(() => value.value), error: computed(() => error.value), busy: computed(() => busy.value), refresh };
}
