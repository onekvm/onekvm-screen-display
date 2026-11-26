import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, setHot } from "../../../packages/screen-ui/src/device";
import { canAct, parseServices, type Service, type ServiceAction } from "./model";
import { errorMessage, type Message } from "./i18n";

/** Request once on entry, on invalidation and after an operation; never poll. */
export function useServices() {
  const items = shallowRef<Service[]>([]);
  const busy = shallowRef(false);
  const stale = shallowRef(true);
  const message = shallowRef<Message>("");
  let sequence = 0;
  let pending: { id: string; method: "list" | ServiceAction } | null = null;
  let generation: string | undefined;
  let response = "";
  let refreshPending = true;
  const prefix = `services-${Date.now()}-`;
  const repaint = () => device()?.set?.("frameAfter", "16");
  function request(method: "list" | ServiceAction, id?: string) {
    pending = { id: prefix + ++sequence, method };
    busy.value = true;
    device()?.set?.("appRequest", JSON.stringify({ requestId: pending.id, extension: "services", operation: "services", method, request: id ? { id } : {} }));
    repaint();
  }
  function refresh() { refreshPending = true; repaint(); }
  function action(id: string, method: ServiceAction) {
    if (busy.value || stale.value || !canAct(items.value.find(item => item.id === id), method)) return;
    message.value = "";
    request(method, id);
  }
  onFrame(() => {
    // Native RPC completion wakes this App. A single delayed frame flushes
    // reactive output; a pending operation does not keep JS rendering hot.
    setHot(false);
    const raw = device()?.get?.("appResponse") || "";
    if (raw && raw !== response) {
      response = raw;
      try {
        const result = JSON.parse(raw);
        if (pending && result.requestId === pending.id && result.busy !== true) {
          const method = pending.method;
          pending = null;
          busy.value = false;
          if (result.ok === true) {
            if (method === "list") { items.value = parseServices(result.response); stale.value = false; }
            else message.value = method === "start" ? "started" : method === "stop" ? "stoppedDone" : "restarted";
          } else {
            if (method === "list") stale.value = true;
            message.value = errorMessage(String(result.error || ""));
          }
          if (method !== "list") refreshPending = true;
          repaint();
        }
      } catch {
        busy.value = false; pending = null; stale.value = true; message.value = "readFailed"; repaint();
      }
    }
    // Widget/QR/other App invalidations do not change service lifecycle state.
    const next = device()?.get?.("servicesGeneration") || "0";
    if (next !== generation) { generation = next; refreshPending = true; }
    if (!busy.value && refreshPending) {
      refreshPending = false;
      request("list");
    }
  });
  return { items, busy, stale, message, refresh, action };
}
