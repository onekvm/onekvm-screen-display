import { formatClockTime, type ClockFormat } from "../shared/clockFormat";

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
