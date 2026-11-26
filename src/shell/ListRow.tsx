import { computed, shallowRef } from "vue";
import { Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { LIST_ROW_H } from "./listMetrics";
import { COLOR, FONT } from "./ui";
import { screenSize } from "./device";
import { LIST_INSET, rowTexts } from "./textFit";

export { LIST_INSET, rowTexts };

/**
 * Paint reads these refs inside the class string. A `selected` boolean is
 * copied once, so a later knob move left every row on `active:` and nothing
 * stayed highlighted.
 */
export const knobRow = shallowRef(-1);
/** Row that stays marked besides the knob cursor, such as the saved timezone. */
export const pinRow = shallowRef(-1);
/** Option drawer cursor. -1 while the drawer is closed. */
export const drawerRow = shallowRef(-1);
/** Brightness row is being edited. */
export const rowArmed = shallowRef(false);

function marked(rowIndex: number | undefined, selected: boolean | undefined): boolean {
  return rowIndex !== undefined
    ? rowIndex === knobRow.value || rowIndex === pinRow.value
    : !!selected;
}

function RowLabel(props: {
  icon?: string;
  title: string;
  value?: string;
  tags?: string[];
  rowIndex?: number;
  selected?: boolean;
  width?: number;
}) {
  const texts = computed(() => rowTexts({
    width: props.width ?? screenSize().w - LIST_INSET,
    icon: !!props.icon,
    title: props.title,
    value: props.value,
    tags: props.tags,
  }));
  return (
    <>
      <View class="flex flex-row items-center gap-3">
        {props.icon ? (
          <View
            class="flex w-11 h-11 rounded-full items-center justify-center transition-colors duration-96 ease-out"
            style={{
              bgColor: marked(props.rowIndex, props.selected) ? COLOR.zinc950 : COLOR.primary,
            }}
          >
            <AppIcon icon={props.icon} className="w-6 h-6" />
          </View>
        ) : null}
        <View class="flex flex-col justify-center gap-1">
          <Text
            class="text-base leading-6 text-white transition-colors duration-96 ease-out"
            style={{ fontSlot: FONT.base, textColor: COLOR.white }}
          >
            {texts.value.title}
          </Text>
          {texts.value.tags.length > 0 ? (
            <View class="flex flex-row items-center gap-1">
              {texts.value.tags.map((tag) => (
                <View
                  class="flex px-1 rounded items-center justify-center transition-colors duration-96 ease-out"
                  style={{
                    height: 16,
                    bgColor: marked(props.rowIndex, props.selected) ? COLOR.zinc950 : 0xff46463f,
                  }}
                >
                  <Text class="text-xs" style={{ fontSlot: FONT.xs, textColor: COLOR.zinc100 }}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
      {props.value ? (
        <Text
          class="text-sm text-zinc-400 transition-colors duration-96 ease-out"
          style={{
            fontSlot: FONT.sm,
            textColor: marked(props.rowIndex, props.selected) ? COLOR.white : COLOR.zinc400,
          }}
        >
          {texts.value.value}
        </Text>
      ) : null}
    </>
  );
}

export function AppIcon(props: { icon?: string; className?: string; size?: number }) {
  // Each bundle stages its own image resources. App metadata never uses text icons.
  return <>{props.icon ? <Image style={{ width: props.size ?? 24, height: props.size ?? 24 }} src={props.icon} /> : null}</>;
}

/** Shared with the Settings app list and the shell list. Press turns the row blue immediately. */
export function ListRow(props: {
  title: string;
  value?: string;
  tags?: string[];
  icon?: string;
  /** Index of this row in the current list. Compared with `knobRow` while painting. */
  rowIndex?: number;
  selected?: boolean;
  /** Row width; defaults to the screen minus `LIST_INSET`. */
  width?: number;
  onPress?: () => void;
}) {
  // Read `knobRow.value` in the class expression itself. A helper that only the
  // compiler sees, or a boolean prop, does not subscribe the paint effect.
  return (
    <View
      class={
        (props.rowIndex !== undefined
          ? props.rowIndex === knobRow.value || props.rowIndex === pinRow.value
          : !!props.selected)
          ? "w-full shrink-0 flex flex-row items-center justify-between gap-3 px-3 rounded-xl bg-blue-500 transition-colors duration-96 ease-out"
          : props.onPress
            ? "w-full shrink-0 flex flex-row items-center justify-between gap-3 px-3 rounded-xl bg-zinc-800 active:bg-blue-500 transition-colors duration-96 ease-out"
            : "w-full shrink-0 flex flex-row items-center justify-between gap-3 px-3 rounded-xl bg-zinc-800 transition-colors duration-96 ease-out"
      }
      style={{ height: LIST_ROW_H }}
      {...(props.onPress ? { focusable: true, onPress: () => props.onPress?.() } : {})}
    >
      <RowLabel
        icon={props.icon}
        title={props.title}
        value={props.value}
        tags={props.tags}
        rowIndex={props.rowIndex}
        selected={props.selected}
        width={props.width}
      />
    </View>
  );
}
