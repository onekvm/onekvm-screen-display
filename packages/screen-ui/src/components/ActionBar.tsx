import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { COLOR, FONT } from "../theme";

export interface ActionItem {
  id: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  width: number;
  actions: readonly ActionItem[];
  selected: number;
  onAction(index: number): void;
}

/** Presentation only; useActions supplies the same handler for every input. */
export function ActionBar(props: Props) {
  const buttonWidth = Math.max(1, Math.floor((props.width - 30 - (props.actions.length - 1) * 8) / Math.max(1, props.actions.length)));
  return (
    <View class="flex flex-row items-center justify-center gap-2" style={{ width: props.width, height: 54 }}>
      {props.actions.map((item, index) => (
        <View key={item.id} class="flex items-center justify-center rounded-xl"
          style={{ width: buttonWidth, height: 40, bgColor: !item.disabled && props.selected === index ? COLOR.primary : COLOR.panel }}
          focusable={!item.disabled} onPress={() => { if (!item.disabled) props.onAction(index); }}>
          <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: item.disabled ? COLOR.muted : COLOR.white }}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}
