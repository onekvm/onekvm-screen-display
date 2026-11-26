import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { ActionBar } from "../../../packages/screen-ui/src/components/ActionBar";
import { COLOR, FONT } from "../../../packages/screen-ui/src/theme";

export function TextEntry(props: { width: number; height: number; value: string; busy: boolean; selected: number; message: string; t(key: string): string; onAction(index: number): void }) {
  return <>
    <View class="flex flex-col items-center justify-center gap-1" style={{ width: props.width - 24, height: props.height - 116 }}>
      <Text class="text-sm" style={{ width: props.width - 24, fontSlot: FONT.sm, textColor: COLOR.white, textAlign: 1 }}>{props.value.length > 42 ? "…" + props.value.slice(-41) : props.value || props.t("empty")}</Text>
      {props.height >= 220 ? <Text class="text-xs" style={{ width: props.width - 24, fontSlot: FONT.xs, textColor: COLOR.muted, textAlign: 1 }}>{props.t("textHint")}</Text> : null}
    </View>
    <ActionBar width={props.width} selected={props.selected} onAction={props.onAction} actions={[
      { id: "edit", label: props.t("edit"), disabled: props.busy },
      { id: "send", label: props.t("send"), disabled: props.busy || !props.value },
      { id: "clear", label: props.t("clear"), disabled: props.busy || !props.value },
    ]} />
    <Text class="text-xs" style={{ height: 22, fontSlot: FONT.xs, textColor: COLOR.warning }}>{props.message}</Text>
  </>;
}
