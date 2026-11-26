import { computed, shallowRef } from "vue";
import { View } from "@pocketjs/framework/vue-vapor/components";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { ActionBar, AppHeader, StatusCard, device, screenSize, useActions } from "../../../packages/screen-ui/src";
import { useI18n } from "../../shared/i18n";

const powerActions = [
  { id: "on", title: "on" },
  { id: "off", title: "off" },
  { id: "reset", title: "reset" },
] as const;
function readPower(): Record<string, unknown> {
  try {
    const raw = JSON.parse(device()?.get?.("system") || "{}") as Record<string, unknown>;
    return raw.power && typeof raw.power === "object" ? raw.power as Record<string, unknown> : {};
  } catch { return {}; }
}
export default function Power() {
  const t = useI18n();
  const screen = screenSize();
  const state = shallowRef(readPower());
  const busy = shallowRef(false);
  const message = shallowRef<"" | "failed">("");
  const available = computed(() => state.value.available === true);
  const back = () => device()?.set?.("launch", "launcher");
  const home = () => device()?.set?.("launch", "shell");
  const enabled = (index: number) => index === powerActions.length || (!busy.value && available.value);
  let lastResponse = "";
  const run = (action: string) => {
    if (action === "back") {
      back();
      return;
    }
    if (busy.value || !available.value) return;
    busy.value = true;
    message.value = "";
    device()?.set?.("powerAction", action);
  };
  onFrame(() => {
    state.value = readPower();
    const response = device()?.get?.("appResponse") || "";
    if (response && response !== lastResponse) {
      lastResponse = response;
      try {
        const parsed = JSON.parse(response) as Record<string, unknown>;
        busy.value = parsed.busy === true;
        if (parsed.ok === false) message.value = "failed";
        else if (parsed.ok === true) message.value = "";
      } catch { /* keep previous state */ }
    }

  });
  const navigation = useActions({ count: () => powerActions.length + 1, initialSelection: -1,
    enabled, onBack: back, onHome: home,
    onAction: index => run(index === powerActions.length ? "back" : powerActions[index].id) });
  const powered = computed(() => state.value.pwr_led === true);
  const ledItems = computed(() => [
    typeof state.value.pwr_led === "boolean" ? `${t("powerLed")} ${t(state.value.pwr_led ? "lit" : "unlit")}` : "",
    typeof state.value.hdd_led === "boolean" ? `${t("hddLed")} ${t(state.value.hdd_led ? "active" : "idle")}` : "",
  ].filter(Boolean).join("  ·  "));
  return (
    <View class="relative w-full h-full bg-black flex flex-col items-center" style={{ width: screen.w, height: screen.h }}>
      <AppHeader width={screen.w} title={t("power")} icon="power.png"
        selected={navigation.selected.value === powerActions.length} onBack={() => navigation.press(powerActions.length)} />
      <StatusCard width={screen.w} height={Math.min(ledItems.value ? 108 : 92, screen.h - 94)} busy={busy.value} offline={false}
        tone={!available.value ? "warning" : !powered.value ? "muted" : undefined}
        status={t(!available.value ? "disconnected" : powered.value ? "poweredOn" : "poweredOff")}
        summary={t(available.value ? "hostPower" : "checkPower")} detail={ledItems.value}
        message={message.value ? t(message.value) : ""} />
      <ActionBar width={screen.w} actions={powerActions.map((item, index) => ({ id: item.id, label: t(item.title), disabled: !enabled(index) }))}
        selected={navigation.selected.value} onAction={navigation.press} />
    </View>
  );
}
