import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { requestDrawerTransition, screenSize, setHot } from "./device";
import { drawerRow, knobRow } from "../../../src/shell/ListRow";
import { LIST_ROW_GAP, LIST_ROW_H } from "../../../src/shell/listMetrics";
import { COLOR, FONT } from "./ui";

const ROW_H = LIST_ROW_H;
const ROW_GAP = LIST_ROW_GAP;

function sheet(fit = false, count = 2): {
  w: number;
  h: number;
  y: number;
  listW: number;
  row: number;
  gap: number;
  head: number;
  body: number;
} {
  const scr = screenSize();
  const row = ROW_H;
  const gap = ROW_GAP;
  const head = 28;
  const body = Math.max(row, count * row + Math.max(0, count - 1) * gap);
  const full = head + 8 + body;
  const h = fit ? Math.min(scr.h - 12, full) : Math.min(scr.h - 8, Math.max(full, head + row));
  return { w: scr.w, h, y: scr.h - h, listW: Math.max(120, scr.w - 40), row, gap, head, body };
}

export type OptionItem = { id: string; label: string };

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function bindOnce(
  slot: { current: NodeMirror | null },
  node: NodeMirror | null,
  init: (node: NodeMirror) => void,
) {
  if (!isMirror(node)) {
    if (slot.current && node == null) slot.current = null;
    return;
  }
  if (slot.current === node) return;
  slot.current = node;
  init(node);
}

export function OptionRow(props: {
  icon?: string;
  title: string;
  value: string;
  rowIndex: number;
  onPress: () => void;
}) {
  return (
    <View
      class={
        props.rowIndex === knobRow.value
          ? "w-full shrink-0 flex flex-row items-center justify-between px-3 rounded-xl bg-blue-500 active:bg-blue-500 transition-colors duration-96 ease-out"
          : "w-full shrink-0 flex flex-row items-center justify-between px-3 rounded-xl bg-zinc-800 active:bg-blue-500 transition-colors duration-96 ease-out"
      }
      style={{ height: ROW_H }}
      focusable
      onPress={() => props.onPress()}
    >
      <View class="flex flex-row items-center gap-3">
        {props.icon ? (
          <View
            class="flex w-11 h-11 rounded-full bg-blue-500 items-center justify-center transition-colors duration-96 ease-out"
            style={{ bgColor: props.rowIndex === knobRow.value ? COLOR.zinc950 : COLOR.primary }}
          >
            <Image class="w-6 h-6" src={props.icon} />
          </View>
        ) : null}
        <Text
          class="text-base leading-6 text-white transition-colors duration-96 ease-out"
          style={{ fontSlot: FONT.base, textColor: COLOR.white }}
        >
          {props.title}
        </Text>
      </View>
      <Text
        class="text-sm text-zinc-400 transition-colors duration-96 ease-out"
        style={{
          fontSlot: FONT.sm,
          textColor: props.rowIndex === knobRow.value ? COLOR.white : COLOR.zinc400,
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

export function OptionDrawer(props: {
  open: boolean;
  title: string;
  options: readonly OptionItem[];
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
  /** Size the sheet to the option count. The network drawer keeps the fixed height. */
  fit?: boolean;
}) {
  const sheetNode: { current: NodeMirror | null } = { current: null };
  const scrimNode: { current: NodeMirror | null } = { current: null };
  const listNode: { current: NodeMirror | null } = { current: null };
  let wasOpen = false;
  let scroll = 0;
  let lastCursor = -2;
  let dragStart = 0;
  let dragging = false;

  const metrics = () => sheet(!!props.fit, props.options.length);
  const travel = () => metrics().h;

  onFrame(() => {
    const open = !!props.open;
    if (open && listNode.current && !dragging && (!wasOpen || drawerRow.value !== lastCursor)) {
      lastCursor = drawerRow.value;
      const box = metrics();
      const index = Math.max(0, drawerRow.value);
      const pitch = box.row + box.gap;
      const top = index * pitch;
      const view = Math.max(box.row, box.h - box.head - 8);
      let y = scroll;
      if (top < y) y = top;
      else if (top + box.row > y + view) y = top + box.row - view;
      const max = Math.max(0, box.body - view);
      y = Math.max(0, Math.min(max, y));
      if (y !== scroll) {
        scroll = y;
        jump(listNode.current, "translateY", -y);
        setHot(true);
      }
    } else if (!open) {
      if (scroll !== 0 && listNode.current) jump(listNode.current, "translateY", 0);
      scroll = 0;
      lastCursor = -2;
      dragging = false;
    }
    const sheetEl = sheetNode.current;
    const scrimEl = scrimNode.current;
    if (open === wasOpen || !sheetEl || !scrimEl) return;
    wasOpen = open;
    const box = metrics();
    // Commit the final state in one guest frame. The host then slides the
    // cached sheet and fades its scrim without rerunning JS/layout/raster on
    // every display tick.
    jump(sheetEl, "translateY", open ? 0 : box.h);
    jump(scrimEl, "opacity", open ? 0.45 : 0);
    requestDrawerTransition(open, box.y);
    setHot(true);
  });

  createGesture({
    axis: "y",
    region: {
      rect: () => {
        const box = metrics();
        return props.open && box.body > box.h - box.head - 8
          ? { x: (box.w - box.listW) / 2, y: box.y + box.head, w: box.listW, h: box.h - box.head - 8 }
          : null;
      },
    },
    onDown() { dragStart = scroll; },
    onPanStart() { dragging = true; setHot(true); },
    onPanMove(c) {
      const box = metrics();
      scroll = Math.max(0, Math.min(box.body - (box.h - box.head - 8), dragStart - c.dy));
      if (listNode.current) jump(listNode.current, "translateY", -scroll);
      setHot(true);
    },
    onPanEnd() { dragging = false; setHot(true); },
  });

  createGesture({
    axis: "x",
    region: {
      rect: () => {
        const box = metrics();
        return props.open ? { x: 0, y: box.y, w: box.w, h: box.h } : null;
      },
    },
    onPanEnd(c) {
      if (c.dx > 28) props.onClose();
    },
  });

  return (
    <View
      class="absolute"
      style={{
        width: metrics().w,
        height: screenSize().h,
        insetL: 0,
        insetT: 0,
        hitPass: 1,
      }}
    >
      <View
        class="absolute bg-black"
        style={{ width: metrics().w, height: screenSize().h, insetL: 0, insetT: 0 }}
        nodeRef={(node) => bindOnce(scrimNode, node, (el) => jump(el, "opacity", props.open ? 0.45 : 0))}
        focusable
        onPress={() => props.onClose()}
      />
      <View
        class="absolute bg-zinc-900"
        style={{ width: metrics().w, height: metrics().h, insetL: 0, insetT: metrics().y }}
        nodeRef={(node) => bindOnce(sheetNode, node, (el) => jump(el, "translateY", props.open ? 0 : travel()))}
      >
        <View class={props.fit || metrics().h < 200 ? "flex flex-col items-center gap-1 pt-1" : "flex flex-col items-center gap-1 pt-2"} style={{ width: metrics().w }}>
          <Text class="text-sm text-zinc-400" style={{ fontSlot: FONT.sm, textColor: COLOR.zinc400 }}>
            {props.title}
          </Text>
          <View class="overflow-hidden" style={{ width: metrics().listW, height: Math.max(metrics().row, metrics().h - metrics().head - 8) }}>
          <View
            class="flex flex-col"
            style={{ width: metrics().listW, height: metrics().body }}
            nodeRef={(node) => bindOnce(listNode, node, (el) => jump(el, "translateY", -scroll))}
          >
            {props.options.map((opt, index) => (
              <View
                class={
                  drawerRow.value === index
                    ? "shrink-0 flex flex-row items-center px-3 rounded-xl bg-blue-500 active:bg-blue-500"
                    : opt.id === props.value
                      ? "shrink-0 flex flex-row items-center px-3 rounded-xl bg-zinc-100 active:bg-blue-500"
                      : "shrink-0 flex flex-row items-center px-3 rounded-xl bg-zinc-800 active:bg-blue-500"
                }
                style={{ width: metrics().listW, height: metrics().row, marginB: index === props.options.length - 1 ? 0 : metrics().gap }}
                focusable
                onPress={() => props.onPick(opt.id)}
              >
                <Text
                  class={
                    drawerRow.value === index || opt.id !== props.value
                      ? "text-sm text-white"
                      : "text-sm text-zinc-950"
                  }
                  style={{ fontSlot: FONT.sm }}
                >
                  {opt.label}
                </Text>
              </View>
            ))}
          </View>
          </View>
        </View>
      </View>
    </View>
  );
}
