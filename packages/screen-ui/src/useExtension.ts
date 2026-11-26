import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, invoke } from "./device";
import type { MessageKey } from "./i18n";
import type { AppConfig, Status } from "./types";

function safeJSON(raw: string): Status {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Status : {};
  } catch { return {}; }
}

/** Read once, then on host invalidations or action completion. */
export function useExtension(config: AppConfig) {
  const state = shallowRef<Status>({});
  const busy = shallowRef(false);
  const message = shallowRef<MessageKey | "">("");
  let lastResponse = "";
  let lastGeneration: string | undefined;
  let awaitingAction = false;
  let refreshAfterAction = false;

  function action(index: number) {
    const item = config.actions[index];
    if (!item || busy.value || config.actionEnabled?.(state.value, item) === false) return;
    const error = config.validateAction?.(state.value, item);
    if (error) { message.value = error; return; }
    busy.value = true;
    awaitingAction = true;
    message.value = "";
    invoke(config.extension, item.method, item.request || {});
  }

  onFrame(() => {
    const raw = device()?.get?.("appResponse") || "";
    if (raw && raw !== lastResponse) {
      lastResponse = raw;
      const response = safeJSON(raw);
      busy.value = response.busy === true;
      if (response.ok === false) message.value = "failed";
      const payload = response.response;
      if (!awaitingAction && payload && typeof payload === "object" && !Array.isArray(payload)) {
        state.value = payload as Status;
      }
      if (!busy.value && awaitingAction) {
        awaitingAction = false;
        refreshAfterAction = true;
      }
    }
    const generation = device()?.get?.("appStateGeneration") || "0";
    if (!busy.value && (lastGeneration !== generation || refreshAfterAction)) {
      lastGeneration = generation;
      refreshAfterAction = false;
      busy.value = true;
      invoke(config.extension, config.statusMethod);
    }
  });

  return { state, busy, message, action };
}
