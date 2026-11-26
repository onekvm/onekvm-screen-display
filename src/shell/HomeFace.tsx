import { CompositorSurface, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { computed, createKeyedFragment, type ShallowRef } from "vue";
import type { ClockParts } from "./clock";
import { screenSize } from "./device";
import { FONT } from "./ui";
import type { HomeLayout, PlacedWidget } from "./homeLayout";
import { ClockWidget } from "./ClockWidget";
import { statusIconBadge } from "../shared/statusIcons";
import { DashboardClock } from "./DashboardClock";
import { StatusIcon } from "./StatusIcon";

export function HomeFace(props: { clock: ClockParts; home: HomeLayout; widgets: readonly ShallowRef<PlacedWidget>[]; hasUnderlay: boolean; selectedWidget?: string }) {
  return (
    <View class="relative w-full h-full" style={{
      bgColor: props.hasUnderlay ? 0x00000000 : props.home.face.background,
    }}>
      {props.widgets.slice(0, props.home.clockLayer).map(widget => homeWidget(widget, () => props.selectedWidget === widget.value.id))}
      {props.home.clockVisible && (props.home.face.id === "screen-display/dashboard"
        ? <DashboardClock clock={props.clock} home={props.home} />
        : <ClockWidget clock={props.clock} home={props.home} />)}
      {props.widgets.slice(props.home.clockLayer).map(widget => homeWidget(widget, () => props.selectedWidget === widget.value.id))}
    </View>
  );
}

function homeWidget(widget: ShallowRef<PlacedWidget>, selected: () => boolean) {
  return createKeyedFragment(
    () => `${widget.value.kind}:${!!widget.value.programmed}:${!!widget.value.statusImage}:${!!widget.value.statusIcon}:${widget.value.kind === "rect" && !!widget.value.text}`,
    () => WidgetBody({ get widget() { return widget.value; }, get selected() { return selected(); } }),
  );
}

function WidgetBody(props: { widget: PlacedWidget; selected?: boolean }) {
  const scr = screenSize();
  const bounds = computed(() => ({
    width: props.widget.width,
    height: props.widget.height,
    insetL: Math.round(scr.w * props.widget.x / 100 - props.widget.width / 2),
    insetT: Math.round(scr.h * props.widget.y / 100 - props.widget.height / 2),
    scaleX: props.widget.scale,
    scaleY: props.widget.scale,
  }));
  const mediaSurface = () => `screen-display/home-widget-${props.widget.mediaSlot}`;
  if (props.widget.programmed) return <View class="absolute overflow-hidden" style={bounds.value}>
    <CompositorSurface class="absolute w-full h-full" package={mediaSurface()} />
    {props.selected ? <View class="absolute w-full h-full" style={{ borderColor: 0xffffe76e, borderWidth: 2, radius: props.widget.radius }} /> : null}
  </View>;
  if (props.widget.statusImage) return <CompositorSurface class="absolute" style={bounds.value} package={mediaSurface()} />;
  const appearance = computed(() => {
    let foreground = props.widget.accent;
    let background = 0x00000000;
    let borderColor = 0x00000000;
    let borderWidth = 0;
    if (props.widget.kind === "status") {
      foreground = props.widget.active ? props.widget.accent : props.widget.inactive;
      if (props.widget.active && props.widget.filled) {
        foreground = 0xff000000;
        background = props.widget.accent;
      } else if (props.widget.showBackground) {
        background = props.widget.background;
      }
      if (props.widget.showBorder && props.widget.active && !props.widget.filled) {
        borderColor = props.widget.accent;
        borderWidth = 2;
      }
    } else if (props.widget.kind === "rect") {
      if (props.widget.filled) background = props.widget.background;
      else {
        borderColor = props.widget.accent;
        borderWidth = 2;
      }
    } else if (props.widget.kind === "progress") {
      background = props.widget.background;
    } else if (props.widget.kind === "line") {
      background = props.widget.accent;
    } else if (props.widget.showBackground) {
      background = props.widget.background;
    }
    return { foreground, background, borderColor, borderWidth };
  });
  // The key fixes the content type for this instance. Avoid keeping a
  // dynamic branch scope for every unsupported kind on every widget.
  let content;
  if (props.widget.kind === "media") {
    content = <CompositorSurface class="absolute w-full h-full" package={mediaSurface()} />;
  } else if (props.widget.kind === "progress") {
    content = <View class="absolute" style={{ insetL: 0, insetT: 0, width: props.widget.width * props.widget.progress / 100, height: props.widget.height, bgColor: props.widget.accent, radius: props.widget.radius }} />;
  } else if (props.widget.statusIcon) {
    const badge = computed(() => statusIconBadge(props.widget.statusIcon!, props.widget.width, props.widget.height, props.widget.statusCount ?? 0));
    content = <>
      <StatusIcon source={props.widget.statusIcon} color={appearance.value.foreground} width={props.widget.width} height={props.widget.height} />
      {badge.value ? <View class="absolute flex items-center justify-center" style={{ insetL: badge.value.x, insetT: badge.value.y, width: badge.value.width, height: badge.value.height, radius: badge.value.radius, bgColor: appearance.value.foreground }}>
        <Text class="text-xs font-bold" style={{ fontSlot: FONT.xsBold, textColor: props.widget.active && props.widget.filled ? props.widget.accent : 0xff000000 }}>{badge.value.text}</Text>
      </View> : null}
    </>;
  } else if (props.widget.kind !== "line" && (props.widget.kind !== "rect" || props.widget.text)) {
    content = <Text class={props.widget.fontSize >= 24 ? "text-2xl font-bold" : props.widget.fontSize >= 16 ? "text-base font-bold" : props.widget.fontSize >= 14 ? "text-sm font-bold" : "text-xs font-bold"} style={{ fontSlot: props.widget.fontSize >= 24 ? undefined : props.widget.fontSize >= 16 ? FONT.base : props.widget.fontSize >= 14 ? FONT.sm : FONT.xsBold, textColor: appearance.value.foreground }}>
      {props.widget.text}
    </Text>;
  }
  return <View key={props.widget.id} class={props.widget.textAlign === "left" ? "absolute flex flex-col items-start justify-center overflow-hidden" : props.widget.textAlign === "right" ? "absolute flex flex-col items-end justify-center overflow-hidden" : "absolute flex flex-col items-center justify-center overflow-hidden"} style={{
    ...bounds.value,
    bgColor: appearance.value.background,
    borderColor: appearance.value.borderColor,
    borderWidth: appearance.value.borderWidth,
    radius: props.widget.radius,
  }}>
    {content}
  </View>;
}
