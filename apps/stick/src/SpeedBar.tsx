import { useI18n } from "../../shared/i18n";
import { shallowRef } from "vue";
import { Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, screenSize, setHot } from "./device";
import { stickLayout } from "./layout";
import { COLOR, FONT } from "./ui";

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function clampPct(n: number): number {
  return Math.max(10, Math.min(100, Math.round(n)));
}

function readSpeed(): number {
  const n = Number(device()?.get?.("stickSpeed") || "40");
  if (!Number.isFinite(n)) return 40;
  return clampPct(n);
}

export function SpeedBar() {
  const t = useI18n();
  let fill: NodeMirror | null = null;
  let row: NodeMirror | null = null;
  const speed = shallowRef(readSpeed());
  const { speed: rect, speedHit } = stickLayout(screenSize());

  const paint = (pct: number) => {
    speed.value = pct;
    if (fill) jump(fill, "width", (rect.w * pct) / 100);
  };

  const apply = (x: number) => {
    const pct = clampPct(((x - rect.x) / rect.w) * 100);
    if (pct === speed.value) return;
    paint(pct);
    device()?.set?.("stickSpeed", String(pct));
  };

  const bindFill = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (fill && node == null) fill = null;
      return;
    }
    fill = node;
    paint(speed.value);
  };

  const bindRow = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (row && node == null) row = null;
      return;
    }
    row = node;
  };

  onFrame(() => {
    const next = readSpeed();
    if (next !== speed.value) paint(next);
  });

  createGesture({
    axis: "x",
    region: {
      node: () => row,
      rect: () => speedHit,
    },
    onDown(c) {
      setHot(true);
      apply(c.x);
    },
    onMove(c) {
      apply(c.x);
    },
    onPanMove(c) {
      apply(c.x);
    },
    onPanEnd() {
      setHot(false);
    },
    onUp() {
      setHot(false);
    },
    onCancel() {
      setHot(false);
    },
  });

  return (
    <View
      class="absolute"
      style={{ width: speedHit.w, height: speedHit.h, insetL: speedHit.x, insetT: speedHit.y }}
      focusable
      nodeRef={bindRow}
    >
      <View
        class="absolute rounded-xl bg-zinc-800"
        style={{ width: rect.w, height: rect.h, insetL: rect.x - speedHit.x, insetT: rect.y - speedHit.y, radius: 11 }}
      >
        <View
          class="absolute left-0 top-0 rounded-xl bg-zinc-600"
          style={{ width: (rect.w * speed.value) / 100, height: rect.h, radius: 11 }}
          nodeRef={bindFill}
        />
        <View
          class="absolute flex flex-row items-center justify-between px-3"
          style={{ width: rect.w, height: rect.h, insetL: 0, insetT: 0 }}
        >
          <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
            {t("speed")}
          </Text>
          <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
            {`${speed.value}`}
          </Text>
        </View>
      </View>
    </View>
  );
}
