import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, setHot } from "../../../packages/screen-ui/src/device";
import { parseSnapshot, type Snapshot } from "./model";
import { errorMessage } from "./i18n";

export function useSecurity() {
  const snapshot = shallowRef<Snapshot>();
  const busy = shallowRef(false);
  const stale = shallowRef(true);
  const message = shallowRef("");
  let sequence = 0;
  let pending: { id: string; method: string; done?: () => void } | null = null;
  let generation: string | undefined;
  let response = "";
  let refreshPending = true;
  const prefix = `security-${Date.now()}-`;
  const repaint = () => device()?.set?.("frameAfter", "16");
  function request(method: string, payload: Record<string, unknown> = {}, done?: () => void) {
    if (busy.value || (method !== "get" && stale.value)) return false;
    pending = { id: prefix + ++sequence, method, done };
    busy.value = true;
    if (method !== "get") message.value = "";
    device()?.set?.("appRequest", JSON.stringify({ requestId: pending.id, extension: "security", operation: "security", method, request: payload }));
    repaint();
    return true;
  }
  function refresh() { message.value = ""; refreshPending = true; repaint(); }
  onFrame(() => {
    setHot(false);
    const raw = device()?.get?.("appResponse") || "";
    if (raw && raw !== response) {
      response = raw;
      try {
        const result = JSON.parse(raw);
        if (pending && result.requestId === pending.id && result.busy !== true) {
          const { method, done } = pending;
          pending = null; busy.value = false;
          if (result.ok === true) {
            snapshot.value = parseSnapshot(result.response); stale.value = false;
            if (method !== "get") message.value = "saved";
            done?.();
          } else { stale.value = true; message.value = errorMessage(String(result.error || "")); if (method !== "get") refreshPending = true; }
          repaint();
        }
      } catch { busy.value = false; pending = null; stale.value = true; message.value = "failed"; repaint(); }
    }
    const next = device()?.get?.("securityGeneration") || "0";
    if (next !== generation) { generation = next; refreshPending = true; }
    if (!busy.value && refreshPending) { refreshPending = false; request("get"); }
  });
  return { snapshot, busy, stale, message, refresh, request };
}
