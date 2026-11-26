import { Image, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { COLOR } from "../theme";

/** Shared HDMI-style Back control. A drag cancels the tap; rotary focus is external. */
export function BackButton(props: { height: number; selected: boolean; onBack(): void }) {
  let node: NodeMirror | null = null;
  createGesture({
    region: { node: () => node, rect: () => ({ x: 8, y: 0, w: 44, h: props.height }) },
    onTap() { props.onBack(); },
  });
  return <View class="absolute left-2 top-0 flex items-center justify-center rounded-md active:bg-zinc-700"
    style={{ width: 44, height: props.height, bgColor: props.selected ? COLOR.primary : 0x00000000 }}
    nodeRef={(value: NodeMirror | null) => { node = value; }}>
    <Image class="w-5 h-5" src="screen-ui/back.png" />
  </View>;
}
