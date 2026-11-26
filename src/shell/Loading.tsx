import { Image, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { COLOR } from "./ui";

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

/** watchOS-style launch plate: app icon with a spinner around it. */
export function Loading(props: { icon: string }) {
  let ring: NodeMirror | null = null;
  let angle = 0;

  const bindRing = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (ring && node == null) ring = null;
      return;
    }
    ring = node;
  };

  onFrame(() => {
    if (!ring) return;
    angle = (angle + 10) % 360;
    jump(ring, "arcStart", angle);
  });

  return (
    <View class="w-full h-full flex items-center justify-center bg-black">
      <View class="relative w-[96] h-[96]">
        <View
          class="absolute w-[96] h-[96]"
          nodeRef={bindRing}
          style={{ bgColor: COLOR.zinc100, arcSweep: 270, arcWidth: 4 }}
        />
        <View class="absolute inset-0 flex items-center justify-center">
          <View class="flex w-[64] h-[64] rounded-full bg-blue-500 items-center justify-center">
            <Image class="w-8 h-8" src={props.icon} />
          </View>
        </View>
      </View>
    </View>
  );
}
