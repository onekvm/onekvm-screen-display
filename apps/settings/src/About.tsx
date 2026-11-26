import { Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { t, type Lang } from "./i18n";
import { MarqueeText } from "./Marquee";
import { screenSize } from "./device";
import { COLOR, FONT } from "./ui";
import { SETTINGS_ASSETS } from "./assets";

const LIST_W = 200;
const STACK_H = 52;
const COMPACT_ROW_H = 48;
const STATUS_H = 36;
const HERO_H = 116;
const COMPACT_HERO_H = 76;
const SECTION_HEAD = 18;
const SECTION_GAP = 8;
const BOTTOM_INSET = 20;
export type SystemState = {
  machine?: string;
  name?: string;
  variant?: string;
  version?: string;
  uptime_seconds?: number;
  video?: { hdmi_connected?: boolean };
  hid?: { available?: boolean; connected?: boolean };
  network?: {
    hostname?: string;
    ip?: string;
    ethernet_connected?: boolean;
    wifi_available?: boolean;
    wifi_connected?: boolean;
  };
  system?: {
    processor?: string;
    kernel_version?: string;
    memory_total_bytes?: number;
    memory_physical_bytes?: number;
    memory_type?: string;
    storage_total_bytes?: number;
    storage_device_bytes?: number;
    storage_type?: string;
  };
};

export function aboutWidth(): number {
  return Math.max(96, screenSize().w - 40);
}

export function aboutHeight(): number {
  const compact = aboutWidth() < LIST_W;
  const rows = 8 * (compact ? COMPACT_ROW_H : STACK_H) + 4 * STATUS_H;
  return (compactHero() ? COMPACT_HERO_H : HERO_H) + 3 * SECTION_HEAD + rows + 6 * SECTION_GAP + BOTTOM_INSET;
}

function compactHero(): boolean {
  return screenSize().h < 220 || aboutWidth() < LIST_W;
}

export function deviceVariant(s: SystemState): string {
  if (s.name && s.name.trim()) return s.name.trim();
  const raw = (s.machine || "").toLowerCase();
  const machine = raw === "nanokvm" ? "NanoKVM" : raw === "picokvm" ? "PicoKVM" : s.machine || "-";
  if (!s.variant) return machine;
  const n = String(s.variant).toLowerCase();
  const variant = n === "pcie" ? "PCIe" : n === "cube" ? "Cube" : s.variant;
  return `${machine} ${variant}`;
}

export function connectionLabel(connected?: boolean, available = true, lang?: Lang): string {
  if (!available) return t("unavailable", {}, lang);
  return connected ? t("connected", {}, lang) : t("disconnected", {}, lang);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > 1e15) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatStorage(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > 1e16) return "-";
  if (bytes >= 1_000_000_000_000) {
    const tb = bytes / 1_000_000_000_000;
    return `${tb.toFixed(tb >= 10 ? 1 : 2)} TB`;
  }
  const gb = bytes / 1_000_000_000;
  if (gb >= 0.1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return formatBytes(bytes);
}

function formatUptime(totalSeconds: number, lang: Lang): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(t("uptimeDay", { n: days }, lang));
  if (hours || days) parts.push(t("uptimeHour", { n: hours }, lang));
  parts.push(t("uptimeMinute", { n: rest }, lang));
  return parts.join(" ");
}

function Heading(props: { text: string }) {
  return (
    <Text class="text-xs text-zinc-400" style={{ fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>
      {props.text}
    </Text>
  );
}

function SpecRow(props: { label: string; value: string; width: number }) {
  return (
    <View class="flex flex-col justify-center gap-1 px-3" style={{ width: props.width, height: props.width < LIST_W ? COMPACT_ROW_H : STACK_H }}>
      <Text class="text-xs text-zinc-400" style={{ fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>
        {props.label}
      </Text>
      <MarqueeText text={props.value} width={props.width - 24} fontSlot={FONT.sm} textColor={COLOR.white} />
    </View>
  );
}

function StatusRow(props: { label: string; value: string; ok: boolean; width: number }) {
  return (
    <View class="flex flex-row items-center justify-between px-3" style={{ width: props.width, height: STATUS_H }}>
      {props.width < LIST_W ? (
        <MarqueeText text={props.label} width={Math.max(24, (props.width - 48) / 2)} fontSlot={FONT.xs} textColor={COLOR.zinc400} />
      ) : <Text class="text-xs text-zinc-400" style={{ fontSlot: FONT.xs, textColor: COLOR.zinc400 }}>
        {props.label}
      </Text>}
      <View class="flex flex-row items-center gap-2">
        <View class={props.ok ? "w-2 h-2 rounded-full bg-zinc-100" : "w-2 h-2 rounded-full bg-zinc-500"} />
        {props.width < LIST_W ? (
          <MarqueeText text={props.value} width={Math.max(24, (props.width - 48) / 2)} fontSlot={FONT.sm} textColor={props.ok ? COLOR.white : COLOR.zinc400} />
        ) : <Text class="text-sm" style={{ fontSlot: FONT.sm, textColor: props.ok ? COLOR.white : COLOR.zinc400 }}>
          {props.value}
        </Text>}
      </View>
    </View>
  );
}

function GroupTitle(props: { text: string; width: number }) {
  return (
    <View class="px-1" style={{ width: props.width, height: SECTION_HEAD }}>
      <Heading text={props.text} />
    </View>
  );
}

function Hero(props: { name: string; variant: string; lang: Lang; width: number; compact: boolean }) {
  if (props.compact) {
    return (
      <View
        class="flex flex-col justify-center gap-2 px-3 py-2 rounded-xl bg-zinc-800"
        style={{ width: props.width, height: COMPACT_HERO_H }}
      >
        <View class="flex flex-row items-center gap-2" style={{ width: props.width - 24 }}>
          <View class="flex w-6 h-6 rounded-full bg-zinc-500 items-center justify-center">
            <Image class="w-4 h-4" src={SETTINGS_ASSETS.about} />
          </View>
          <MarqueeText text={props.name} width={props.width - 56} fontSlot={FONT.sm} textColor={COLOR.white} />
        </View>
        {props.width < 160 ? (
          <MarqueeText text={props.variant} width={props.width - 24} fontSlot={FONT.xs} textColor={COLOR.zinc400} />
        ) : (
          <View class="flex flex-row items-center justify-between" style={{ width: props.width - 24 }}>
            <MarqueeText text={props.variant} width={props.width - 78} fontSlot={FONT.xs} textColor={COLOR.zinc400} />
            <View class="flex px-2 py-1 rounded-xl bg-zinc-100 items-center justify-center">
              <Text class="text-xs text-zinc-950" style={{ fontSlot: FONT.xs, textColor: COLOR.zinc950 }}>
                {t("online", {}, props.lang)}
              </Text>
            </View>
          </View>
        )}
      </View>
    );
  }
  return (
    <View
      class="flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-zinc-800"
      style={{ width: props.width, height: HERO_H }}
    >
      <View class="flex w-8 h-8 rounded-full bg-zinc-500 items-center justify-center">
        <Image class="w-4 h-4" src={SETTINGS_ASSETS.about} />
      </View>
      <MarqueeText text={props.name} width={props.width - 40} fontSlot={FONT.sm} textColor={COLOR.white} />
      <MarqueeText text={props.variant} width={props.width - 24} fontSlot={FONT.xs} textColor={COLOR.zinc400} />
      <View class="flex px-2 py-1 rounded-xl bg-zinc-100 items-center justify-center">
        <Text class="text-xs text-zinc-950" style={{ fontSlot: FONT.xs, textColor: COLOR.zinc950 }}>
          {t("online", {}, props.lang)}
        </Text>
      </View>
    </View>
  );
}

export function AboutPage(props: { system: SystemState; lang: Lang }) {
  const width = aboutWidth();
  const net = props.system.network || {};
  const sys = props.system.system || {};
  const variant = deviceVariant(props.system);
  const hidOk = props.system.hid?.available !== false && !!props.system.hid?.connected;
  const wifiOk = net.wifi_available !== false && !!net.wifi_connected;
  const lang = props.lang;

  return (
    <View class="flex flex-col items-center gap-2" style={{ width }}>
      <Hero name={net.hostname || "OneKVM"} variant={variant} lang={lang} width={width} compact={compactHero()} />
      <GroupTitle text={t("deviceSpecs", {}, lang)} width={width} />
      <View class="flex flex-col rounded-xl bg-zinc-800" style={{ width }}>
        <SpecRow label={t("processor", {}, lang)} value={sys.processor || "-"} width={width} />
        <SpecRow
          label={t("memory", {}, lang)}
          value={`${formatBytes(sys.memory_physical_bytes || sys.memory_total_bytes || 0)}${sys.memory_type ? ` (${sys.memory_type})` : ""}`}
          width={width}
        />
        <SpecRow
          label={t("storage", {}, lang)}
          value={`${formatStorage(sys.storage_device_bytes || sys.storage_total_bytes || 0)}${sys.storage_type ? ` (${sys.storage_type})` : ""}`}
          width={width}
        />
        <SpecRow label={t("variant", {}, lang)} value={variant} width={width} />
      </View>
      <GroupTitle text={t("osSpecs", {}, lang)} width={width} />
      <View class="flex flex-col rounded-xl bg-zinc-800" style={{ width }}>
        <SpecRow label={t("edition", {}, lang)} value="OneKVM OS" width={width} />
        <SpecRow label={t("version", {}, lang)} value={props.system.version || "-"} width={width} />
        <SpecRow label={t("uptime", {}, lang)} value={formatUptime(props.system.uptime_seconds || 0, lang)} width={width} />
        <SpecRow label={t("kernel", {}, lang)} value={sys.kernel_version || "-"} width={width} />
      </View>
      <GroupTitle text={t("deviceStatus", {}, lang)} width={width} />
      <View class="flex flex-col rounded-xl bg-zinc-800" style={{ width }}>
        <StatusRow
          label={t("hdmiInput", {}, lang)}
          value={connectionLabel(props.system.video?.hdmi_connected, true, lang)}
          ok={!!props.system.video?.hdmi_connected}
          width={width}
        />
        <StatusRow
          label={t("hid", {}, lang)}
          value={connectionLabel(props.system.hid?.connected, props.system.hid?.available !== false, lang)}
          ok={hidOk}
          width={width}
        />
        <StatusRow
          label={t("ethernet", {}, lang)}
          value={connectionLabel(net.ethernet_connected, true, lang)}
          ok={!!net.ethernet_connected}
          width={width}
        />
        <StatusRow
          label={t("wifi", {}, lang)}
          value={connectionLabel(net.wifi_connected, net.wifi_available !== false, lang)}
          ok={wifiOk}
          width={width}
        />
      </View>
      <View style={{ width: 1, height: BOTTOM_INSET - SECTION_GAP }} />
    </View>
  );
}
