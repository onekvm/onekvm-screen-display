import { shallowRef } from "vue";
import { device, setHot } from "../shell/device";
import { FeedbackModal } from "../shell/FeedbackModal";

type State = "confirm" | "checking" | "starting" | "stopping" | "on" | "off" | "error";
export function useAdbDebug() {
  const visible = shallowRef(false);
  const state = shallowRef<State>("confirm");
  const focus = shallowRef(0);
  let previous = "";
  let requested: boolean | undefined;
  let deadline = 0;
  const busy = () => ["checking", "starting", "stopping"].includes(state.value);
  const request = (enabled?: boolean) => {
    requested = enabled;
    previous = "";
    deadline = Date.now() + 30000;
    state.value = enabled === undefined ? "checking" : enabled ? "starting" : "stopping";
    device()?.set?.(enabled === undefined ? "adbDebugRefresh" : "adbDebugSet", enabled === false ? "0" : "1");
    setHot(true);
  };
  const open = () => { visible.value = true; focus.value = 0; request(); };
  const close = () => { if (!busy()) visible.value = false; };
  const sync = () => {
    if (!visible.value) return;
    if (busy() && Date.now() > deadline) { state.value = "error"; return; }
    const raw = device()?.get?.("adbDebugStatus") || "";
    if (!raw || raw === previous) return;
    previous = raw;
    try {
      const status = JSON.parse(raw).state;
      if (status === "off") state.value = requested === false ? "off" : "confirm";
      else if (status === "on" || status === "error") state.value = status;
      else return;
      focus.value = state.value === "confirm" ? 0 : state.value === "on" ? 1 : 0;
    } catch { state.value = "error"; }
  };
  const primary = () => {
    if (state.value === "on" || state.value === "off") close();
    else request(state.value === "error" && requested === false ? false : true);
  };
  const secondary = () => { if (state.value === "on") request(false); else close(); };
  return { visible, state, focus, busy, open, close, sync, primary, secondary };
}

export function AdbDialog(props: {
  width: number; height: number; lang: string; state: State;
  rotary: boolean; focus: number; onPrimary: () => void; onSecondary: () => void; onClose: () => void;
}) {
  const c = () => props.lang === "zh" ? {
    title: "USB ADB 调试", confirm: "是否开启 USB ADB 调试？\nUSB 将重新连接，重启后关闭\n调试期间暂停自动重启",
    checking: "正在检查 USB ADB 状态…", starting: "正在开启 USB ADB…", stopping: "正在关闭 USB ADB…",
    on: "USB ADB 已开启", off: "USB ADB 已关闭", connection: "在 USB 连接的电脑上运行：\nadb devices",
    error: "USB ADB 操作失败", failed: "请重试或导出诊断查看详情",
    enable: "开启", disable: "关闭 ADB", cancel: "取消", ok: "确定", retry: "重试",
  } : props.lang === "zh_tw" ? {
    title: "USB ADB 偵錯", confirm: "是否開啟 USB ADB 偵錯？\nUSB 將重新連線，重啟後關閉\n偵錯期間暫停自動重啟",
    checking: "正在檢查 USB ADB 狀態…", starting: "正在開啟 USB ADB…", stopping: "正在關閉 USB ADB…",
    on: "USB ADB 已開啟", off: "USB ADB 已關閉", connection: "在 USB 連線的電腦上執行：\nadb devices",
    error: "USB ADB 操作失敗", failed: "請重試或匯出診斷查看詳情",
    enable: "開啟", disable: "關閉 ADB", cancel: "取消", ok: "確定", retry: "重試",
  } : {
    title: "USB ADB debugging", confirm: "Enable USB debugging?\nUSB reconnects; off after reboot.\nAutomatic recovery is paused.",
    checking: "Checking USB ADB…", starting: "Enabling USB ADB…", stopping: "Disabling USB ADB…",
    on: "USB ADB is enabled", off: "USB ADB is disabled", connection: "On the connected USB host, run:\nadb devices",
    error: "USB ADB operation failed", failed: "Retry or export diagnostics for details.",
    enable: "Enable", disable: "Disable ADB", cancel: "Cancel", ok: "OK", retry: "Retry",
  };
  const busy = () => ["checking", "starting", "stopping"].includes(props.state);
  const title = () => props.state === "on" ? c().on : props.state === "off" ? c().off : props.state === "error" ? c().error : c().title;
  const message = () => props.state === "confirm" ? c().confirm : props.state === "on" ? c().connection
    : props.state === "error" ? c().failed : props.state === "off" ? undefined : c()[props.state as "checking" | "starting" | "stopping"];
  return <FeedbackModal width={props.width} height={props.height} title={title()} message={message()}
    busy={busy()} rotary={props.rotary} focus={props.focus} warning={props.state === "confirm" || props.state === "error"}
    primary={busy() ? undefined : { label: props.state === "on" || props.state === "off" ? c().ok : props.state === "error" ? c().retry : c().enable, onPress: props.onPrimary }}
    secondary={busy() || props.state === "off" ? undefined : { label: props.state === "on" ? c().disable : c().cancel, onPress: props.onSecondary }}
    onBackdrop={props.onClose} />;
}
