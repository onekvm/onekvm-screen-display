import { computed, shallowRef } from "vue";
import { View } from "@pocketjs/framework/vue-vapor/components";
import { AppHeader } from "../../../packages/screen-ui/src/components/AppHeader";
import { device, screenSize } from "../../../packages/screen-ui/src/device";
import { COLOR } from "../../../packages/screen-ui/src/theme";
import { useActions } from "../../../packages/screen-ui/src/useActions";
import { ScrollList, type ScrollListRow } from "../../../src/shell/ScrollList";
import { useLocalControl } from "../../shared/useLocalControl";
import { useControlStrings } from "../../shared/controlStrings";
import { parseSnapshot, parseDirectory, sizeLabel, type Snapshot, type Media, type Source, type Entry, type Kind } from "./model";
import { MediaDetail } from "./MediaDetail";

export default function VirtualMedia() {
  const screen = screenSize(), t = useControlStrings();
  const snapshot = shallowRef<Snapshot>({ status: {}, media: [], sources: [] });
  const view = shallowRef("home"), kind = shallowRef<Kind>("iso");
  const source = shallowRef<Source>(), path = shallowRef("");
  const entries = shallowRef<Entry[]>([]), truncated = shallowRef(false);
  const chosen = shallowRef<Media>();
  const state = useLocalControl("virtual-media", (method, value, payload) => {
    if (method === "get") { snapshot.value = parseSnapshot(value); if (view.value === "folder") browse(); }
    if (method === "browse") {
      if (view.value !== "folder") return;
      if (payload.path !== path.value || payload.extension !== source.value?.extension || payload.directory !== source.value?.directory || payload.kind !== kind.value) { browse(); return; }
      const directory = parseDirectory(value);
      entries.value = directory.entries;
      truncated.value = directory.truncated;
    }
  });
  const mounted = (media: Media) => snapshot.value.status[media.kind === "iso" ? "iso_mounted" : "drive_mounted"] === media.id;
  const rows = computed<ScrollListRow[]>(() => {
    if (view.value === "home") return [
      { id: "iso", label: t("iso"), value: t(snapshot.value.status.iso_mounted ? "mounted" : "empty") },
      { id: "drive", label: t("drive"), value: t(snapshot.value.status.drive_mounted ? "mounted" : "empty") },
      { id: "connection", label: t("connection"), value: t(snapshot.value.status.connected ? "disconnect" : "connect") },
    ];
    if (view.value === "local") {
      const media = snapshot.value.media.filter(item => item.kind === kind.value && !item.external);
      const current = snapshot.value.status[kind.value === "iso" ? "iso_mounted" : "drive_mounted"];
      return [...(current ? [{ id: "mounted", label: t("mounted"), value: t("eject") }] : []),
        ...media.map(item => ({ id: item.id, label: item.name, value: mounted(item) ? t("mounted") : sizeLabel(item.size) })),
        { id: "sources", label: t("sources"), value: String(snapshot.value.sources.length) }];
    }
    if (view.value === "sources") return snapshot.value.sources.map(item => ({ id: `${item.extension}/${item.directory}`, label: item.name, value: item.available ? "›" : t("unavailable") }));
    return [...(path.value ? [{ id: "parent", label: t("parent"), value: ".." }] : []), ...entries.value.map(item => ({ id: `entry:${item.path}`, label: item.name,
      value: item.directory ? t("folder") : item.media && mounted(item.media) ? t("mounted") : sizeLabel(item.media?.size || 0) }))];
  });
  function browse() {
    if (!source.value) return;
    entries.value = []; truncated.value = false;
    state.request("browse", { extension: source.value.extension, directory: source.value.directory, path: path.value, kind: kind.value });
  }
  const repaint = () => device()?.set?.("frameAfter", "16");
  function back() {
    if (chosen.value) chosen.value = undefined;
    else if (view.value === "folder" && path.value) { path.value = path.value.split("/").slice(0, -1).join("/"); browse(); }
    else if (view.value === "folder") view.value = "sources";
    else if (view.value === "sources") view.value = "local";
    else if (view.value === "local") view.value = "home";
    else device()?.set?.("launch", "launcher");
    actions.selected.value = 0; state.message.value = ""; repaint();
  }
  const actions = useActions({ count: () => chosen.value ? 3 : rows.value.length + 2, onBack: back, onHome: () => device()?.set?.("launch", "shell"),
    enabled: index => index === (chosen.value ? 2 : rows.value.length + 1) || !!chosen.value && index === 1 ||
      (!chosen.value && index === rows.value.length ? !state.busy.value : !state.busy.value && !state.stale.value),
    onAction(index) {
      repaint();
      if (chosen.value) {
        if (index !== 0) { back(); return; }
        const item = chosen.value;
        const apply = () => {
          // Back/Cancel during connection must not mount a previously selected image.
          if (chosen.value !== item) return;
          state.request(mounted(item) ? "eject" : "mount", mounted(item) ? { kind: item.kind } : { id: item.id }, () => { if (chosen.value === item) back(); });
        };
        // Core's connect is idempotent; recheck even if another client disconnected USB.
        if (mounted(item)) apply();
        else state.request("connect", {}, apply);
        return;
      }
      if (index === rows.value.length + 1) { back(); return; }
      if (index === rows.value.length) { if (view.value === "folder" && !state.stale.value) browse(); else state.refresh(true); return; }
      const row = rows.value[index];
      state.message.value = "";
      if (view.value === "home") {
        if (row.id === "connection") state.request(snapshot.value.status.connected ? "disconnect" : "connect");
        else { kind.value = row.id as Kind; view.value = "local"; }
      } else if (view.value === "local") {
        if (row.id === "sources") view.value = "sources";
        else if (row.id === "mounted") {
          const id = snapshot.value.status[kind.value === "iso" ? "iso_mounted" : "drive_mounted"]!;
          chosen.value = snapshot.value.media.find(item => item.id === id) || { id, name: t("mounted"), kind: kind.value, size: 0 };
        } else chosen.value = snapshot.value.media.find(item => item.id === row.id);
      } else if (view.value === "sources") {
        const item = snapshot.value.sources.find(item => `${item.extension}/${item.directory}` === row.id);
        if (item?.available) { source.value = item; path.value = ""; view.value = "folder"; browse(); }
      } else if (row.id === "parent") { back(); }
      else {
        const item = entries.value.find(item => `entry:${item.path}` === row.id);
        if (item?.directory) { path.value = item.path; browse(); }
        else if (item?.media) chosen.value = item.media;
      }
      actions.selected.value = 0;
    },
  });
  const title = () => chosen.value ? t("mediaTitle") : view.value === "home" ? t("mediaTitle") : view.value === "sources" ? t("sources") : view.value === "folder" ? (path.value.split("/").pop() || source.value?.name || t("sources")) : t(kind.value);
  const status = () => state.busy.value ? t("busy") : state.message.value ? t(state.message.value) : truncated.value && view.value === "folder" ? t("truncated") : !rows.value.length ? t(view.value === "sources" ? "noSources" : "noImages") : "";
  return <View class="relative w-full h-full flex flex-col items-center" style={{ width: screen.w, height: screen.h, bgColor: COLOR.black }}>
    <AppHeader width={screen.w} title={title()} selected={actions.selected.value === (chosen.value ? 2 : rows.value.length + 1)} onBack={back} />
    {chosen.value ? <MediaDetail width={screen.w} height={screen.h} media={chosen.value} mounted={mounted(chosen.value)} connected={!!snapshot.value.status.connected} busy={state.busy.value || state.stale.value}
      selected={actions.selected.value} message={status()} t={t} onAction={actions.press} /> :
      <ScrollList key={`${view.value}:${kind.value}:${source.value?.extension}:${source.value?.directory}:${path.value}`} view={`${view.value}:${kind.value}:${source.value?.extension}:${source.value?.directory}:${path.value}`} active={!chosen.value}
        width={screen.w} height={screen.h} rows={rows.value} selected={actions.selected.value} status={status()} refresh={t("refresh")} onSelect={actions.press} />}
  </View>;
}
