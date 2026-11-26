import { View } from "@pocketjs/framework/vue-vapor/components";
import { ListRow } from "../../../src/shell/ListRow";
import { OptionRow } from "./Options";
import { t, type Lang, type MessageKey } from "./i18n";
import { hotspotRows, type HotspotDraft, type HotspotRow, type HotspotStatus } from "./hotspot";

const labels: Partial<Record<HotspotRow, MessageKey>> = {
  enabled: "hotspot", ssid: "hotspotName", password: "password", band: "wifiBand",
  channel: "wifiChannel", address: "address", dhcp_start: "dhcpStart", dhcp_end: "dhcpEnd", apply: "apply",
};
export function hotspotLabel(row: HotspotRow, lang: Lang): string {
  return row === "dhcp_enabled" ? "DHCP" : t(labels[row] || "hotspot", {}, lang);
}

export function HotspotSettings(props: {
  status: HotspotStatus | null;
  draft: HotspotDraft | null;
  lang: Lang;
  onPress: (row: HotspotRow) => void;
}) {
  const value = (row: HotspotRow): string => {
    const d = props.draft;
    if (!d) return "";
    if (row === "enabled") return t(props.status?.ap_enabled ? "enabled" : "disabled", {}, props.lang);
    if (row === "password") return d.password ? "********" : t("keepPassword", {}, props.lang);
    if (row === "channel") return d.channel ? String(d.channel) : t("automatic", {}, props.lang);
    if (row === "band") return `${d.band} GHz`;
    if (row === "dhcp_enabled") return t(d.dhcp_enabled ? "enabled" : "disabled", {}, props.lang);
    return row === "apply" ? "" : String(d[row]);
  };
  return <View class="w-full shrink-0 flex flex-col justify-start gap-1">
    {props.draft ? hotspotRows(props.draft).map((row, index) => (
      <OptionRow title={hotspotLabel(row, props.lang)} value={value(row)} rowIndex={index} onPress={() => props.onPress(row)} />
    )) : <ListRow title={t("unavailable", {}, props.lang)} rowIndex={0} />}
  </View>;
}
