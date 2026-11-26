import { shallowRef } from "vue";
import { device } from "./device";
import { hotspotChannels, hotspotDraft, parseHotspot, type HotspotDraft, type HotspotField } from "./hotspot";

/** Live state and an explicit edit draft: background updates never erase edits. */
export function useHotspot() {
  const status = shallowRef(parseHotspot(device()?.get?.("wifiAp") || ""));
  const draft = shallowRef<HotspotDraft | null>(null);
  let raw = "";
  let entering = false;
  function sync() {
    const next = device()?.get?.("wifiAp") || "";
    if (next === raw) return;
    raw = next;
    status.value = parseHotspot(next);
    if (status.value && (entering || !draft.value)) {
      draft.value = hotspotDraft(status.value);
      entering = false;
    }
  }
  function open() {
    sync();
    draft.value = status.value ? hotspotDraft(status.value) : null;
    entering = true;
    device()?.set?.("wifiApRefresh", "1");
  }
  function edit(field: HotspotField, value: string | number | boolean) {
    if (!draft.value) return;
    entering = false;
    const next = { ...draft.value, [field]: value };
    if (field === "band" && !hotspotChannels(status.value, String(value)).includes(next.channel)) next.channel = 0;
    draft.value = next;
  }
  return { status, draft, sync, open, edit };
}
