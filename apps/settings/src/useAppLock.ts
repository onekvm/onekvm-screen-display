import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, requestPageTransition, setHot } from "./device";
import { moveFocus } from "../../../src/shell/keypad";
import { pinKeypad } from "./pinKeypad";
import { screenSize } from "./device";

type LockState = { enabled: boolean; timeout: number; pending: string; result: string; wait: number; busy: boolean };
type Step = "" | "unlock" | "current" | "new" | "repeat";
const read = (): LockState => {
  try { return { enabled: false, timeout: 60, pending: "", result: "", wait: 0, busy: false, ...JSON.parse(device()?.get?.("appLockState") || "{}") }; }
  catch { return { enabled: false, timeout: 60, pending: "", result: "", wait: 0, busy: false }; }
};

export function useAppLock() {
  const initial = read();
  const enabled = shallowRef(initial.enabled);
  const timeout = shallowRef(initial.timeout);
  const step = shallowRef<Step>(initial.pending ? "unlock" : "");
  const value = shallowRef("");
  const focus = shallowRef(0);
  const error = shallowRef("");
  const wait = shallowRef(0);
  const busy = shallowRef(false);
  let current = "", next = "", disabling = false, waiting = false;

  const clear = () => { value.value = ""; current = ""; next = ""; error.value = ""; focus.value = 0; };
  const cancel = () => {
    if (busy.value) return;
    clear();
    if (step.value === "unlock") device()?.set?.("launch", "shell");
    else { step.value = ""; requestPageTransition(-1); }
    setHot(true);
  };
  const submit = (key: string, payload: string) => {
    busy.value = true; waiting = true; value.value = "";
    device()?.set?.(key, payload);
    current = ""; next = "";
    setHot(true);
  };
  const token = (key: string) => {
    if (busy.value || wait.value > 0) { if (key === "X") cancel(); return; }
    error.value = "";
    if (key === "X") { cancel(); return; }
    if (key === "BS") { value.value = value.value.slice(0, -1); return; }
    if (/^\d$/.test(key)) { if (value.value.length < 8) value.value += key; return; }
    if (key !== "OK") return;
    if (!/^\d{4,8}$/.test(value.value)) { error.value = "length"; return; }
    if (step.value === "unlock") { submit("appUnlock", value.value); return; }
    if (step.value === "current") {
      current = value.value; value.value = "";
      if (disabling) submit("appLockConfigure", JSON.stringify({ operation: "disable", current }));
      else step.value = "new";
    } else if (step.value === "new") { next = value.value; value.value = ""; step.value = "repeat"; }
    else if (step.value === "repeat") {
      if (value.value !== next) { value.value = ""; error.value = "mismatch"; return; }
      submit("appLockConfigure", JSON.stringify({ operation: "set", current, pin: next }));
    }
    focus.value = 0;
  };
  onFrame(() => {
    const state = read();
    enabled.value = state.enabled;
    timeout.value = state.timeout;
    wait.value = state.wait;
    if (state.pending && step.value !== "unlock") { clear(); waiting = false; busy.value = state.busy; step.value = "unlock"; }
    if (waiting && !state.busy) {
      if (state.result === "ok") {
        waiting = false;
        const wasUnlock = step.value === "unlock";
        step.value = ""; busy.value = false; clear();
        // Settings can be parked after unlock and reused at the next list
        // entrance. Do not retain the previous unlock's busy keypad state.
        if (!wasUnlock) requestPageTransition(-1);
      } else if (state.result.startsWith("error:")) {
        waiting = false; busy.value = false; error.value = state.result.slice(6);
        if (step.value !== "unlock") step.value = enabled.value ? "current" : "new";
      }
    }
    if (step.value && (busy.value || wait.value)) setHot(true);
  });
  return {
    enabled, timeout, step, value, focus, error, wait, busy, token, cancel,
    open(disable = false) {
      clear(); disabling = disable; waiting = false; busy.value = false;
      step.value = enabled.value ? "current" : "new";
      requestPageTransition(1); setHot(true);
    },
    setTimeout(seconds: number) {
      device()?.set?.("appLockConfigure", JSON.stringify({ operation: "timeout", timeout: seconds }));
      setHot(true);
    },
    handleKnob(delta: number, click: boolean, hold: boolean) {
      if (hold) { cancel(); return; }
      const keys = pinKeypad(screenSize());
      if (delta) focus.value = moveFocus(focus.value, delta, keys.length);
      if (click && keys[focus.value]) token(keys[focus.value].token);
    },
  };
}
export type AppLockControls = ReturnType<typeof useAppLock>;
