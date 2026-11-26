import { Image, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { touches } from "@pocketjs/framework/vue-vapor/input";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, screenSize, setHot } from "./device";

const SIZE = 56;
const MIN = 8;
const IDLE_MS = 5000;

function frame() {
  const scr = screenSize();
  return {
    maxX: Math.max(MIN, scr.w - SIZE - 8),
    maxY: Math.max(MIN, scr.h - SIZE - 8),
  };
}

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function readZoom(): number {
  const n = Number(device()?.get?.("zoom") || "1");
  if (n >= 4) return 4;
  if (n >= 2) return 2;
  return 1;
}

function readPan(key: "panX" | "panY"): number {
  const n = Number(device()?.get?.(key) || "500");
  if (!Number.isFinite(n)) return 500;
  return clamp(Math.round(n), 0, 1000);
}

export function cycleZoom() {
  const z = readZoom();
  const next = z >= 4 ? 1 : z >= 2 ? 4 : 2;
  device()?.set?.("zoom", String(next));
}

export function stepZoom(delta: number) {
  const levels = [1, 2, 4];
  const index = levels.indexOf(readZoom());
  const next = levels[clamp(index + delta, 0, levels.length - 1)];
  device()?.set?.("zoom", String(next));
}

export function Magnifier() {
  const box = frame();
  let glass: NodeMirror | null = null;
  // The button's full travel represents the full native crop range (0–1000).
  // Keep its position consistent with the crop, including when reopening.
  let gx = MIN + (readPan("panX") / 1000) * (box.maxX - MIN);
  let gy = MIN + (readPan("panY") / 1000) * (box.maxY - MIN);
  let originX = gx;
  let originY = gy;
  let visible = true;
  let hideAt = Date.now() + IDLE_MS;
  let wasTouching = false;
  let knobSeq = device()?.get?.("knobSeq") || "0";

  const place = (x: number, y: number) => {
    gx = clamp(x, MIN, box.maxX);
    gy = clamp(y, MIN, box.maxY);
    if (glass) {
      jump(glass, "insetL", gx);
      jump(glass, "insetT", gy);
    }
  };

  const bind = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (glass && node == null) glass = null;
      return;
    }
    glass = node;
    place(gx, gy);
    jump(glass, "opacity", visible ? 1 : 0);
    device()?.set?.("frameAfter", String(Math.max(1, hideAt - Date.now())));
  };

  onFrame(() => {
    const touching = touches().length > 0;
    const nextKnob = device()?.get?.("knobSeq") || "0";
    const now = Date.now();
    if (touching || wasTouching || nextKnob !== knobSeq) hideAt = now + IDLE_MS;
    wasTouching = touching;
    knobSeq = nextKnob;
    const next = now < hideAt;
    // One pending redraw also expires the control if video stops delivering
    // frames. Re-arm from the absolute deadline when a parked App resumes.
    if (next) device()?.set?.("frameAfter", String(Math.max(1, hideAt - now)));
    if (next === visible) return;
    visible = next;
    // Apply in this frame; do not keep the host hot for the countdown.
    if (glass) jump(glass, "opacity", visible ? 1 : 0);
  });

  createGesture({
    axis: "any",
    region: {
      // The first touch after hiding only reveals the control, even if it
      // lands on its old position. Invisible controls must not change zoom.
      node: () => visible ? glass : null,
      rect: () => visible ? { x: gx, y: gy, w: SIZE, h: SIZE } : null,
    },
    onTap() {
      cycleZoom();
    },
    onPanStart() {
      originX = gx;
      originY = gy;
      setHot(true);
    },
    onPanMove(c) {
      place(originX + c.dx, originY + c.dy);
      device()?.set?.("panX", String(Math.round((gx - MIN) * 1000 / Math.max(1, box.maxX - MIN))));
      device()?.set?.("panY", String(Math.round((gy - MIN) * 1000 / Math.max(1, box.maxY - MIN))));
    },
    onPanEnd() {
      setHot(false);
    },
    onCancel() {
      setHot(false);
    },
  });

  return (
    <View
      class="absolute flex w-[56] h-[56] rounded-full bg-zinc-800 items-center justify-center"
      style={{ width: SIZE, height: SIZE, insetL: gx, insetT: gy }}
      nodeRef={bind}
    >
      <Image class="w-6 h-6" src="zoom.png" />
    </View>
  );
}
