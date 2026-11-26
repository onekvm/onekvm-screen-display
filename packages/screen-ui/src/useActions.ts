import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, setHot } from "./device";
import { useRotary } from "./useRotary";

interface Options {
  count(): number;
  initialSelection?: number;
  onAction(index: number): void;
  onBack?(): void;
  onHome?(): void;
  enabled?(index: number): boolean;
}

/** One input path for touch, rotary selection/confirmation, and hold to exit. */
export function useActions(options: Options) {
  const selected = shallowRef(options.initialSelection ?? 0);

  function press(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= options.count() || options.enabled?.(index) === false) return;
    selected.value = index;
    options.onAction(index);
    setHot(true);
  }

  onFrame(() => {
    const count = options.count();
    if (device()?.get?.("back") === "1") options.onBack?.();
    if (selected.value >= count) selected.value = Math.max(0, count - 1);
  });
  useRotary({
    onTurn(step) {
      const count = options.count();
      if (selected.value < 0) selected.value = step > 0 ? count - 2 : count - 1;
      if (count) for (let turn = 0; turn < Math.abs(step); turn++) {
        for (let n = 0; n < count; n++) {
          selected.value = (selected.value + Math.sign(step) + count) % count;
          if (options.enabled?.(selected.value) !== false) break;
        }
      }
    },
    onConfirm: () => press(selected.value < 0 ? options.count() - 1 : selected.value),
    onBack: options.onHome || options.onBack,
  });

  return { selected, press };
}
