import { formatClockTime, type ClockFormat } from "../shared/clockFormat";
import { DASHBOARD_CLOCK } from "../shared/dashboard";
import { sizedFont, type SizedFont } from "../../packages/screen-ui/src/sizedFont";
import { FONT } from "./ui";

const WEEKDAYS_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;
const WEEKDAYS_ZH_TW = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"] as const;

export function nowParts(lang = "en", format: ClockFormat = "12h", d = new Date()) {
  const sec = d.getSeconds();
  const weekdays = lang === "zh" ? WEEKDAYS_ZH : lang === "zh_tw" ? WEEKDAYS_ZH_TW : WEEKDAYS_EN;
  return {
    ...formatClockTime(d.getHours(), d.getMinutes(), format),
    ss: sec,
    date: `${weekdays[d.getDay()]}  ${d.getDate()}`,
  };
}

export type ClockParts = ReturnType<typeof nowParts>;

/** Characters clock text draws, requested together so a new minute never
 * rasterizes. */
export const CLOCK_CHARS = "0123456789:AMP";

/** Without host rasterization (simulators) clock text uses the baked 16 px
 * slot: Noto Sans CJK's baseline and 0.733 em capitals at 16 px. */
const BAKED_CLOCK_FONT: SizedFont = { slot: FONT.base, lineHeight: 24, baseline: 19, capHeight: 11.728 };

export function clockFont(px: number): SizedFont {
  return sizedFont(px, CLOCK_CHARS) ?? BAKED_CLOCK_FONT;
}

/** A Text box for a short label at `px` that centers its capitals on (x, y). */
export function centeredLabel(x: number, y: number, px: number, font: SizedFont) {
  const width = 4 * px;
  return { insetL: x - width / 2, insetT: y - font.baseline + font.capHeight / 2, width };
}

/** Text boxes for the dashboard clock centered at (x, y). The time starts
 * 1.5 units left of x and AM/PM centers 19.75 units left of x, in 16 px
 * units times `scale`. Capitals and figures center on y. */
export function dashboardClockLayout(x: number, y: number, scale: number, font: SizedFont) {
  const px = DASHBOARD_CLOCK.fontSize * scale;
  return {
    time: { insetL: x + (DASHBOARD_CLOCK.width / 2 - 40.5) * scale, insetT: y - font.baseline + font.capHeight / 2 },
    period: centeredLabel(x + (DASHBOARD_CLOCK.width / 2 - 50.75 - DASHBOARD_CLOCK.periodGap) * scale, y, px, font),
  };
}
