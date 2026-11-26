export interface DeviceBridge {
  get?(key: string): string;
  set?(key: string, value: string): void;
}

export function device(): DeviceBridge | undefined {
  return (globalThis as { onekvm?: DeviceBridge }).onekvm;
}

/** Tell the screen-display App Shell to show a hint. */
export function showHint(text: string) {
  device()?.set?.("hint", text);
}

export function hideHint() {
  device()?.set?.("hint", "");
}

export function setHot(on: boolean) {
  device()?.set?.("hot", on ? "1" : "0");
}

/** Ask the native host to slide between two cached app frames. */
export function requestPageTransition(direction: 1 | -1) {
  device()?.set?.("appPageTransition", String(direction));
}

/** Ask the native host to animate a cached vertical scroll inside a viewport. */
export function requestScrollTransition(
  direction: 1 | -1,
  distance: number,
  viewport: { y: number; height: number },
  layer?: { node: number; parent: number; offset: number; height: number },
) {
  const y = Math.max(0, Math.round(viewport.y));
  const height = Math.max(0, Math.round(viewport.height));
  const offset = Math.max(0, Math.round(distance));
  if (height <= 0) return;
  const capture = layer ? `:${layer.node}:${layer.parent}:${Math.round(layer.offset)}:${Math.ceil(layer.height)}` : "";
  device()?.set?.("appScrollTransition", `${direction}:${offset}:${y}:${height}${capture}`);
}

/** Ask the native host to animate a bottom drawer from two settled frames. */
export function requestDrawerTransition(opening: boolean, y: number) {
  const top = Math.max(0, Math.round(y));
  device()?.set?.("appDrawerTransition", `${opening ? 1 : 0}:${top}`);
}

export function closeApp() {
  device()?.set?.("launch", "shell");
}

export function screenSize(): { w: number; h: number } {
  const w = Number(device()?.get?.("screenW") || "240");
  const h = Number(device()?.get?.("screenH") || "240");
  return {
    w: Number.isFinite(w) && w >= 64 ? Math.round(w) : 240,
    h: Number.isFinite(h) && h >= 64 ? Math.round(h) : 240,
  };
}
