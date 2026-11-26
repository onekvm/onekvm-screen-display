import { shallowRef } from "vue";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import type { NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { device, requestPageTransition, screenSize, setHot } from "./device";
import { RecoveryConfirmation, type RecoveryAction } from "./recoveryConfirmation";

export function useRecoveryConfirmation() {
  const machine = new RecoveryConfirmation();
  const action = shallowRef<RecoveryAction | null>(null);
  const remaining = shallowRef(5);
  const progress = shallowRef(0);
  const focus = shallowRef(0); // Cancel is the safe initial rotary choice.
  const status = shallowRef("");
  let holdNode: NodeMirror | null = null;
  let source: "touch" | "rotary" | null = null;
  let wasPressed = false;

  const release = () => {
    machine.release();
    source = null;
    progress.value = 0;
    device()?.set?.("systemHold", "0");
  };
  const cancel = () => {
    if (!action.value || machine.submitted) return;
    release();
    machine.cancel();
    action.value = null;
    device()?.set?.("systemPrepare", "");
    requestPageTransition(-1);
    setHot(true);
  };
  const start = (input: "touch" | "rotary") => {
    if (source || device()?.get?.("systemReady") !== "1" || !machine.startHold(Date.now())) return;
    source = input;
    device()?.set?.("systemHold", "1");
    setHot(true);
  };
  const buttonRect = () => {
    const { w, h } = screenSize();
    return { x: 108, y: h - 60, w: Math.max(40, w - 128), h: 44 };
  };
  createGesture({
    region: { node: () => holdNode, rect: () => action.value ? buttonRect() : null },
    onDown() { start("touch"); },
    onMove(c) {
      const r = buttonRect();
      if (source === "touch" && (Math.abs(c.dx) > 12 || Math.abs(c.dy) > 12 || c.x < r.x || c.x >= r.x + r.w || c.y < r.y || c.y >= r.y + r.h)) release();
    },
    onUp() { if (source === "touch") release(); },
    onCancel() { if (source === "touch") release(); },
  });

  onFrame(() => {
    if (!action.value) return;
    const pressed = device()?.get?.("knobPressed") === "1";
    if (pressed && !wasPressed && focus.value === 1) start("rotary");
    if (!pressed && source === "rotary") release();
    wasPressed = pressed;
    const now = Date.now();
    remaining.value = machine.remaining(now);
    progress.value = machine.progress(now);
    const submit = device()?.get?.("systemHoldReady") === "1" ? machine.submit(now) : null;
    if (submit) {
      status.value = "busy";
      device()?.set?.("systemExecute", submit);
    }
    if (machine.submitted) status.value = device()?.get?.("systemStatus") || status.value;
    setHot(!status.value);
  });

  return {
    action, remaining, progress, focus, status,
    bindHold(node: NodeMirror | null) { holdNode = node; },
    open(next: RecoveryAction) {
      release();
      machine.open(next, Date.now());
      action.value = next;
      remaining.value = 5;
      progress.value = 0;
      focus.value = 0;
      status.value = "";
      wasPressed = device()?.get?.("knobPressed") === "1";
      device()?.set?.("systemPrepare", next);
      requestPageTransition(1);
      setHot(true);
    },
    cancel,
    handleKnob(step: number, click: boolean) {
      if (step && !machine.submitted) {
        release();
        focus.value = Math.max(0, Math.min(1, focus.value + step));
      }
      if (click && (focus.value === 0 || status.value.startsWith("error:"))) {
        // A failed request can be dismissed, but never retried by a click.
        if (status.value.startsWith("error:")) machine.submitted = false;
        cancel();
      }
    },
    dismiss() {
      if (status.value.startsWith("error:")) machine.submitted = false;
      cancel();
    },
  };
}

export type RecoveryControls = ReturnType<typeof useRecoveryConfirmation>;
