import { shallowRef } from "vue";
import { device, setHot } from "../shell/device";
import { FeedbackModal } from "../shell/FeedbackModal";
import { setupFailureCode, startupDialogCopy } from "./startup-copy";

type Status = { state: string; code: string };
/** Consume the native cache; getters perform no system calls or log collection. */
export function useStartupHealth() {
  const status = shallowRef<Status>({ state: "checking", code: "" });
  const visible = shallowRef(false);
  const focus = shallowRef(1);
  let previous = "";
  let dismissed = "";
  let checkingAt = Date.now();
  let refreshAt = 0;
  const waiting = () => status.value.state === "checking" || status.value.state === "starting";
  const close = () => { dismissed = status.value.code; visible.value = false; };
  const show = () => { visible.value = true; focus.value = 1; };
  const retry = () => {
    dismissed = "";
    previous = "";
    status.value = { state: "checking", code: "" };
    checkingAt = Date.now();
    show();
    device()?.set?.("startupCheck", "1");
    setHot(true);
  };
  const sync = () => {
    const raw = device()?.get?.("startupHealth") || "";
    if (status.value.state === "checking" && Date.now() - checkingAt > 10000) {
      status.value = { state: "error", code: "check-timeout" };
      if (dismissed !== "check-timeout") show();
    }
    if (raw && raw !== previous) {
      previous = raw;
      try {
        const value = JSON.parse(raw) as Status;
        if (!value || typeof value.state !== "string" || typeof value.code !== "string") return;
        if (value.state === "checking") checkingAt = Date.now();
        if (value.state === "starting") refreshAt = Date.now() + 2000;
        status.value = value;
        if (value.state === "ready") { visible.value = false; dismissed = ""; }
        else if (value.code && value.code !== dismissed) show();
      } catch { /* Older hosts have no startup cache. */ }
    }
    // Native service events normally advance the cache. Recheck at low frequency
    // while starting as a fallback, including when consecutive results are equal.
    if (status.value.state === "starting" && Date.now() >= refreshAt) {
      refreshAt = Date.now() + 2000;
      device()?.set?.("startupCheck", "1");
    }
  };
  const acceptError = (raw: string) => {
    const code = setupFailureCode(raw);
    if (!code) return false;
    const state = code === "core-starting" || code === "persistence-starting" ? "starting" : "error";
    if (state === "starting" && status.value.state === "ready") return true;
    if (status.value.code !== code || status.value.state !== state) {
      status.value = { state, code };
      if (state === "starting") refreshAt = Date.now() + 2000;
    }
    if (dismissed !== code && !visible.value) show();
    return true;
  };
  return { status, visible, focus, waiting, close, show, retry, sync, acceptError };
}

export function StartupDialog(props: {
  width: number; height: number; lang: string; code: string; state: string;
  rotary: boolean; focus: number; onRetry: () => void; onClose: () => void;
}) {
  const waiting = () => props.state === "checking" || props.state === "starting";
  const c = () => startupDialogCopy(props.lang, props.state, props.code);
  return <FeedbackModal width={props.width} height={props.height}
    title={c().title} message={c().message}
    busy={waiting()} warning={!waiting()} rotary={props.rotary} focus={props.focus}
    primary={waiting() ? undefined : { label: c().retry, onPress: props.onRetry }}
    secondary={waiting() ? undefined : { label: c().back, onPress: props.onClose }}
    onBackdrop={props.onClose}
  />;
}
