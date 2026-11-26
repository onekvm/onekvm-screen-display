import { shallowRef } from "vue";
import { Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { Magnifier, stepZoom } from "./Magnifier";
import { device, hasControl, screenSize } from "./device";
import { COLOR, FONT } from "./ui";
import { useI18n } from "../../shared/i18n";
import { useRotary } from "../../../packages/screen-ui/src/useRotary";

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

export default function Stream() {
  const t = useI18n();
  let lost: NodeMirror | null = null;
  let shown = true;
  const touch = hasControl("touch");
  const zoom = shallowRef(device()?.get?.("zoom") || "1");
  const screen = screenSize();
  const hintVisible = shallowRef(true);
  let hintUntil = Date.now() + 2500;
  useRotary({
    onInput: () => { hintUntil = Date.now() + 1800; },
    onTurn: stepZoom,
    onConfirm: () => device()?.set?.("zoom", "1"),
  });
  const hintW = Math.min(208, screen.w - 16);

  const bindLost = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (lost && node == null) lost = null;
      return;
    }
    lost = node;
    jump(node, "opacity", 1);
  };

  onFrame(() => {
    const nextHint = Date.now() < hintUntil;
    if (hintVisible.value !== nextHint) hintVisible.value = nextHint;
    const ready = device()?.get?.("stream") === "1";
    const nextZoom = device()?.get?.("zoom") || "1";
    if (nextZoom !== zoom.value) zoom.value = nextZoom;
    const next = !ready;
    if (next === shown || !lost) return;
    shown = next;
    jump(lost, "opacity", shown ? 1 : 0);
  });

  return (
    <View class="relative w-full h-full overflow-hidden">
      <View
        class="absolute flex items-center justify-center px-3 rounded-xl bg-zinc-800"
        style={{ width: 96, height: 28, insetL: Math.round((screen.w - 96) / 2), insetT: 16 }}
        nodeRef={bindLost}
      >
        <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
          {t("noSignal")}
        </Text>
      </View>
      {touch ? <Magnifier /> : hintVisible.value ? (
        <View
          class="absolute flex flex-col items-center justify-center rounded-xl bg-zinc-800"
          style={{ width: hintW, height: 42, insetL: Math.round((screen.w - hintW) / 2), insetT: screen.h - 50 }}
        >
          <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
            {t("turnZoom", { zoom: zoom.value })}
          </Text>
          <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
            {t("pressReset")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
