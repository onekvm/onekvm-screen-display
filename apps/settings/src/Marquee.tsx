import { shallowRef } from "vue";
import { Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { FONT } from "./ui";

const GAP = 32;
const HOLD = 48;
const SPEED = 0.75;

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function estimateWidth(text: string, px: number): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code > 127) width += px;
    else if (" il.:-()".includes(ch)) width += px * 0.34;
    else if (ch >= "A" && ch <= "Z") width += px * 0.62;
    else width += px * 0.52;
  }
  return Math.ceil(width);
}

function measureWidth(text: string, slot: number): number {
  try {
    const ops = (globalThis as { ui?: { measureText?: (s: string, n: number) => number } }).ui;
    const width = ops?.measureText?.(text, slot);
    if (typeof width === "number" && width > 0) return width;
  } catch {
    /* fall through */
  }
  const px = slot === FONT.xs ? 12 : slot === FONT.base ? 16 : 14;
  return estimateWidth(text, px);
}

export function MarqueeText(props: {
  text: string;
  width: number;
  fontSlot: number;
  textColor: number;
}) {
  let last = props.text;
  let textW = measureWidth(props.text, props.fontSlot);
  const overflow = shallowRef(textW > props.width);
  let strip: NodeMirror | null = null;
  let x = 0;
  let hold = HOLD;

  const bind = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (strip && node == null) strip = null;
      return;
    }
    strip = node;
  };

  onFrame(() => {
    if (props.text !== last) {
      last = props.text;
      textW = measureWidth(props.text, props.fontSlot);
      overflow.value = textW > props.width;
      x = 0;
      hold = HOLD;
      if (strip) jump(strip, "translateX", 0);
    }
    if (!overflow.value || !strip) return;
    if (hold > 0) {
      hold -= 1;
      return;
    }
    x -= SPEED;
    const loop = textW + GAP;
    if (x <= -loop) {
      x += loop;
      hold = HOLD;
    }
    jump(strip, "translateX", x);
  });

  return (
    <View class="flex items-center overflow-hidden" style={{ width: props.width, height: props.fontSlot === FONT.xs ? 18 : 21 }}>
      {overflow.value ? (
        <View class="flex flex-row items-center" nodeRef={bind}>
          <Text class="text-sm text-white" style={{ fontSlot: props.fontSlot, textColor: props.textColor }}>
            {props.text}
          </Text>
          <View style={{ width: GAP }} />
          <Text class="text-sm text-white" style={{ fontSlot: props.fontSlot, textColor: props.textColor }}>
            {props.text}
          </Text>
        </View>
      ) : (
        <Text class="text-sm text-white" style={{ fontSlot: props.fontSlot, textColor: props.textColor }}>
          {props.text}
        </Text>
      )}
    </View>
  );
}
