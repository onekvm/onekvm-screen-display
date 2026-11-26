import { computed, shallowRef } from "vue";
import { View } from "@pocketjs/framework/vue-vapor/components";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { AppHeader } from "../../../packages/screen-ui/src/components/AppHeader";
import { device, screenSize } from "../../../packages/screen-ui/src/device";
import { COLOR } from "../../../packages/screen-ui/src/theme";
import { useActions } from "../../../packages/screen-ui/src/useActions";
import { ScrollList, type ScrollListRow } from "../../../src/shell/ScrollList";
import SoftKeyboard from "../../../src/shell/Keyboard";
import { applyToken, layoutKeys } from "../../../src/shell/keypad";
import { useLocalControl } from "../../shared/useLocalControl";
import { useControlStrings } from "../../shared/controlStrings";
import { commonKeys, shortcuts, lockKeys } from "./commands";
import { TextEntry } from "./TextEntry";

export default function KeyboardApp() {
  const screen = screenSize(), t = useControlStrings();
  const page = shallowRef("home"), draft = shallowRef(""), edit = shallowRef(false), typed = shallowRef(""), mode = shallowRef(0);
  const leds = shallowRef<Record<string, boolean>>({});
  const state = useLocalControl("keyboard", (method, value) => { if (method === "get") {
    if (!value || typeof value !== "object") throw new Error("invalid keyboard state");
    leds.value = (value as { known?: boolean }).known === true ? Object.fromEntries(Object.entries(value).filter(([, flag]) => typeof flag === "boolean")) : {};
  } });
  let lastSystem = "";
  onFrame(() => {
    const raw = device()?.get?.("system") || "";
    if (!raw || raw === lastSystem) return;
    lastSystem = raw;
    try {
      const hid = JSON.parse(raw).hid;
      if (hid) {
        const next = { ...leds.value };
        for (const key of ["num_lock", "caps_lock", "scroll_lock"]) {
          if (!(key in hid)) continue;
          if (typeof hid[key] === "boolean") next[key] = hid[key]; else delete next[key];
        }
        leds.value = next;
      }
    } catch { /* retain last confirmed LEDs */ }
  });
  const commands = computed(() => page.value === "keys" ? commonKeys : page.value === "shortcuts" ? shortcuts : lockKeys);
  const rows = computed<ScrollListRow[]>(() => page.value === "home" ? ["text", "keys", "shortcuts", "locks"].map(id => ({ id, label: t(id), value: "›" })) :
    commands.value.map((command, index) => ({ id: String(index), label: t(command.label), value: command.led ? t(typeof leds.value[command.led] === "boolean" ? leds.value[command.led] ? "on" : "off" : "unknown") : "›" })));
  const board = () => layoutKeys("text", mode.value, screen);
  const repaint = () => device()?.set?.("frameAfter", "16");
  function back() {
    if (edit.value) edit.value = false;
    else if (page.value !== "home") page.value = "home";
    else device()?.set?.("launch", "launcher");
    actions.selected.value = 0; repaint();
  }
  function token(value: string) {
    const next = applyToken(typed.value, value, 256);
    if (next.action === "ok") { draft.value = next.value; edit.value = false; actions.selected.value = 1; }
    else if (next.action === "cancel") { edit.value = false; actions.selected.value = 0; }
    else if (next.action === "mode") { mode.value = (mode.value + 1) % 3; actions.selected.value = 0; }
    else typed.value = next.value;
  }
  const backIndex = () => page.value === "text" ? 3 : rows.value.length + 1;
  const actions = useActions({ count: () => edit.value ? board().caps.length : page.value === "text" ? 4 : rows.value.length + 2,
    onBack: back, onHome: () => device()?.set?.("launch", "shell"),
    enabled: index => edit.value || index === backIndex() || page.value === "home" ||
      (page.value !== "text" && index === rows.value.length ? !state.busy.value : !state.busy.value && !state.stale.value && (page.value !== "text" || index === 0 || !!draft.value)),
    onAction(index) {
      repaint();
      if (edit.value) { token(board().caps[index].token); return; }
      if (index === backIndex()) { back(); return; }
      if (page.value === "text") {
        if (index === 0) { typed.value = draft.value; edit.value = true; mode.value = 0; actions.selected.value = 0; }
        else if (index === 1) state.request("text", { text: draft.value });
        else draft.value = "";
      } else if (index === rows.value.length) state.refresh();
      else if (page.value === "home") { page.value = rows.value[index].id; actions.selected.value = 0; state.message.value = ""; }
      else { const command = commands.value[index]; state.request("press", { modifiers: command.modifiers, keys: command.keys }); }
    },
  });
  const status = () => state.busy.value ? t("busy") : state.message.value ? t(state.message.value) : "";
  return <View class="relative w-full h-full flex flex-col items-center" style={{ width: screen.w, height: screen.h, bgColor: COLOR.black }}>
    <AppHeader width={screen.w} title={page.value === "home" ? t("keyboardTitle") : t(page.value)} selected={!edit.value && actions.selected.value === backIndex()} onBack={back} />
    {page.value === "text" ? <TextEntry width={screen.w} height={screen.h} value={draft.value} busy={state.busy.value || state.stale.value} selected={actions.selected.value}
      message={status()} t={t} onAction={actions.press} /> :
      <ScrollList key={page.value} view={page.value} active={!edit.value} width={screen.w} height={screen.h} rows={rows.value}
        selected={actions.selected.value} status={status()} refresh={t("refresh")} onSelect={actions.press} />}
    <SoftKeyboard open={edit.value} kind="text" mode={mode.value} value={typed.value} secret={false} label={t("text")} focus={actions.selected.value} rotaryFocus
      assets={{ backspace: "assets/backspace.png", enter: "assets/enter.png", space: "assets/space.png" }}
      onFocus={index => { actions.selected.value = index; }} onToken={token} />
  </View>;
}
