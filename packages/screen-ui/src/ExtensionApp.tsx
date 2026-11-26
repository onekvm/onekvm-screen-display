import { computed } from "vue";
import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { ActionBar } from "./components/ActionBar";
import { AppHeader } from "./components/AppHeader";
import { AuthorizationCard } from "./components/AuthorizationCard";
import { StatusCard } from "./components/StatusCard";
import { authorizationMessage } from "./authorization";
import { device, screenSize } from "./device";
import { actionTitle, appTitle, useI18n } from "./i18n";
import { COLOR, FONT } from "./theme";
import type { AppConfig, StatusPresentation } from "./types";
import { useActions } from "./useActions";
import { useExtension } from "./useExtension";

interface Props extends StatusPresentation { config: AppConfig }

/** Common service screen; contributors supply identity, actions and status. */
export function ExtensionApp(props: Props) {
  const t = useI18n();
  const screen = screenSize();
  const controls = useExtension(props.config);
  const back = () => device()?.set?.("launch", "launcher");
  const home = () => device()?.set?.("launch", "shell");
  const enabled = (index: number) => index === props.config.actions.length ||
    (!controls.busy.value && props.config.actionEnabled?.(controls.state.value, props.config.actions[index]) !== false);
  const actions = useActions({ count: () => props.config.actions.length + 1, initialSelection: -1, onBack: back, onHome: home,
    enabled,
    onAction: index => index === props.config.actions.length ? back() : controls.action(index) });
  const authorization = computed(() => props.authorization?.(controls.state.value));
  const items = () => props.config.actions.map((item, index) => {
    const label = props.config.actionLabel?.(controls.state.value, item);
    return { id: item.method, label: label ? t(label) : actionTitle(item.method, item.title, t), disabled: !enabled(index) };
  });

  return (
    <View class="relative w-full h-full flex flex-col items-center" style={{ width: screen.w, height: screen.h, bgColor: COLOR.black }}>
      {authorization.value?.state === "pending" ? <AuthorizationCard authorization={authorization.value} width={screen.w} height={screen.h}
        busy={controls.busy.value} message={controls.message.value}
        title={props.config.title} icon={props.config.icon} actions={items()} selected={actions.selected.value} onAction={actions.press}
        onBack={() => actions.press(props.config.actions.length)} /> : <>
      <AppHeader width={screen.w} title={appTitle(props.config.kind, props.config.title, t)} icon={props.config.icon}
        selected={actions.selected.value === props.config.actions.length} onBack={() => actions.press(props.config.actions.length)} />
      <StatusCard width={screen.w} height={Math.min(92, screen.h - 94)} busy={controls.busy.value} offline={controls.state.value.online === false}
        tone={authorization.value?.state === "failed" || authorization.value?.state === "expired" || authorization.value?.state === "timed-out" ? "danger" : authorization.value && authorization.value.state !== "idle" ? "warning" : undefined}
        status={controls.busy.value ? t("busy") : authorization.value && authorization.value.state !== "idle" ? t(authorizationMessage(authorization.value)) : props.statusLabel(controls.state.value, t)}
        summary={props.summary(controls.state.value, t)} message={controls.message.value ? t(controls.message.value) : ""} />
      <View style={{ width: screen.w, height: 54 }}>
        <ActionBar width={screen.w} actions={items()}
          selected={actions.selected.value} onAction={actions.press} />
      </View>
      {screen.h >= 220 ? <View class="flex items-center justify-center" style={{ width: screen.w, height: 26 }}>
        <Text class="text-xs" style={{ fontSlot: FONT.xs, textColor: COLOR.muted }}>{t("holdBack")}</Text>
      </View> : null}
      </>}
    </View>
  );
}
