import { shallowRef } from "vue";
import { device } from "./device";
import { useAdbDebug } from "../../../src/init/AdbDialog";
import type { DiagnosticsState } from "../../../src/init/DiagnosticsDialog";

/** Only explicit confirmation starts a job or enables ADB. No Core requests. */
export function useRecoveryDebug() {
  const available = device()?.get?.("localRecoveryAvailable") === "1";
  const diagnostics = shallowRef<DiagnosticsState | "">("");
  const error = shallowRef("");
  const focus = shallowRef(0);
  const adb = useAdbDebug();
  let pollAt = 0;
  const collecting = () => diagnostics.value === "queued" || diagnostics.value === "running";
  const active = () => !!diagnostics.value || adb.visible.value;
  const close = () => {
    if (collecting()) return;
    diagnostics.value = "";
    adb.close();
  };
  const start = () => {
    if (!available || collecting()) return;
    diagnostics.value = "queued";
    error.value = "";
    pollAt = Date.now() + 250;
    device()?.set?.("diagnosticsStart", "1");
  };
  return {
    available, diagnostics, error, focus, adb, active, close, start,
    busy: () => collecting() || (adb.visible.value && adb.busy()),
    openDiagnostics() {
      if (!available || active()) return;
      diagnostics.value = "confirm";
      error.value = "";
      focus.value = 0;
    },
    openAdb() { if (available && !active()) adb.open(); },
    sync() {
      adb.sync();
      if (!collecting() || Date.now() < pollAt) return;
      pollAt = Date.now() + 500;
      try {
        const status = JSON.parse(device()?.get?.("diagnosticsStatus") || "{}");
        if (["queued", "running", "done", "error"].includes(status.state)) {
          diagnostics.value = status.state;
          error.value = typeof status.error === "string" ? status.error : "";
          if (status.state === "done") focus.value = 0;
        }
      } catch { diagnostics.value = "error"; }
    },
    handleKnob(step: number, click: boolean, hold: boolean) {
      if (hold) { close(); return; }
      if (adb.visible.value) {
        if (adb.busy()) return;
        if (step) adb.focus.value = Math.max(0, Math.min(1, adb.focus.value + step));
        if (click) (adb.focus.value === 0 ? adb.secondary : adb.primary)();
      } else if (!collecting()) {
        if (step) focus.value = Math.max(0, Math.min(1, focus.value + step));
        if (click) {
          if (diagnostics.value === "done" || focus.value === 0) close();
          else start();
        }
      }
    },
  };
}

export type RecoveryDebugControls = ReturnType<typeof useRecoveryDebug>;
