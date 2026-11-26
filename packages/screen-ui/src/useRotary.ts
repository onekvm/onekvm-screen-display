import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, setHot } from "./device";

interface Options {
  onTurn?(step: number): void;
  onConfirm?(): void;
  onBack?(): void;
  onInput?(): void;
}

/** Decode each host event once; ignore the event left over when an App opens. */
export function useRotary(options: Options = {}) {
  let sequence = device()?.get?.("knobSeq") || "0";
  onFrame(() => {
    const next = device()?.get?.("knobSeq") || "0";
    if (next === sequence) return;
    sequence = next;
    setHot(true);
    options.onInput?.();
    // A hold takes precedence even if the bridge also reports a click.
    if (device()?.get?.("knobHold") === "1") {
      if (options.onBack) options.onBack();
      else device()?.set?.("launch", "shell");
      return;
    }
    const step = Number(device()?.get?.("knob") || "0");
    if (Number.isFinite(step) && Math.trunc(step)) options.onTurn?.(Math.trunc(step));
    if (device()?.get?.("knobClick") === "1") options.onConfirm?.();
  });
}
