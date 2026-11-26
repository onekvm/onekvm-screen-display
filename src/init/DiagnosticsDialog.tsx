import { FeedbackModal } from "../shell/FeedbackModal";

export type DiagnosticsState = "confirm" | "queued" | "running" | "done" | "error";

export function diagnosticsCopy(lang: string) {
  if (lang === "zh") return {
    title: "导出诊断", confirm: "将诊断日志保存到 SD 卡", start: "导出", cancel: "取消",
    busy: "正在收集诊断日志…", done: "导出完成", saved: "已保存到 SD 卡：\nonekvm-diagnostics.zip",
    error: "导出失败", failed: "请稍后重试", boot: "无法写入 SD 卡引导分区", occupied: "已有诊断任务正在运行",
    close: "确定", retry: "重试",
  };
  if (lang === "zh_tw") return {
    title: "匯出診斷", confirm: "將診斷日誌儲存至 SD 卡", start: "匯出", cancel: "取消",
    busy: "正在收集診斷日誌…", done: "匯出完成", saved: "已儲存至 SD 卡：\nonekvm-diagnostics.zip",
    error: "匯出失敗", failed: "請稍後重試", boot: "無法寫入 SD 卡開機分割區", occupied: "已有診斷工作正在執行",
    close: "確定", retry: "重試",
  };
  return {
    title: "Export diagnostics", confirm: "Save diagnostic logs to the SD card", start: "Export", cancel: "Cancel",
    busy: "Collecting diagnostic logs…", done: "Export complete", saved: "Saved to the SD card:\nonekvm-diagnostics.zip",
    error: "Export failed", failed: "Please try again", boot: "Cannot write the SD boot partition", occupied: "Diagnostics are already running",
    close: "OK", retry: "Retry",
  };
}

/** Reuses the setup feedback dialog; owns presentation, not the job. */
export function DiagnosticsDialog(props: {
  width: number; height: number; lang: string; state: DiagnosticsState; error: string;
  rotary: boolean; focus: number; onStart: () => void; onClose: () => void;
}) {
  const c = () => diagnosticsCopy(props.lang);
  const busy = () => props.state === "queued" || props.state === "running";
  const message = () => props.state === "done" ? c().saved
    : props.state === "error" ? (props.error === "boot-unavailable" ? c().boot : props.error === "busy" ? c().occupied : c().failed)
    : props.state === "confirm" ? c().confirm : c().busy;
  return <FeedbackModal
    width={props.width} height={props.height} busy={busy()}
    title={props.state === "done" ? c().done : props.state === "error" ? c().error : c().title}
    message={message()} warning={props.state === "error"}
    rotary={props.rotary} focus={props.focus}
    primary={busy() ? undefined : props.state === "done"
      ? { label: c().close, onPress: props.onClose }
      : { label: props.state === "error" ? c().retry : c().start, onPress: props.onStart }}
    secondary={busy() || props.state === "done" ? undefined : { label: c().cancel, onPress: props.onClose }}
    onBackdrop={props.onClose}
  />;
}

/** Five consecutive logo presses within three seconds; no permanent timer. */
export class DiagnosticsTapSequence {
  private count = 0;
  private started = 0;
  press(now: number): boolean {
    if (this.count === 0 || now - this.started > 3000 || now < this.started) {
      this.count = 0;
      this.started = now;
    }
    this.count += 1;
    if (this.count < 5) return false;
    this.count = 0;
    return true;
  }
}
