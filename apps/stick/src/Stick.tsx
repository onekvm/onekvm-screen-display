import { shallowRef } from "vue";
import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { ClickBar } from "./ClickBar";
import { Joystick } from "./Joystick";
import { SpeedBar } from "./SpeedBar";
import { device, hasControl, screenSize } from "./device";
import { stickLayout } from "./layout";
import { COLOR, FONT } from "./ui";
import { useI18n } from "../../shared/i18n";
import { useRotary } from "../../../packages/screen-ui/src/useRotary";

export default function Stick() {
  const t = useI18n();
  const touch = hasControl("touch");
  const notice = stickLayout(screenSize()).notice;
  const shown = shallowRef(false);
  useRotary();

  onFrame(() => {
    shown.value = device()?.get?.("hid") === "0";
  });

  if (!touch) {
    return (
      <View class="relative w-full h-full bg-black flex flex-col items-center justify-center">
        <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
          {t("noTouch")}
        </Text>
        <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
          {t("webMouse")}
        </Text>
      </View>
    );
  }

  return (
    <View class="relative w-full h-full bg-black overflow-hidden">
      <Joystick />
      <SpeedBar />
      <ClickBar />
      {shown.value && (
        <View class="absolute flex items-center justify-center"
          style={{ width: notice.w, height: notice.h, insetL: notice.x, insetT: notice.y }}>
          <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
            {t("disconnected")}
          </Text>
        </View>
      )}
    </View>
  );
}
