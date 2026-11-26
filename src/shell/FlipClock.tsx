import { ref, computed } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { Image, View } from "@pocketjs/framework/vue-vapor/components";
import type { ClockParts } from "./clock";
import type { HomeLayout } from "./homeLayout";
import { screenSize } from "./device";

export function FlipClock(props: { clock: ClockParts; home: HomeLayout }) {
  const scr = screenSize();
  const text = () => props.clock.hh + props.clock.mm;
  const previous = ref(text());
  const current = ref(text());
  const progress = ref(1);
  const scale = computed(() => Math.min(props.home.clock.scale, (scr.w - 24) / 202));
  let started = 0;
  onFrame(() => {
    const next = text();
    if (next !== current.value) {
      previous.value = current.value;
      current.value = next;
      started = Date.now();
    }
    progress.value = Math.min(1, (Date.now() - started) / 320);
  });
  return <>
    {[0, 1, 2, 3].map((index) => <View class="absolute overflow-hidden" style={{
      insetL: Math.round(scr.w * props.home.clock.x / 100 + (index * 48 + (index >= 2 ? 10 : 0) - 101) * scale.value),
      insetT: Math.round(scr.h * props.home.clock.y / 100 - 30 * scale.value),
      width: 44 * scale.value, height: 66 * scale.value, radius: 7 * scale.value, bgColor: 0xff292019,
    }}>
      <Image class="absolute" src={`clock-${current.value[index]}.png`} style={{ width: 64 * scale.value, height: 64 * scale.value, insetL: -10 * scale.value, insetT: 0 }} />
      {previous.value[index] !== current.value[index] && progress.value < 0.5 && <View class="absolute overflow-hidden" style={{ insetL: 0, insetT: 0, width: 44 * scale.value, height: 33 * scale.value, scaleY: 1 - progress.value * 2, bgColor: 0xff292019 }}>
        <Image class="absolute" src={`clock-${previous.value[index]}.png`} style={{ width: 64 * scale.value, height: 64 * scale.value, insetL: -10 * scale.value, insetT: 0 }} />
      </View>}
      {previous.value[index] !== current.value[index] && progress.value >= 0.5 && progress.value < 1 && <View class="absolute overflow-hidden" style={{ insetL: 0, insetT: 33 * scale.value, width: 44 * scale.value, height: 33 * scale.value, scaleY: progress.value * 2 - 1, bgColor: 0xff292019 }}>
        <Image class="absolute" src={`clock-${current.value[index]}.png`} style={{ width: 64 * scale.value, height: 64 * scale.value, insetL: -10 * scale.value, insetT: -33 * scale.value }} />
      </View>}
      <View class="absolute" style={{ insetL: 0, insetT: 33 * scale.value, width: 44 * scale.value, height: Math.max(1, scale.value), bgColor: 0xff0d0906 }} />
    </View>)}
  </>;
}
