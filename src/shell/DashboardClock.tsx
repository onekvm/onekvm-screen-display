import { computed } from "vue";
import { Text } from "@pocketjs/framework/vue-vapor/components";
import { clockFont, dashboardClockLayout, type ClockParts } from "./clock";
import type { HomeLayout } from "./homeLayout";
import { screenSize } from "./device";
import { COLOR } from "./ui";
import { DASHBOARD_CLOCK } from "../shared/dashboard";

// The host rasterizes the clock's font at 16 px x scale, so every size is
// drawn 1:1 instead of scaling a bitmap.
export function DashboardClock(props: { clock: ClockParts; home: HomeLayout }) {
  const scr = screenSize();
  const font = computed(() => clockFont(DASHBOARD_CLOCK.fontSize * props.home.clock.scale));
  const layout = computed(() => dashboardClockLayout(
    scr.w * props.home.clock.x / 100, scr.h * props.home.clock.y / 100, props.home.clock.scale, font.value,
  ));
  return <>
    <Text class="absolute" style={{ ...layout.value.time, fontSlot: font.value.slot, textColor: COLOR.white }}>{props.clock.hh}:{props.clock.mm}</Text>
    {props.clock.period && <Text class="absolute" style={{ ...layout.value.period, fontSlot: font.value.slot, textColor: COLOR.white, textAlign: 1 }}>{props.clock.period}</Text>}
  </>;
}
