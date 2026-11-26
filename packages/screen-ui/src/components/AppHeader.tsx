import { View } from "@pocketjs/framework/vue-vapor/components";
import { BackButton } from "./BackButton";
import { AppTitle } from "./AppTitle";

/** Match the HDMI loopback header: icon Back at the top left. */
export function AppHeader(props: { width: number; title: string; icon?: string; selected: boolean; onBack(): void }) {
  return <View class="relative" style={{ width: props.width, height: 40 }}>
    <BackButton height={40} selected={props.selected} onBack={props.onBack} />
    <View class="absolute" style={{ insetL: 56, insetT: 0, width: props.width - 56, height: 40 }}>
      <AppTitle title={props.title} icon={props.icon} />
    </View>
  </View>;
}
