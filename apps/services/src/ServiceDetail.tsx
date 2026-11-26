import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { ActionBar, type ActionItem } from "../../../packages/screen-ui/src/components/ActionBar";
import { COLOR, FONT } from "../../../packages/screen-ui/src/theme";
import { type Service } from "./model";
import { type Message, useStrings } from "./i18n";

interface Props {
  width: number; height: number; service?: Service; name: string; busy: boolean; stale: boolean;
  message: Message; selected: number; actions: ActionItem[]; t: ReturnType<typeof useStrings>;
  onAction(index: number): void;
}

/** Status and actions reflect the last confirmed catalog, never optimistic state. */
export function ServiceDetail(props: Props) {
  return <>
      <View class="flex flex-col items-center justify-center gap-1" style={{ width: props.width - 24, height: props.height - 116 }}>
        <Text class="text-base" style={{ width: props.width - 24, fontSlot: FONT.base, textColor: COLOR.white, textAlign: 1 }}>{props.service ? props.name : props.t("missing")}</Text>
        <Text class="text-sm" style={{ fontSlot: FONT.sm, textColor: props.service?.running ? COLOR.success : COLOR.muted }}>{props.busy ? props.t("busy") : props.t(props.service?.running ? "running" : "stopped")}</Text>
        {props.height >= 220 ? <Text class="text-xs" style={{ fontSlot: FONT.xs, textColor: COLOR.muted }}>{props.service ? props.t(props.service.enabled ? "bootOn" : "bootOff") : ""}</Text> : null}
      </View>
      <ActionBar width={props.width} actions={props.actions} selected={props.selected} onAction={props.onAction} />
      <View class="flex items-center justify-center" style={{ width: props.width - 16, height: 22 }}>
        <Text class="text-xs" style={{ fontSlot: FONT.xs, textColor: props.stale ? COLOR.warning : COLOR.muted }}>{props.message ? props.t(props.message) : props.service?.actions.length === 0 ? props.t("readOnly") : ""}</Text>
      </View>

  </>;
}
