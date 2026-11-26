import { computed } from "vue";
import { Text } from "@pocketjs/framework/vue-vapor/components";
import { centeredLabel, clockFont } from "./clock";
import { COLOR } from "./ui";

/** AM/PM drawn at `px`, its capitals centered on (x, y). */
export function ClockPeriod(props: { period: string; x: number; y: number; px: number }) {
  const font = computed(() => clockFont(props.px));
  return <>{props.period && <Text class="absolute"
    style={{ ...centeredLabel(props.x, props.y, props.px, font.value), fontSlot: font.value.slot, textColor: COLOR.white, textAlign: 1 }}
  >{props.period}</Text>}</>;
}
