export * from "../../../packages/screen-ui/src/device";
import { device } from "../../../packages/screen-ui/src/device";

export function setAxis(x: number, y: number) {
  device()?.set?.("stickX", String(x));
  device()?.set?.("stickY", String(y));
}

export function setButtons(n: number) {
  device()?.set?.("btn", String(n));
}

export function pulseClick(n: number) {
  device()?.set?.("click", String(n));
}
