import { computed, shallowRef } from "vue";
import { View } from "@pocketjs/framework/vue-vapor/components";
import { AppHeader } from "../../../packages/screen-ui/src/components/AppHeader";
import { device, screenSize } from "../../../packages/screen-ui/src/device";
import { COLOR } from "../../../packages/screen-ui/src/theme";
import { useActions } from "../../../packages/screen-ui/src/useActions";
import { useStrings } from "./i18n";
import { canAct, type Service, type ServiceAction } from "./model";
import { useServices } from "./useServices";
import { ServiceList } from "./ServiceList";
import { ServiceDetail } from "./ServiceDetail";

const METHODS: ServiceAction[] = ["start", "stop", "restart"];

export default function Services() {
  const screen = screenSize();
  const t = useStrings();
  const state = useServices();
  const detail = shallowRef("");
  const current = computed(() => state.items.value.find(item => item.id === detail.value));
  const label = (item: Service) => item.id === "system.onekvm" ? t("coreName") : item.id === "system.time-sync" ? t("timeName") : item.id === "system.watchdog" ? t("watchdogName") : item.name;
  const repaint = () => device()?.set?.("frameAfter", "16");
  const back = () => {
    if (detail.value) { detail.value = ""; state.message.value = ""; actions.selected.value = Math.max(0, state.items.value.findIndex(item => item.id === lastDetail)); }
    else device()?.set?.("launch", "launcher");
    repaint();
  };
  let lastDetail = "";
  const available = (index: number) => !detail.value || index === 3 ||
    (!state.busy.value && !state.stale.value && canAct(current.value, METHODS[index]));
  const actions = useActions({ count: () => detail.value ? 4 : state.items.value.length + 2, onBack: back,
    onHome: () => device()?.set?.("launch", "shell"), enabled: available,
    onAction(index) {
      repaint();
      if (detail.value) {
        if (index === 3) back(); else state.action(detail.value, METHODS[index]);
      } else if (index === state.items.value.length + 1) back();
      else if (index === state.items.value.length) { state.message.value = ""; state.refresh(); }
      else {
        detail.value = state.items.value[index].id; lastDetail = detail.value;
        state.message.value = ""; actions.selected.value = 3;
      }
    },
  });
  const backIndex = () => detail.value ? 3 : state.items.value.length + 1;

  return <View class="relative w-full h-full flex flex-col items-center" style={{ width: screen.w, height: screen.h, bgColor: COLOR.black }}>
    <AppHeader width={screen.w} title={t("title")} selected={actions.selected.value === backIndex()} onBack={back} />
    {detail.value ? <ServiceDetail width={screen.w} height={screen.h} service={current.value}
      name={current.value ? label(current.value) : ""} busy={state.busy.value} stale={state.stale.value}
      message={state.message.value} selected={actions.selected.value} t={t} onAction={actions.press}
      actions={METHODS.map((method, index) => ({ id: method, label: t(method), disabled: !available(index) }))} /> :
      <ServiceList width={screen.w} height={screen.h} items={state.items.value} active={!detail.value}
        selected={actions.selected.value} busy={state.busy.value} message={state.message.value}
        t={t} label={label} onSelect={actions.press} />}

  </View>;
}
