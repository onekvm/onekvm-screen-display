import { computed } from "vue";
import { Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import type { ClockParts } from "./clock";
import type { HomeLayout } from "./homeLayout";
import { screenSize } from "./device";
import { FlipClock } from "./FlipClock";
import { ClockPeriod } from "./ClockPeriod";
import { COLOR, FONT } from "./ui";

const digitImages = [
  "clock-0.png", "clock-1.png", "clock-2.png", "clock-3.png", "clock-4.png",
  "clock-5.png", "clock-6.png", "clock-7.png", "clock-8.png", "clock-9.png",
  "clock-colon.png",
];

function digitIndex(char: string): number {
  return char === ":" ? 10 : Math.max(0, Math.min(9, Number(char) || 0));
}

export function ClockWidget(props: { clock: ClockParts; home: HomeLayout }) {
  const scr = screenSize();
  const scale = computed(() => props.home.clock.scale * (props.home.face.id === "screen-display/digital" ? 1.15 : 1));
  const centerX = computed(() => scr.w * props.home.clock.x / 100);
  const centerY = computed(() => scr.h * props.home.clock.y / 100);
  const dialSize = computed(() => Math.min(scr.w, scr.h) * scale.value);
  const pipSize = computed(() => Math.max(2, 6 * scale.value));
  const pipRadius = computed(() => dialSize.value / 2 - 4 * scale.value);
  const time = computed(() => `${props.clock.hh}:${props.clock.mm}`);
  const digitOffsets = [0, 34, 68, 87, 121];
  const digits = digitOffsets.map((offset, index) => {
    return <Image
      class="absolute"
      src={digitImages[digitIndex(time.value[index])]}
      style={{
        width: 64 * scale.value, height: 64 * scale.value,
        insetL: Math.round(centerX.value + (offset - 155 / 2 - (index === 2 ? 22 : 15)) * scale.value),
        insetT: Math.round(centerY.value - 20 * scale.value),
      }}
    />;
  });
  return <>
    {props.home.face.dial === "ticks" && <Image
      class="absolute"
      src="ticks.png"
      style={{ width: dialSize.value, height: dialSize.value, insetL: Math.round(centerX.value - dialSize.value / 2), insetT: Math.round(centerY.value - dialSize.value / 2) }}
    />}
    {props.home.face.dial === "ticks" && <View class="absolute" style={{
      width: pipSize.value, height: pipSize.value, radius: pipSize.value / 2, bgColor: COLOR.amber400,
      insetL: Math.round(centerX.value + pipRadius.value * Math.sin(props.clock.ss * Math.PI / 30) - pipSize.value / 2),
      insetT: Math.round(centerY.value - pipRadius.value * Math.cos(props.clock.ss * Math.PI / 30) - pipSize.value / 2),
    }} />}
    <View class="absolute flex items-center justify-center" style={{
      width: Math.min(scr.w, Math.max(100, dialSize.value)), height: 18,
      insetL: Math.round(centerX.value - Math.min(scr.w, Math.max(100, dialSize.value)) / 2),
      insetT: Math.round(centerY.value - (props.home.face.id === "screen-display/flip" ? 56 : 38) * scale.value),
    }}>
      <Text class="text-xs text-amber-400 font-bold tracking-wide" style={{ fontSlot: FONT.xsBold, textColor: COLOR.amber400, tracking: 0.3 }}>
        {props.clock.date}
      </Text>
    </View>
    {props.home.face.id === "screen-display/flip" ? <FlipClock clock={props.clock} home={props.home} /> : digits}
    <ClockPeriod period={props.clock.period} x={centerX.value - (props.home.face.id === "screen-display/flip" ? 114 : 91) * scale.value} y={centerY.value + (props.home.face.id === "screen-display/flip" ? 3 : 8) * scale.value} scale={scale.value * 0.75} />
  </>;
}
