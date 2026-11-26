import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { ActionBar } from "../../../packages/screen-ui/src/components/ActionBar";
import { COLOR, FONT } from "../../../packages/screen-ui/src/theme";
import { sizeLabel, type Media } from "./model";

export function MediaDetail(props: { width: number; height: number; media: Media; mounted: boolean; connected: boolean; busy: boolean; selected: number; message: string;
  t(key: string): string; onAction(index: number): void }) {
  return <>
    <View class="flex flex-col items-center justify-center gap-1" style={{ width: props.width - 24, height: props.height - 116 }}>
      <Text class="text-sm" style={{ width: props.width - 24, fontSlot: FONT.sm, textColor: COLOR.white, textAlign: 1 }}>{props.media.name.length > 40 ? props.media.name.slice(0, 39) + "…" : props.media.name}</Text>
      <Text class="text-xs" style={{ fontSlot: FONT.xs, textColor: props.mounted ? COLOR.success : COLOR.muted }}>{props.t(props.media.kind)} · {props.mounted ? props.t("mounted") : sizeLabel(props.media.size)}</Text>
    </View>
    <ActionBar width={props.width} selected={props.selected} onAction={props.onAction} actions={[
      { id: "mount", label: props.t(props.mounted ? "eject" : props.connected ? "mount" : "connectAndMount"), disabled: props.busy },
      { id: "cancel", label: props.t("cancel") },
    ]} />
    <Text class="text-xs" style={{ height: 22, fontSlot: FONT.xs, textColor: COLOR.warning }}>{props.message}</Text>
  </>;
}
