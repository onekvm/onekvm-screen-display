import { Image } from "@pocketjs/framework/vue-vapor/components";

export function ClockPeriod(props: { period: string; x: number; y: number; scale: number }) {
  return <>{props.period && <Image class="absolute"
    src={props.period === "AM" ? "dashboard-clock-am.png" : "dashboard-clock-pm.png"}
    style={{
      width: 32 * props.scale, height: 32 * props.scale,
      insetL: props.x - 16 * props.scale, insetT: props.y - 16 * props.scale,
    }}
  />}</>;
}
