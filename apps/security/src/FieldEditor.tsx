import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { ActionBar } from "../../../packages/screen-ui/src/components/ActionBar";
import { COLOR, FONT } from "../../../packages/screen-ui/src/theme";
import type { Field } from "./model";

/** Draft preview and explicit save; touches never change a live setting directly. */
export function FieldEditor(props: { width: number; height: number; field: Field; value: string; hint: string; selected: number;
  disabled: boolean; dirty: boolean; t(key: string): string; format(value: string): string; onAction(index: number): void }) {
  return <>
    <View class="flex flex-col items-center justify-center" style={{ width: props.width - 24, height: props.height - 116 }}>
      <Text class="text-base" style={{ width: props.width - 24, fontSlot: FONT.base, textColor: COLOR.white, textAlign: 1 }}>{props.format(props.value) || props.t("empty")}</Text>
      {props.hint ? <Text class="text-xs" style={{ width: props.width - 24, fontSlot: FONT.xs, textColor: COLOR.muted, textAlign: 1 }}>{props.hint}</Text> : null}
    </View>
    <ActionBar width={props.width} selected={props.selected} onAction={props.onAction} actions={[
      { id: "edit", label: props.t(props.field.kind === "boolean" || props.field.kind === "choice" ? "change" : "edit"), disabled: props.disabled },
      { id: "save", label: props.t("save"), disabled: props.disabled || !props.dirty },
    ]} />
  </>;
}
