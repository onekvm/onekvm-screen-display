import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { BackButton } from "../../../packages/screen-ui/src";
import { COLOR, FONT } from "./ui";

export function AppBar(props: { time: string; showBack: boolean; onBack: () => void }) {
  return (
    <View class="relative w-full flex flex-row items-center justify-end px-5" style={{ height: 22 }}>
      {props.showBack ? <BackButton height={22} selected={false} onBack={props.onBack} /> : null}
      <Text class="text-sm text-zinc-400" style={{ fontSlot: FONT.sm, textColor: COLOR.zinc400 }}>
        {props.time}
      </Text>
    </View>
  );
}
