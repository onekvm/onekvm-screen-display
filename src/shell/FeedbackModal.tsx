import { Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { jump } from "@pocketjs/framework/vue-vapor/animation";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { COLOR, FONT } from "./ui";

type Action = { label: string; onPress: () => void };

/** The owner routes rotary and Back input while this modal is open. The
 * backdrop is opaque: on small panels, rows dimmed behind the dialog were cut
 * off at its edges. */
export function FeedbackModal(props: {
  width: number;
  height: number;
  title?: string;
  message?: string;
  busy?: boolean;
  primary?: Action;
  secondary?: Action;
  rotary?: boolean;
  focus?: number;
  warning?: boolean;
  onBackdrop?: () => void;
}) {
  let ring: NodeMirror | null = null;
  let angle = 0;
  onFrame(() => {
    if (!props.busy || !ring) return;
    angle = (angle + 24) % 360;
    jump(ring, "arcStart", angle);
  });
  const width = () => Math.max(160, props.width - 32);
  const height = () => Math.min(props.height - 16, props.title ? 140 : 112);
  const actions = () => [...(props.secondary ? [props.secondary] : []), ...(props.primary ? [props.primary] : [])];
  const actionWidth = () => (width() - 32 - (props.secondary ? 8 : 0)) / (props.secondary ? 2 : 1);
  const accent = () => props.warning ? COLOR.amber400 : COLOR.primary;
  const selected = (index: number) => props.rotary ? props.focus === index : index === actions().length - 1;
  return (
    <View class="absolute" style={{ insetL: 0, insetT: 0, width: props.width, height: props.height }}>
      <View
        class="absolute bg-black"
        style={{ insetL: 0, insetT: 0, width: props.width, height: props.height }}
        focusable
        onPress={() => { if (!props.busy) props.onBackdrop?.(); }}
      />
      <View
        class="absolute flex flex-col items-center justify-center gap-2 rounded-xl bg-zinc-900"
        style={{ width: width(), height: height(), insetL: 16, insetT: Math.round((props.height - height()) / 2), radius: 16 }}
        focusable
        onPress={() => {}}
      >
        {props.busy ? (
          <View
            nodeRef={(node: NodeMirror | null) => { ring = node && typeof node.id === "number" ? node : null; }}
            style={{ width: 36, height: 36, bgColor: COLOR.zinc100, arcSweep: 270, arcWidth: 3 }}
          />
        ) : null}
        {props.title ? (
          <Text class="text-base text-white" style={{ fontSlot: FONT.base, textColor: COLOR.white }}>
            {props.title}
          </Text>
        ) : null}
        {props.message ? (
          <Text
            class="text-sm"
            style={{ fontSlot: FONT.sm, textColor: props.warning ? COLOR.amber400 : COLOR.zinc400, width: width() - 32 }}
          >
            {props.message}
          </Text>
        ) : null}
        {!props.busy && props.primary ? (
          <View class="flex flex-row gap-2" style={{ width: width() - 32, height: 44 }}>
            {actions().map((action, index) => (
              <View
                class="flex items-center justify-center rounded-xl active:bg-blue-500"
                style={{ width: actionWidth(), height: 44, radius: 10, bgColor: selected(index) ? accent() : COLOR.zinc800 }}
                focusable
                onPress={() => action.onPress()}
              >
                <Text class="text-sm" style={{ fontSlot: FONT.sm, textColor: selected(index) && props.warning ? COLOR.zinc950 : COLOR.white }}>
                  {action.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
