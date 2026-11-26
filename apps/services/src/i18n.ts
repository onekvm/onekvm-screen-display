import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { readLang, type Lang } from "../../../packages/screen-ui/src/i18n";

const en = {
  title: "Services", start: "Start", stop: "Stop", restart: "Restart", refresh: "Refresh",
  running: "Running", stopped: "Stopped", busy: "Working…", empty: "No services",
  readFailed: "Load failed", failed: "Operation failed", timedOut: "Timed out",
  unavailable: "Core unavailable", denied: "Operation unavailable", readOnly: "View only",
  started: "Service started", stoppedDone: "Service stopped", restarted: "Service restarted",
  missing: "Service unavailable", bootOn: "Start at boot: on", bootOff: "Start at boot: off",
  coreName: "OneKVM server", timeName: "Time synchronization", watchdogName: "Watchdog",
};
type Key = keyof typeof en;
const packs: Record<Lang, Record<Key, string>> = { en, zh: {
  title: "服务", start: "启动", stop: "停止", restart: "重启", refresh: "刷新",
  running: "运行中", stopped: "已停止", busy: "处理中…", empty: "暂无服务",
  readFailed: "读取服务失败", failed: "操作失败", timedOut: "操作超时，请刷新",
  unavailable: "核心服务不可用", denied: "不支持此操作", readOnly: "仅查看",
  started: "服务已启动", stoppedDone: "服务已停止", restarted: "服务已重启",
  missing: "服务不可用", bootOn: "开机启动：开", bootOff: "开机启动：关",
  coreName: "OneKVM 服务", timeName: "时间同步", watchdogName: "看门狗",
}, zh_tw: {
  title: "服務", start: "啟動", stop: "停止", restart: "重新啟動", refresh: "重新整理",
  running: "執行中", stopped: "已停止", busy: "處理中…", empty: "暫無服務",
  readFailed: "讀取服務失敗", failed: "操作失敗", timedOut: "操作逾時，請重試",
  unavailable: "核心服務無法使用", denied: "不支援此操作", readOnly: "僅檢視",
  started: "服務已啟動", stoppedDone: "服務已停止", restarted: "服務已重新啟動",
  missing: "服務無法使用", bootOn: "開機啟動：開", bootOff: "開機啟動：關",
  coreName: "OneKVM 服務", timeName: "時間同步", watchdogName: "看門狗",
} };
export function useStrings() {
  const language = shallowRef(readLang());
  onFrame(() => { language.value = readLang(); });
  return (key: Key): string => packs[language.value][key];
}
export type Message = Key | "";

export function errorMessage(error: string): Key {
  if (/timed?\s*out|timeout|NoReply/i.test(error)) return "timedOut";
  if (/not manageable|denied|unsupported/i.test(error)) return "denied";
  if (/ServiceUnknown|NameHasNoOwner|UnknownMethod|bus.*connect/i.test(error)) return "unavailable";
  return "failed";
}
