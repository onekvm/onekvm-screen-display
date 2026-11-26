import { computed, shallowRef } from "vue";
import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { AppHeader } from "../../../packages/screen-ui/src/components/AppHeader";
import { ActionBar } from "../../../packages/screen-ui/src/components/ActionBar";
import { device, screenSize } from "../../../packages/screen-ui/src/device";
import { COLOR, FONT } from "../../../packages/screen-ui/src/theme";
import { useActions } from "../../../packages/screen-ui/src/useActions";
import Keyboard from "../../../src/shell/Keyboard";
import { applyToken, layoutKeys } from "../../../src/shell/keypad";
import { useStrings } from "./i18n";
import { activeBans, banFields, fields, fieldText, fieldValue, groups, patchField, readField, type Field, type Group } from "./model";
import { SecurityList, type Row } from "./SecurityList";
import { FieldEditor } from "./FieldEditor";
import { useSecurity } from "./useSecurity";

/** Composition surface: navigation, explicit drafts and shared input routing. */
export default function Security() {
  const screen = screenSize();
  const t = useStrings();
  const state = useSecurity();
  const group = shallowRef<Group | "">("");
  const editor = shallowRef<{ field: Field; original: string; target: "setting" | "ban" }>();
  const draft = shallowRef("");
  const keyboard = shallowRef(false);
  const mode = shallowRef(0);
  const keyText = shallowRef("");
  const banId = shallowRef("");
  const adding = shallowRef(false);
  const banDraft = shallowRef<Record<string, unknown>>({ address: "", reason: "Local screen", duration: 3600 });
  const bans = computed(() => activeBans(state.snapshot.value?.bans || []));
  const ban = computed(() => bans.value.find(item => item.id === banId.value));
  const format = (value: unknown) => typeof value === "boolean" || value === "true" || value === "false" ? t(value === true || value === "true" ? "on" : "off") :
    typeof value === "string" && ["ip", "subnet", "sameorigin", "deny", "off"].includes(value) ? t(value) : fieldText(value);
  const shorten = (value: string, max = 11) => value.length > max ? value.slice(0, max - 1) + "…" : value;
  const rows = computed<Row[]>(() => {
    if (!group.value) return groups.map(id => ({ id, label: t(id), value: id === "bans" ? String(bans.value.length) : "›" }));
    if (adding.value) return [...banFields.map(field => ({ id: field.key, label: t(field.label), value: shorten(fieldText(banDraft.value[field.key])) })), { id: "save", label: t("add"), value: "›" }];
    if (group.value === "bans") return [{ id: "add", label: t("add"), value: "+" }, ...bans.value.map(item => ({ id: item.id, label: item.address, value: item.source }))];
    return fields[group.value].map(field => ({ id: field.key, label: t(field.label), value: state.snapshot.value ? shorten(format(readField(state.snapshot.value.settings, field.key))) : "–" }));
  });
  const board = () => layoutKeys(editor.value?.field.kind === "number" ? "number" : "text", mode.value, screen);
  const repaint = () => device()?.set?.("frameAfter", "16");
  function back() {
    if (keyboard.value) keyboard.value = false;
    else if (editor.value) editor.value = undefined;
    else if (banId.value) banId.value = "";
    else if (adding.value) adding.value = false;
    else if (group.value) group.value = "";
    else device()?.set?.("launch", "launcher");
    actions.selected.value = 0;
    repaint();
  }
  function token(value: string) {
    const next = applyToken(keyText.value, value, editor.value?.field.key.endsWith("trusted_proxies") ? 3072 : 512);
    if (next.action === "ok") { draft.value = next.value; keyboard.value = false; actions.selected.value = 1; }
    else if (next.action === "cancel") { keyboard.value = false; actions.selected.value = 0; }
    else if (next.action === "mode") { mode.value = (mode.value + 1) % 3; actions.selected.value = 0; }
    else keyText.value = next.value;
  }
  function editAction(index: number) {
    const edit = editor.value!;
    const field = edit.field;
    if (index === 2) { back(); return; }
    if (index === 0) {
      if (field.kind === "boolean") draft.value = draft.value === "true" ? "false" : "true";
      else if (field.kind === "choice") draft.value = field.choices![(field.choices!.indexOf(draft.value) + 1) % field.choices!.length];
      else { keyText.value = draft.value; keyboard.value = true; mode.value = 0; actions.selected.value = 0; }
    } else {
      try {
        const value = fieldValue(field, draft.value);
        if (edit.target === "ban") { banDraft.value = { ...banDraft.value, [field.key]: value }; back(); }
        else state.request("save", patchField(field, draft.value), () => { if (editor.value === edit) back(); });
      } catch { state.message.value = "invalid"; }
    }
  }
  function openField(field: Field, value: unknown, target: "setting" | "ban") {
    editor.value = { field, original: fieldText(value), target }; draft.value = fieldText(value);
    actions.selected.value = 0; state.message.value = "";
  }
  const enabled = (index: number) => {
    if (keyboard.value || index === (editor.value ? 2 : banId.value ? 1 : rows.value.length + 1)) return true;
    if (!editor.value && !banId.value) {
      if (index === rows.value.length) return !state.busy.value;
      // Loading must not move the cursor to Back while the user is scrolling.
      return !adding.value || rows.value[index]?.id !== "save" || !state.busy.value && !state.stale.value;
    }
    return !state.busy.value && !state.stale.value && (!editor.value || index !== 1 || draft.value !== editor.value.original);
  };
  const actions = useActions({ count: () => keyboard.value ? board().caps.length : editor.value ? 3 : banId.value ? 2 : rows.value.length + 2,
    enabled, onBack: back, onHome: () => device()?.set?.("launch", "shell"),
    onAction(index) {
      repaint();
      if (keyboard.value) { token(board().caps[index].token); return; }
      if (editor.value) { editAction(index); return; }
      if (banId.value) { if (index === 1) back(); else if (ban.value) { const id = ban.value.id; state.request("remove-ban", { id }, () => { if (banId.value === id) back(); }); } return; }
      if (index === rows.value.length + 1) { back(); return; }
      if (index === rows.value.length) { state.refresh(); return; }
      const row = rows.value[index];
      if (!group.value) { group.value = row.id as Group; actions.selected.value = 0; state.message.value = ""; if (row.id === "bans") state.refresh(); }
      else if (adding.value) {
        if (row.id === "save") {
          if (!fieldText(banDraft.value.address).trim()) { state.message.value = "invalid"; return; }
          const seconds = Number(banDraft.value.duration);
          state.request("add-ban", { address: banDraft.value.address, reason: banDraft.value.reason, expires_at: seconds ? Math.floor(Date.now() / 1000) + seconds : null }, () => { if (adding.value) back(); });
        } else { const field = banFields[index]; openField(field, banDraft.value[field.key], "ban"); }
      } else if (group.value === "bans") {
        if (row.id === "add") { adding.value = true; banDraft.value = { address: "", reason: "Local screen", duration: 3600 }; }
        else { banId.value = row.id; actions.selected.value = 1; }
      } else if (!state.stale.value && state.snapshot.value) {
        const field = fields[group.value][index]; openField(field, readField(state.snapshot.value.settings, field.key), "setting");
      }
    },
  });
  const hint = () => editor.value?.field.kind === "number" ? `${editor.value.field.min}–${editor.value.field.max}${editor.value.target === "ban" ? ` · ${t("zero")}` : ""}` :
    editor.value?.field.key.endsWith("trusted_proxies") ? t("listHint") : editor.value?.field.key === "honeypot_enabled" ? t("apiNeeded") : "";
  const title = computed(() => editor.value ? t(editor.value.field.label) : adding.value ? t("addTitle") : group.value ? t(group.value) : t("title"));
  const status = () => state.busy.value ? t("busy") : state.message.value ? t(state.message.value) : state.stale.value ? t("retry") : "";
  return <View class="relative w-full h-full flex flex-col items-center" style={{ width: screen.w, height: screen.h, bgColor: COLOR.black }}>
    <AppHeader width={screen.w} title={title.value} selected={actions.selected.value === (editor.value ? 2 : banId.value ? 1 : rows.value.length + 1)} onBack={back} />
    {editor.value ? <>
      <FieldEditor width={screen.w} height={screen.h} field={editor.value.field} value={draft.value} hint={hint()} selected={actions.selected.value}
        disabled={state.busy.value || state.stale.value} dirty={draft.value !== editor.value.original} t={t} format={format} onAction={actions.press} />
      <Text class="text-xs" style={{ height: 22, fontSlot: FONT.xs, textColor: COLOR.warning }}>{status()}</Text>
    </> : banId.value ? <>
      <View class="flex flex-col items-center justify-center" style={{ width: screen.w - 24, height: screen.h - 116 }}>
        <Text class="text-sm" style={{ width: screen.w - 24, fontSlot: FONT.sm, textColor: COLOR.white }}>{ban.value?.address || t("empty")}</Text>
        <Text class="text-xs" style={{ width: screen.w - 24, fontSlot: FONT.xs, textColor: COLOR.muted }}>{ban.value ? shorten(ban.value.reason || ban.value.source, 36) : ""}</Text>
        {screen.h >= 220 ? <Text class="text-xs" style={{ width: screen.w - 24, fontSlot: FONT.xs, textColor: COLOR.muted }}>{ban.value?.expires_at ? new Date(ban.value.expires_at * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : t("never")}</Text> : null}
      </View>
      <ActionBar width={screen.w} selected={actions.selected.value} onAction={actions.press} actions={[{ id: "unblock", label: t("unblock"), disabled: state.busy.value || state.stale.value || !ban.value }, { id: "back", label: t("back") }]} />
      <Text class="text-xs" style={{ height: 22, fontSlot: FONT.xs, textColor: COLOR.warning }}>{status()}</Text>
    </> : <SecurityList key={`${group.value}:${adding.value}`} view={`${group.value}:${adding.value}`} active={!editor.value && !banId.value}
      width={screen.w} height={screen.h} rows={rows.value} selected={actions.selected.value}
      status={status()} refresh={t("refresh")} onSelect={actions.press} />}
    <Keyboard open={keyboard.value} kind={editor.value?.field.kind === "number" ? "number" : "text"} mode={mode.value} value={keyText.value}
      secret={false} label={title.value} focus={actions.selected.value} rotaryFocus assets={{ backspace: "assets/backspace.png", enter: "assets/enter.png", space: "assets/space.png" }}
      onFocus={index => { actions.selected.value = index; }} onToken={token} />
  </View>;
}
