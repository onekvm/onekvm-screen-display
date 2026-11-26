import { Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { setActiveNode } from "@pocketjs/framework/vue-vapor/input";
import { screenSize, setButtons, setHot } from "./device";
import { stickLayout, type Rect } from "./layout";
import { COLOR, FONT } from "./ui";
import { useI18n } from "../../shared/i18n";

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function Hold(props: { bit: number; label: string; rect: Rect }) {
  let btn: NodeMirror | null = null;
  let fill: NodeMirror | null = null;
  let down = false;

  const bind = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (btn && node == null) btn = null;
      return;
    }
    btn = node;
  };

  const bindFill = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (fill && node == null) fill = null;
      return;
    }
    fill = node;
    jump(node, "opacity", 0);
  };

  const press = (on: boolean) => {
    down = on;
    if (fill) jump(fill, "opacity", on ? 1 : 0);
    setActiveNode(on ? btn : null);
    setHot(on);
    setButtons(on ? props.bit : 0);
  };

  createGesture({
    axis: "any",
    region: {
      node: () => btn,
      rect: () => props.rect,
    },
    onDown() {
      press(true);
    },
    onUp() {
      if (!down) return;
      press(false);
    },
    onCancel() {
      if (!down) return;
      press(false);
    },
  });

  return (
    <View
      class="absolute flex items-center justify-center rounded-xl bg-zinc-800 active:bg-zinc-700"
      style={{ width: props.rect.w, height: props.rect.h, insetL: props.rect.x, insetT: props.rect.y }}
      focusable
      nodeRef={bind}
    >
      <View
        class="absolute rounded-xl bg-zinc-700"
        style={{ width: props.rect.w, height: props.rect.h, insetL: 0, insetT: 0 }}
        nodeRef={bindFill}
      />
      <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
        {props.label}
      </Text>
    </View>
  );
}

export function ClickBar() {
  const t = useI18n();
  const layout = stickLayout(screenSize());
  return (
    <>
      <Hold bit={1} label={t("left")} rect={layout.left} />
      <Hold bit={2} label={t("right")} rect={layout.right} />
    </>
  );
}
