import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { screenSize } from "../shell/device";
import { AP_QUIET, apFaceLayout, estimateText } from "./flow";

export interface WifiSetup {
  ssid: string;
  password: string;
  size: number;
  runs: [number, number, number][];
}

export function parseWifiSetup(raw: string): WifiSetup | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as WifiSetup;
    if (!value.ssid || value.ssid.length > 32 || value.ssid.split("").some((ch) => ch.charCodeAt(0) < 32)) return null;
    if (!value.password || value.password.length < 8 || value.password.length > 63) return null;
    if (!Number.isInteger(value.size) || value.size < 21 || value.size > 61 || !Array.isArray(value.runs)) return null;
    return value;
  } catch {
    return null;
  }
}

const INK = "#071827";
const TEXT = "#f3f8ff";
const LABEL = "#a9dcff";

/** Baked atlas widths; the estimate covers hosts without text measurement. */
function measure(text: string, slot: number): number {
  const ui = (globalThis as { ui?: { measureText?: (text: string, slot: number) => number } }).ui;
  const width = ui?.measureText?.(text, slot);
  return typeof width === "number" && Number.isFinite(width) && width > 0 ? width : estimateText(text, slot);
}

/** `bottom` stays free for the welcome page dots. */
export function WifiSetupFace(props: { setup: WifiSetup; lang: string; width?: number; height?: number; bottom?: number }) {
  const screen = screenSize();
  const scr = { w: props.width || screen.w, h: props.height || screen.h };
  const zh = props.lang === "zh";
  const tw = props.lang === "zh_tw";
  const lay = apFaceLayout(scr, props.setup.size, {
    title: zh ? "扫码连接" : tw ? "掃碼連線" : "Scan to connect",
    ssidLabel: "Wi-Fi",
    passwordLabel: zh ? "密码" : tw ? "密碼" : "Password",
    ssid: props.setup.ssid,
    password: props.setup.password,
  }, measure, props.bottom || 0);
  const module = lay.qr.module;
  return <View class="absolute w-full h-full overflow-hidden" style={{ bgColor: INK }}>
    <View class="absolute" style={{ insetL: lay.qr.x, insetT: lay.qr.y, width: lay.qr.size, height: lay.qr.size, bgColor: "#ffffff" }}>
      {props.setup.runs.map(([x, y, width]) => <View class="absolute" style={{
        insetL: (x + AP_QUIET) * module, insetT: (y + AP_QUIET) * module,
        width: width * module, height: module, bgColor: INK,
      }} />)}
    </View>
    {lay.lines.map((line) => line.tone === "title"
      ? <Text class="absolute text-sm font-bold" style={{ insetL: line.x, insetT: line.y, fontSlot: line.slot, textColor: TEXT }}>{line.text}</Text>
      : <Text class="absolute text-xs" style={{ insetL: line.x, insetT: line.y, fontSlot: line.slot, textColor: line.tone === "label" ? LABEL : TEXT }}>{line.text}</Text>)}
  </View>;
}
