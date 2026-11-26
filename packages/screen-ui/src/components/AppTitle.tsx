import { Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { COLOR, FONT } from "../theme";

/** Right-aligned identity; compact screens can retain their own header height. */
export function AppTitle(props: { title: string; icon?: string; height?: number }) {
  return <View class="w-full flex flex-row items-center justify-end gap-1 px-2" style={{ height: props.height ?? 40 }}>
    {props.icon ? <Image src={props.icon} style={{ width: 20, height: 20 }} /> : null}
    <Text class="text-base" style={{ fontSlot: FONT.base, textColor: COLOR.white }}>{props.title}</Text>
  </View>;
}
