import { View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { animate, jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, pulseClick, screenSize, setAxis, setHot } from "./device";
import { stickLayout } from "./layout";

const WELL = 120;
const KNOB = 52;
const REST = (WELL - KNOB) / 2;
const MAX = REST;

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function clampMag(dx: number, dy: number): { dx: number; dy: number } {
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag <= MAX || mag < 0.001) return { dx, dy };
  return { dx: (dx / mag) * MAX, dy: (dy / mag) * MAX };
}

function toAxis(dx: number, dy: number): { x: number; y: number } {
  return {
    x: Math.round((dx / MAX) * 1000),
    y: Math.round((dy / MAX) * 1000),
  };
}

export function Joystick() {
  const rect = stickLayout(screenSize()).joystick;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let knob: NodeMirror | null = null;
  let well: NodeMirror | null = null;

  const place = (dx: number, dy: number, spring: boolean) => {
    if (!knob) return;
    if (spring) {
      animate(knob, "translateX", dx, { dur: 140, easing: "out" });
      animate(knob, "translateY", dy, { dur: 140, easing: "out" });
      return;
    }
    jump(knob, "translateX", dx);
    jump(knob, "translateY", dy);
  };

  const pull = (x: number, y: number) => {
    const next = clampMag(x - cx, y - cy);
    place(next.dx, next.dy, false);
    const axis = toAxis(next.dx, next.dy);
    setAxis(axis.x, axis.y);
  };

  const rest = () => {
    place(0, 0, true);
    setAxis(0, 0);
    setHot(false);
  };

  const bindKnob = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (knob && node == null) knob = null;
      return;
    }
    knob = node;
    place(0, 0, false);
  };

  const bindWell = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (well && node == null) well = null;
      return;
    }
    well = node;
  };

  let dragging = false;

  createGesture({
    axis: "any",
    panSlop: 1,
    region: {
      node: () => well,
      rect: () => rect,
    },
    onDown(c) {
      dragging = true;
      setHot(true);
      pull(c.x, c.y);
    },
    onMove(c) {
      pull(c.x, c.y);
    },
    onUp() {
      dragging = false;
      rest();
    },
    onTap() {
      pulseClick(1);
    },
    onCancel() {
      dragging = false;
      rest();
    },
  });

  onFrame(() => {
    if (dragging) return;
    const x = Number(device()?.get?.("stickX") || "0");
    const y = Number(device()?.get?.("stickY") || "0");
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    place((x / 1000) * MAX, (y / 1000) * MAX, false);
  });

  return (
    <View
      class="absolute w-[120] h-[120] rounded-full bg-zinc-800"
      style={{ width: rect.w, height: rect.h, insetL: rect.x, insetT: rect.y }}
      nodeRef={bindWell}
    >
      <View
        class="absolute w-[52] h-[52] rounded-full bg-zinc-500"
        style={{ width: KNOB, height: KNOB, insetL: REST, insetT: REST }}
        nodeRef={bindKnob}
      />
    </View>
  );
}
