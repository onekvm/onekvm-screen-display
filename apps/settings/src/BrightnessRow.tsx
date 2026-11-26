import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { screenSize, setHot } from "./device";
import { knobRow } from "../../../src/shell/ListRow";
import { LIST_ROW_H } from "../../../src/shell/listMetrics";
import { COLOR, FONT } from "./ui";
import { SETTINGS_ASSETS } from "./assets";

const ROW_X = 20;
const ROW_H = LIST_ROW_H;

function rowW(): number {
  return Math.max(120, screenSize().w - 40);
}

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function clampPct(n: number): number {
  return Math.max(5, Math.min(100, Math.round(n)));
}

export function BrightnessRow(props: {
  value: number;
  enabled: boolean;
  editing: boolean;
  top: () => number;
  title: string;
  rowIndex: number;
  onChange: (pct: number) => void;
  onToggle: () => void;
}) {
  let fill: NodeMirror | null = null;
  let row: NodeMirror | null = null;
  let last = props.value;
  let editableContact = false;
  let startValue = props.value;

  const paint = (pct: number) => {
    last = pct;
    if (fill) jump(fill, "width", (rowW() * pct) / 100);
  };

  const apply = (dx: number) => {
    if (!props.enabled || !props.editing || !editableContact) return;
    // Relative travel preserves the current value when the finger lands.
    const pct = clampPct(startValue + (dx / rowW()) * 100);
    if (pct === last) return;
    paint(pct);
    props.onChange(pct);
  };

  const bindFill = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (fill && node == null) fill = null;
      return;
    }
    fill = node;
    paint(props.value);
  };

  onFrame(() => {
    if (props.value !== last) paint(props.value);
  });

  const bindRow = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (row && node == null) row = null;
      return;
    }
    row = node;
  };

  createGesture({
    region: {
      node: () => (props.enabled ? row : null),
      rect: () =>
        props.enabled ? { x: ROW_X, y: props.top(), w: rowW(), h: ROW_H } : null,
    },
    onTap() {
      if (props.enabled) props.onToggle();
    },
  });

  // The resting row observes taps only: horizontal drags belong to Back.
  // Claim the slider axis only after an explicit tap entered adjustment.
  createGesture({
    axis: "x",
    region: {
      node: () => (props.enabled && props.editing ? row : null),
      rect: () => props.enabled && props.editing
        ? { x: ROW_X, y: props.top(), w: rowW(), h: ROW_H } : null,
    },
    onDown() {
      editableContact = props.editing;
      startValue = props.value;
    },
    onPanMove(c) {
      apply(c.dx);
    },
    onPanEnd() {
      setHot(false);
    },
    onUp() {
      setHot(false);
    },
    onCancel() {
      editableContact = false;
      setHot(false);
    },
  });

  return (
    <View
      class={
        props.rowIndex === knobRow.value || props.editing
          ? "relative shrink-0 rounded-xl bg-blue-500 transition-colors duration-160 ease-out"
          : "relative shrink-0 rounded-xl bg-zinc-800 active:bg-blue-500 transition-colors duration-160 ease-out"
      }
      style={{ width: rowW(), height: ROW_H, radius: 12 }}
      nodeRef={bindRow}
    >
      <View
        class={
          props.editing
            ? "absolute left-0 top-0 rounded-xl bg-zinc-600 transition-colors duration-160 ease-out"
            : props.rowIndex === knobRow.value
              ? "absolute left-0 top-0 rounded-xl bg-blue-500 transition-colors duration-160 ease-out"
              : "absolute left-0 top-0 rounded-xl bg-zinc-600 transition-colors duration-160 ease-out"
        }
        style={{
          width: (rowW() * props.value) / 100,
          height: ROW_H,
          radius: 12,
        }}
        nodeRef={bindFill}
      />
      <View
        class="absolute flex flex-row items-center justify-between px-3"
        style={{ width: rowW(), height: ROW_H, insetL: 0, insetT: 0 }}
      >
        <View class="flex flex-row items-center gap-3">
          <View
            class="flex w-11 h-11 rounded-full bg-blue-500 items-center justify-center"
            style={{ bgColor: props.rowIndex === knobRow.value || props.editing ? COLOR.zinc950 : COLOR.primary }}
          >
            <Image class="w-6 h-6" src={SETTINGS_ASSETS.screen} />
          </View>
          <Text
            class="text-base leading-6 text-white"
            style={{ fontSlot: FONT.base, textColor: COLOR.white }}
          >
            {props.title}
          </Text>
        </View>
        <Text
          class="text-sm text-white"
          style={{ fontSlot: FONT.sm, textColor: COLOR.white }}
        >
          {`${props.value}%`}
        </Text>
      </View>
    </View>
  );
}
