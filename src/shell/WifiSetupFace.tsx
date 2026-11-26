import { Text, View } from "@pocketjs/framework/vue-vapor/components";
import { screenSize } from "./device";
import { FONT } from "./ui";

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

// Keep credentials readable on the Pro landscape panel, including long SSIDs.
function lines(text: string, width: number): string[] {
  const result: string[] = [];
  let line = "", used = 0;
  for (const char of text) {
    const advance = char.codePointAt(0)! > 127 ? 12 : 7;
    if (line && used + advance > width) { result.push(line); line = ""; used = 0; }
    line += char; used += advance;
  }
  if (line) result.push(line);
  return result;
}

export function WifiSetupFace(props: { setup: WifiSetup; lang: string; width?: number; height?: number }) {
  const screen = screenSize();
  const scr = { w: props.width || screen.w, h: props.height || screen.h };
  const landscape = scr.w > scr.h;
  const squareRows = lines(props.setup.ssid, scr.w - 26).length + lines(props.setup.password, scr.w - 26).length;
  const available = landscape ? Math.min(scr.h - 24, scr.w * 0.46) : Math.min(scr.w - 24, scr.h - 75 - squareRows * 14);
  const moduleSize = Math.max(1, Math.floor(available / (props.setup.size + 8)));
  const qrSize = moduleSize * (props.setup.size + 8);
  const left = landscape ? 12 : Math.round((scr.w - qrSize) / 2);
  const top = landscape ? Math.round((scr.h - qrSize) / 2) : 28;
  const textX = landscape ? left + qrSize + 12 : 14;
  const textW = scr.w - textX - 12;
  const title = props.lang === "zh" ? "扫码连接" : props.lang === "zh_tw" ? "掃碼連線" : "Scan to connect";
  const ssid = lines(props.setup.ssid, textW);
  const password = lines(props.setup.password, textW);
  const textY = landscape ? Math.max(8, Math.round((scr.h - (ssid.length + password.length + 4) * 14) / 2)) : top + qrSize + 6;
  return <View class="absolute w-full h-full overflow-hidden" style={{ bgColor: "#071827" }}>
    <View class="absolute" style={{ insetL: left, insetT: top, width: qrSize, height: qrSize, bgColor: "#ffffff" }}>
      {props.setup.runs.map(([x, y, width]) => <View class="absolute" style={{
        insetL: (x + 4) * moduleSize, insetT: (y + 4) * moduleSize,
        width: width * moduleSize, height: moduleSize, bgColor: "#071827",
      }} />)}
    </View>
    <Text class="absolute text-sm font-bold" style={{ insetL: landscape ? textX : 14, insetT: landscape ? textY : 6, fontSlot: FONT.sm, textColor: "#f3f8ff" }}>{title}</Text>
    <Text class="absolute text-xs" style={{ insetL: textX, insetT: textY + (landscape ? 20 : 0), fontSlot: FONT.xs, textColor: "#a9dcff" }}>Wi-Fi</Text>
    {ssid.map((line, index) => <Text class="absolute text-xs font-bold" style={{ insetL: textX, insetT: textY + (landscape ? 34 : 14) + index * 14, fontSlot: FONT.xs, textColor: "#f3f8ff" }}>{line}</Text>)}
    <Text class="absolute text-xs" style={{ insetL: textX, insetT: textY + (landscape ? 38 : 18) + ssid.length * 14, fontSlot: FONT.xs, textColor: "#a9dcff" }}>{props.lang === "zh" ? "密码" : props.lang === "zh_tw" ? "密碼" : "Password"}</Text>
    {password.map((line, index) => <Text class="absolute text-xs" style={{ insetL: textX, insetT: textY + (landscape ? 52 : 32) + (ssid.length + index) * 14, fontSlot: FONT.xs, textColor: "#f3f8ff" }}>{line}</Text>)}
  </View>;
}
