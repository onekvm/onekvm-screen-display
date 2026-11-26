import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import type { ClockParts } from "./clock";
import type { HomeWidgetStatus } from "../shared/homeWidgets";
import { screenSize } from "./device";
import { COLOR, FONT } from "./ui";

export function DashboardFace(props: { clock: ClockParts; status: HomeWidgetStatus }) {
  const scr = screenSize();
  const pad = scr.w < 260 ? 24 : 12;
  const width = scr.w - pad * 2;
  const bodyY = scr.h < 200 ? 64 : 94;
  const bodyH = scr.h < 200 ? 94 : 104;
  const sideW = scr.w < 260 ? 64 : 88;
  const infoW = width - sideW - 8;
  const flags = () => [
    { label: "ETH", on: props.status.ethernetConnected },
    { label: "HDMI", on: props.status.hdmiConnected },
    { label: "USB", on: props.status.hidConnected },
    { label: "LIVE", on: props.status.active },
  ];
  return <>
    <Text class="absolute text-sm font-bold" style={{ insetL: pad, insetT: scr.h < 200 ? 9 : 35, fontSlot: FONT.sm, textColor: COLOR.primary }}>OneKVM</Text>
    <Text class="absolute text-sm font-bold" style={{ insetL: scr.w - pad - 46, insetT: scr.h < 200 ? 9 : 35, fontSlot: FONT.sm, textColor: COLOR.white }}>{props.clock.hh}:{props.clock.mm}</Text>
    {flags().map((flag, index) => <View class="absolute flex items-center justify-center" style={{ width: (width - 18) / 4, height: 22, radius: 6, insetL: pad + index * (width + 6) / 4, insetT: bodyY - 30, bgColor: flag.on ? 0xff342013 : 0xff1e1812 }}>
      <Text class="text-xs font-bold" style={{ fontSlot: FONT.xsBold, textColor: flag.on ? COLOR.primary : COLOR.zinc400 }}>{flag.label}</Text>
    </View>)}
    <View class="absolute" style={{ insetL: pad, insetT: bodyY, width: infoW, height: bodyH, radius: 12, bgColor: 0xff201911 }}>
      <Text class="absolute text-xs" style={{ insetL: 12, insetT: 9, fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>IP ADDRESS</Text>
      <Text class="absolute text-base font-bold" style={{ insetL: 12, insetT: 26, fontSlot: FONT.base, textColor: COLOR.white }}>{props.status.ip || "--.--.--.--"}</Text>
      <Text class="absolute text-xs" style={{ insetL: 12, insetT: 50, fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>{props.status.hostname || "OneKVM"}</Text>
      <Text class="absolute text-xs font-bold" style={{ insetL: 12, insetT: 72, fontSlot: FONT.xsBold, textColor: COLOR.white }}>{props.status.resolution || (props.status.hdmiConnected ? "HDMI CONNECTED" : "NO SIGNAL")}  {props.status.active && props.status.fps > 0 ? `${props.status.fps} FPS` : ""}</Text>
    </View>
    <View class="absolute" style={{ insetL: pad + infoW + 8, insetT: bodyY, width: sideW, height: bodyH, radius: 12, bgColor: 0xff201911 }}>
      <Text class="absolute text-xs" style={{ insetL: 12, insetT: 9, fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>CPU %</Text>
      <Text class="absolute text-2xl font-bold" style={{ insetL: 12, insetT: 26, textColor: COLOR.primary }}>{props.status.cpuPercent === null ? "--" : `${Math.round(props.status.cpuPercent)}`}</Text>
      <View class="absolute" style={{ insetL: 12, insetT: 64, width: sideW - 24, height: 4, radius: 2, bgColor: 0xff49392c }} />
      <View class="absolute" style={{ insetL: 12, insetT: 64, width: Math.max(0, (sideW - 24) * (props.status.cpuPercent || 0) / 100), height: 4, radius: 2, bgColor: COLOR.primary }} />
      <Text class="absolute text-xs" style={{ insetL: 12, insetT: 75, fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>{props.clock.date}</Text>
    </View>
  </>;
}
