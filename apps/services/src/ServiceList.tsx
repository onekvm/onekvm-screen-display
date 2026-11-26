import { computed } from "vue";
import { ScrollList } from "../../../src/shell/ScrollList";
import { type Service } from "./model";
import { type Message, useStrings } from "./i18n";

interface Props {
  width: number; height: number; items: Service[]; active: boolean;
  selected: number; busy: boolean; message: Message; t: ReturnType<typeof useStrings>;
  label(item: Service): string; onSelect(index: number): void;
}

/** Shared continuous list; the parent owns service selection and operations. */
export function ServiceList(props: Props) {
  const rows = computed(() => props.items.map(item => ({
    id: item.id, label: props.label(item), value: props.t(item.running ? "running" : "stopped"),
  })));
  const status = () => props.message ? props.t(props.message) : props.busy ? props.t("busy") : props.items.length ? "" : props.t("empty");
  return <ScrollList width={props.width} height={props.height} rows={rows.value}
    selected={props.selected} active={props.active} view="services"
    status={status()} refresh={props.t("refresh")} onSelect={props.onSelect} />;
}
