import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { device, screenSize } from "./device";

export function HomePill() {
  const scr = screenSize();
  let pill: NodeMirror | null = null;
  const update = () => {
    // Apply in this host frame: an idle App may not produce another frame
    // to flush a queued reactive opacity change after the cue expires.
    if (pill) jump(pill, "opacity", device()?.get?.("homePill") === "1" ? 1 : 0);
  };
  const bind = (node: NodeMirror | null) => {
    pill = node && typeof node.id === "number" ? node : null;
    update();
  };
  onFrame(update);
  return (
    <View
      class="absolute w-10 h-1 rounded-full bg-zinc-500"
      style={{ width: 40, height: 4, insetL: Math.round((scr.w - 40) / 2), insetT: scr.h - 12 }}
      nodeRef={bind}
    />
  );
}
