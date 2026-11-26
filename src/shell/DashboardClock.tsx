import { computed } from "vue";
import { Image } from "@pocketjs/framework/vue-vapor/components";
import type { ClockParts } from "./clock";
import type { HomeLayout } from "./homeLayout";
import { screenSize } from "./device";
import { ClockPeriod } from "./ClockPeriod";
import { DASHBOARD_CLOCK } from "../shared/dashboard";

const images = [
  "dashboard-clock-0.png", "dashboard-clock-1.png", "dashboard-clock-2.png",
  "dashboard-clock-3.png", "dashboard-clock-4.png", "dashboard-clock-5.png",
  "dashboard-clock-6.png", "dashboard-clock-7.png", "dashboard-clock-8.png",
  "dashboard-clock-9.png", "dashboard-clock-colon.png",
];

// Bitmap text transforms move glyphs without resizing them. Images resize both.
export function DashboardClock(props: { clock: ClockParts; home: HomeLayout }) {
  const scr = screenSize();
  const time = computed(() => `${props.clock.hh}:${props.clock.mm}`);
  return <>{[0, 9, 18, 22, 31].map((offset, index) => <Image class="absolute"
    src={images[index === 2 ? 10 : Number(time.value[index])]}
    style={{
      width: 16 * props.home.clock.scale, height: 32 * props.home.clock.scale,
      insetL: scr.w * props.home.clock.x / 100 + (offset + DASHBOARD_CLOCK.width / 2 - 40.5) * props.home.clock.scale,
      insetT: scr.h * props.home.clock.y / 100 - 16 * props.home.clock.scale,
    }}
  />)}<ClockPeriod period={props.clock.period} x={scr.w * props.home.clock.x / 100 + (DASHBOARD_CLOCK.width / 2 - 50.75 - DASHBOARD_CLOCK.periodGap) * props.home.clock.scale} y={scr.h * props.home.clock.y / 100} scale={props.home.clock.scale} /></>;
}
