import { shallowRef } from "vue";
import { Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { t, type Lang } from "./i18n";
import { SETTINGS_ASSETS } from "./assets";
import { COLOR, FONT } from "./ui";
import { device, screenSize } from "./device";
import { pinKeypad } from "./pinKeypad";
import type { AppLockControls } from "./useAppLock";

export function AppLockPanel(props: { controls: AppLockControls; lang: Lang }) {
  const c = props.controls;
  const pressed = shallowRef(-1);
  let down = -1;
  const caps = () => pinKeypad(screenSize());
  const hit = (x: number, y: number) => caps().findIndex(k => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h);
  createGesture({
    region: { rect: () => c.step.value ? { x: 0, y: 64, w: screenSize().w, h: Math.max(0, screenSize().h - 84) } : null },
    onDown(p) { down = hit(p.x, p.y); pressed.value = down; },
    onMove(p) { if (Math.abs(p.dx) > 8 || Math.abs(p.dy) > 8) { down = -1; pressed.value = -1; } },
    onUp() { pressed.value = -1; },
    onTap(p) {
      const index = hit(p.x, p.y);
      if (index >= 0 && index === down) c.token(caps()[index].token);
      pressed.value = -1;
    },
    onCancel() { down = -1; pressed.value = -1; },
  });
  return (
    <View class="absolute w-full h-full bg-black" style={{ insetL: 0, insetT: 0 }}>
      <Text class="absolute text-sm text-white" style={{ insetL: 12, insetT: 0, height: 22, fontSlot: FONT.sm, textColor: COLOR.white }}>
        {t(c.step.value === "unlock" ? "unlockApps" : c.step.value === "current" ? "currentPin" : c.step.value === "repeat" ? "repeatPin" : "newPin", {}, props.lang)}
      </Text>
      <Text class="absolute text-xs" style={{ insetL: 12, insetT: 22, height: 20, fontSlot: FONT.xs, textColor: COLOR.zinc100 }}>
        {t(c.busy.value ? "pinWorking" : c.wait.value ? "pinWait" : c.error.value === "mismatch" ? "pinMismatch" : c.error.value === "length" ? "pinLength" : c.error.value ? "pinError" : "pinLength", { n: c.wait.value }, props.lang)}
      </Text>
      <Text class="absolute text-base text-white" style={{ insetL: 12, insetT: 42, height: 20, fontSlot: FONT.base, textColor: COLOR.white }}>{"*".repeat(c.value.value.length)}</Text>
      {caps().map((key, index) => (
        <View class="absolute rounded flex items-center justify-center" style={{ insetL: key.x, insetT: key.y, width: key.w, height: key.h, radius: 4,
          bgColor: pressed.value === index || (device()?.get?.("knobOn") === "1" && c.focus.value === index) ? COLOR.primary : COLOR.zinc800 }}>
          {key.token === "BS" || key.token === "OK" ? <Image class="w-4 h-4" src={key.token === "BS" ? SETTINGS_ASSETS.backspace : SETTINGS_ASSETS.enter} />
            : <Text class="text-xs text-white" style={{ fontSlot: FONT.xs, textColor: COLOR.white }}>{key.token}</Text>}
        </View>
      ))}
    </View>
  );
}
