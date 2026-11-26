import { View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { settleTouchScroll } from "../shared/touchScroll";
import { device, requestScrollTransition, screenSize, setHot } from "./device";
import { AppIcon, knobRow, ListRow } from "./ListRow";
import { LIST_ROW_GAP, LIST_ROW_H } from "./listMetrics";
import type { LauncherLayout, ScreenApp } from "./types";

const LIST_TOP = 32;
const LIST_ROW = LIST_ROW_H;
const LIST_GAP = LIST_ROW_GAP;
const LIST_EDGE = 8;

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

/** Keep every row in one vertical strip so rotary navigation moves the list itself. */
export function ScrollableAppList(props: {
  apps: readonly ScreenApp[];
  selected: number;
  active: boolean;
  onOpen: (app: ScreenApp) => void;
}) {
  let strip: NodeMirror | null = null;
  let scroll = 0;
  let previous = -1;
  let gestureScroll = 0;
  const viewport = screenSize().h;

  const contentHeight = () => LIST_TOP + props.apps.length * (LIST_ROW + LIST_GAP) - LIST_GAP;
  const maxScroll = () => Math.max(0, contentHeight() - viewport);
  const clampScroll = (offset: number) => Math.max(0, Math.min(maxScroll(), offset));
  const bindStrip = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (strip && node == null) strip = null;
      return;
    }
    if (strip?.id === node.id) return;
    strip = node;
    jump(node, "translateY", -scroll);
  };

  const glideScroll = (previousScroll: number) => {
    requestScrollTransition(scroll > previousScroll ? 1 : -1, Math.abs(scroll - previousScroll), {
      y: 0,
      height: viewport,
    }, strip?.parent ? {
      node: strip.id, parent: strip.parent.id, offset: scroll,
      height: contentHeight(),
    } : undefined);
  };

  createGesture({
    axis: "y",
    region: {
      rect: () => props.active && maxScroll() > 0
        ? { x: 0, y: 0, w: screenSize().w, h: viewport }
        : null,
    },
    onDown() {
      const [node, offset] = (device()?.get?.("appScrollPosition") || "").split(":").map(Number);
      if (strip?.id === node && Number.isFinite(offset) && offset >= 0) {
        scroll = clampScroll(offset);
        jump(strip, "translateY", -scroll);
      }
      gestureScroll = scroll;
    },
    onPanStart() {
      setHot(true);
    },
    onPanMove(c) {
      scroll = clampScroll(gestureScroll - c.dy);
      if (strip) jump(strip, "translateY", -scroll);
    },
    onPanEnd(c) {
      const previousScroll = scroll;
      scroll = -settleTouchScroll(-gestureScroll, -scroll, c.dy, c.vy, viewport, -maxScroll());
      if (strip) jump(strip, "translateY", -scroll);
      if (scroll !== previousScroll) glideScroll(previousScroll);
      setHot(false);
    },
    onCancel() {
      setHot(false);
    },
  });

  onFrame(() => {
    const selected = props.selected;
    if (selected === previous) return;
    const wasSelected = previous >= 0;
    previous = selected;
    if (selected < 0) return;
    const top = LIST_TOP + selected * (LIST_ROW + LIST_GAP);
    const bottom = top + LIST_ROW;
    let next = scroll;
    if (top < scroll + LIST_EDGE) next = top - LIST_EDGE;
    else if (bottom > scroll + viewport - LIST_EDGE) next = bottom - viewport + LIST_EDGE;
    next = Math.max(0, Math.min(maxScroll(), next));
    const previousScroll = scroll;
    scroll = next;
    // Keep the guest tree at its final position immediately. The host
    // slides a complete cached RGB565 list, avoiding a full guest paint
    // and framebuffer conversion for every tween tick.
    if (strip) jump(strip, "translateY", -scroll);
    // Initial selection belongs to the horizontal home→apps page slide.
    if (!wasSelected) return;
    glideScroll(previousScroll);
  });

  return (
    <View class="w-full h-full bg-black overflow-hidden">
      <View nodeRef={bindStrip} class="w-full flex flex-col justify-start px-5 pt-8 gap-1">
        {props.apps.map((app, index) => (
          <ListRow
            icon={app.icon}
            title={app.title}
            rowIndex={index}
            onPress={() => props.onOpen(app)}
          />
        ))}
      </View>
    </View>
  );
}

export function AppPage(props: {
  apps: readonly ScreenApp[];
  list: boolean;
  layout: LauncherLayout;
  page: number;
  selected: number;
  onOpen: (app: ScreenApp) => void;
}) {
  const size = props.list ? props.layout.listRows : props.layout.iconColumns * props.layout.iconRows;
  const start = props.page * Math.max(1, size);
  const slice = props.apps.slice(start, start + Math.max(1, size));
  if (props.list) {
    return (
      <View class="w-full h-full flex flex-col justify-start bg-black px-5 pt-8 gap-1">
        {slice.map((app, index) => (
          <ListRow
            icon={app.icon}
            title={app.title}
            rowIndex={start + index}
            onPress={() => props.onOpen(app)}
          />
        ))}
      </View>
    );
  }
  const cell = props.layout.iconSize;
  const gap = 10;
  const cols = props.layout.iconColumns;
  const rows = props.layout.iconRows;
  const gridW = cols * cell + (cols - 1) * gap;
  const cells: ScreenApp[][] = [];
  for (let r = 0; r < rows; r++) {
    const row = slice.slice(r * cols, r * cols + cols);
    if (row.length)
      cells.push(row);
  }
  return (
    <View class="w-full h-full flex flex-col items-center justify-center bg-black">
      {cells.map((row, r) => (
        <View class="flex flex-row items-center justify-center" style={{ width: gridW, marginB: gap }}>
          {row.map((app, i) => (
            <View
              class={
                start + r * cols + i === knobRow.value
                  ? "flex items-center justify-center bg-amber-400"
                  : "flex items-center justify-center bg-blue-500 active:bg-zinc-100"
              }
              style={{
                width: cell,
                height: cell,
                radius: cell / 2,
                marginR: i === row.length - 1 ? 0 : gap,
              }}
              focusable
              onPress={() => props.onOpen(app)}
            >
              <AppIcon
                icon={app.icon}
                className="text-base"
                size={Math.max(16, Math.round(cell * 0.55))}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
