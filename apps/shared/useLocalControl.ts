import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, setHot } from "../../packages/screen-ui/src/device";

/** One guest channel; completion and Core/catalog events wake it without polling. */
export function useLocalControl(operation: "virtual-media" | "keyboard", receive: (method: string, value: unknown, payload: Record<string, unknown>) => void) {
  const busy = shallowRef(false);
  const stale = shallowRef(true);
  const message = shallowRef("");
  let sequence = 0;
  let pending: { id: string; method: string; payload: Record<string, unknown>; done?: () => void } | null = null;
  let generation: string | undefined;
  let lastResponse = "";
  let refreshPending = true;
  let forceRefresh = false;
  const prefix = `${operation}-${Date.now()}-`;
  const repaint = () => device()?.set?.("frameAfter", "16");
  function request(method: string, payload: Record<string, unknown> = {}, done?: () => void) {
    if (busy.value || (stale.value && !["get"].includes(method))) return false;
    pending = { id: prefix + ++sequence, method, payload, done };
    busy.value = true;
    message.value = "";
    device()?.set?.("appRequest", JSON.stringify({ requestId: pending.id, extension: operation, operation, method, request: payload }));
    repaint();
    return true;
  }
  function refresh(force = false) { refreshPending = true; forceRefresh ||= force; repaint(); }
  onFrame(() => {
    setHot(false);
    const raw = device()?.get?.("appResponse") || "";
    if (raw && raw !== lastResponse) {
      lastResponse = raw;
      try {
        const reply = JSON.parse(raw);
        if (pending && reply.requestId === pending.id && reply.busy !== true) {
          const { method, payload, done } = pending;
          pending = null; busy.value = false;
          if (reply.ok === true) {
            stale.value = false;
            receive(method, reply.response, payload);
            done?.();
            // A completion can start the next step (connect → mount). Refresh only
            // after that sequence finishes, so it cannot hide a later failure.
            if (!["get", "browse"].includes(method) && !busy.value) { message.value = "done"; refresh(); }
          } else {
            if (method === "get") stale.value = true;
            message.value = /timeout|timed.*out|NoReply/i.test(reply.error || "") ? "timedOut" :
              /UnknownMethod|ServiceUnknown|NameHasNoOwner|virtual media is unavailable/i.test(reply.error || "") ? "unavailable" :
              method === "connect" ? "connectFailed" :
              /virtual media is disconnected/i.test(reply.error || "") ? "mediaDisconnected" :
              /virtual media is busy/i.test(reply.error || "") ? "mediaBusy" : "failed";
          }
          repaint();
        }
      } catch { busy.value = false; pending = null; stale.value = true; message.value = "failed"; repaint(); }
    }
    const next = device()?.get?.("appStateGeneration") || "0";
    if (next !== generation) { generation = next; refreshPending = true; }
    if (!busy.value && refreshPending) {
      refreshPending = false;
      const refresh = forceRefresh; forceRefresh = false;
      request("get", { refresh });
    }
  });
  return { busy, stale, message, request, refresh };
}
