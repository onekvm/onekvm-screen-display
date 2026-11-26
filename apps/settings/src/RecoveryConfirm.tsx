import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { t, type Lang } from "./i18n";
import { screenSize } from "./device";
import { COLOR, FONT } from "./ui";
import type { RecoveryControls } from "./useRecoveryConfirmation";

export function RecoveryConfirm(props: { controls: RecoveryControls; lang: Lang; rotary: boolean }) {
  const c = props.controls;
  return (
    <View class="relative w-full shrink-0 px-5 pt-1 pb-4 flex flex-col" style={{ height: Math.max(80, screenSize().h - 22) }}>
      <Text class="text-base text-white" style={{ height: 24, fontSlot: FONT.base, textColor: COLOR.white }}>
        {t(c.action.value === "factory-reset" ? "factoryReset" : c.action.value === "recovery" ? "recoveryMode" : "rebootDevice", {}, props.lang)}
      </Text>
      <Text class="text-xs" style={{ height: 38, fontSlot: FONT.xs, textColor: COLOR.zinc100 }}>
        {t(c.action.value === "factory-reset" ? "factoryResetWarning" : c.action.value === "recovery" ? "recoveryWarning" : "rebootWarning", {}, props.lang)}
      </Text>
      <View class="flex-1" />
      <Text class="text-sm" style={{ height: 22, fontSlot: FONT.sm, textColor: COLOR.zinc100 }}>
        {t(c.status.value.startsWith("error:") ? "recoveryFailed" : c.status.value ? "recoveryWorking" : c.remaining.value ? "recoveryWait" : "recoveryHold", { n: c.remaining.value }, props.lang)}
      </Text>
      <View class="w-full flex flex-row gap-2" style={{ height: 44 }}>
        <View
          class={props.rotary && c.focus.value === 0 ? "rounded-xl bg-blue-500 flex items-center justify-center" : "rounded-xl bg-zinc-800 flex items-center justify-center active:bg-blue-500"}
          style={{ width: 80, height: 44 }} focusable onPress={() => c.dismiss()}
        >
          <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>{t("cancel", {}, props.lang)}</Text>
        </View>
        <View
          nodeRef={c.bindHold}
          class="relative rounded-xl overflow-hidden flex items-center justify-center"
          style={{ width: Math.max(40, screenSize().w - 128), height: 44, bgColor: c.remaining.value || c.status.value ? COLOR.zinc800 : COLOR.danger }}
        >
          <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
            {t(c.remaining.value ? "recoveryLocked" : "holdConfirm", {}, props.lang)}
          </Text>
          <View class="absolute" style={{ insetL: 0, insetB: 0, height: props.rotary && c.focus.value === 1 ? 4 : 2, width: Math.max(40, screenSize().w - 128) * c.progress.value, bgColor: COLOR.white }} />
          {props.rotary && c.focus.value === 1 ? <View class="absolute bg-blue-500" style={{ insetL: 0, insetT: 0, height: 3, width: Math.max(40, screenSize().w - 128) }} /> : null}
        </View>
      </View>
    </View>
  );
}
