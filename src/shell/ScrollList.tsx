import { View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, setHot } from "../../packages/screen-ui/src/device";
import { ListRow, knobRow } from "./ListRow";
import { LIST_ROW_H, LIST_ROW_PITCH } from "./listMetrics";
import { requestScrollTransition } from "./device";
import { settleTouchScroll } from "../shared/touchScroll";

export interface ScrollListRow { id: string; label: string; value: string }
const TOP = 40;
const ROW = LIST_ROW_H;
const STEP = LIST_ROW_PITCH;

/** One continuous list, using the same direct drag and cached scroll as Settings. */
export function ScrollList(props: { width: number; height: number; rows: ScrollListRow[]; selected: number; active: boolean; view: string;
  status: string; refresh: string; onSelect(index: number): void }) {
  const view = props.view;
  const active = () => props.active && props.view === view;
  let strip: NodeMirror | null = null;
  let scroll = 0;
  let gestureStart = 0;
  let previous = -1;
  const viewport = () => props.height - TOP;
  const content = () => (props.rows.length + 1) * STEP + 4;
  const maximum = () => Math.max(0, content() - viewport());
  const clamp = (value: number) => Math.max(0, Math.min(maximum(), value));
  const move = () => { if (strip) jump(strip, "translateY", -scroll); };
  const glide = (from: number) => {
    move();
    requestScrollTransition(scroll >= from ? 1 : -1, Math.abs(scroll - from), { y: TOP, height: viewport() }, strip?.parent ? {
      node: strip.id, parent: strip.parent.id, offset: scroll, height: content(),
    } : undefined);
  };
  const bind = (node: NodeMirror | null) => {
    if (!node || typeof node.id !== "number") { if (!node) strip = null; return; }
    if (strip?.id === node.id) return;
    strip = node; move();
  };
  createGesture({ axis: "y", region: { rect: () => active() && maximum() > 0 ? { x: 0, y: TOP, w: props.width, h: viewport() } : null },
    onDown() {
      const [node, offset] = (device()?.get?.("appScrollPosition") || "").split(":").map(Number);
      if (strip?.id === node && Number.isFinite(offset) && offset >= 0) { scroll = clamp(offset); move(); }
      gestureStart = scroll;
    },
    onPanStart() { setHot(true); },
    onPanMove(contact) { scroll = clamp(gestureStart - contact.dy); move(); },
    onPanEnd(contact) {
      const from = scroll;
      scroll = -settleTouchScroll(-gestureStart, -scroll, contact.dy, contact.vy, viewport(), -maximum());
      move(); if (from !== scroll) glide(from); setHot(false);
    },
    onCancel() { setHot(false); },
  });
  onFrame(() => {
    // Vue disposes the outgoing list after this frame's input hooks. Do not
    // cache a scroll over the editor or category that has just replaced it.
    if (!active()) return;
    knobRow.value = props.selected;
    if (scroll > maximum()) { scroll = maximum(); move(); }
    if (props.selected === previous) return;
    const initial = previous < 0;
    previous = props.selected;
    const from = scroll;
    if (previous > props.rows.length) scroll = 0; // Header Back.
    else {
      const top = previous * STEP;
      if (top < scroll) scroll = top;
      else if (top + ROW > scroll + viewport() - 8) scroll = top + ROW - viewport() + 8;
    }
    scroll = clamp(scroll); move();
    if (!initial) glide(from);
  });
  return <View class="relative overflow-hidden" style={{ width: props.width, height: viewport() }}>
    <View nodeRef={bind} class="absolute flex flex-col gap-1" style={{ width: props.width - 16, height: content(), insetL: 8, insetT: 0 }}>
      {[...props.rows, { id: "__refresh", label: props.refresh, value: props.status || "›" }].map((row, index) =>
        <ListRow key={row.id} title={row.label} value={row.value} rowIndex={index} width={props.width - 16} onPress={() => props.onSelect(index)} />)}
    </View>
  </View>;
}
