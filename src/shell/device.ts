export interface DeviceBridge {
  get?(key: string): string;
  set?(key: string, value: string): void;
}

export function device(): DeviceBridge | undefined {
  return (globalThis as { onekvm?: DeviceBridge }).onekvm;
}

export function appListAuthorized(): boolean {
  return device()?.get?.("appListAuthorized") !== "0";
}

/** Ask before changing local page state or exposing a launcher animation. */
export function requestShellPage(page: number): boolean {
  device()?.set?.("shellPage", page > 0 ? "1" : "0");
  return page <= 0 || appListAuthorized();
}

/** Shell chrome: show a bottom hint on any App. Empty string dismisses. */
export function showHint(text: string) {
  device()?.set?.("hint", text);
}

export function hideHint() {
  device()?.set?.("hint", "");
}

export function setHot(on: boolean) {
  device()?.set?.("hot", on ? "1" : "0");
}

let pageSlide: "guest" | "cached" | false = false;

export function requestPageSlide(direction?: number) {
  pageSlide = direction === undefined ? "guest" : "cached";
  if (direction) device()?.set?.("appPageTransition", direction > 0 ? "1" : "-1");
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

export function takePageSlide(): "guest" | "cached" | false {
  const slide = pageSlide;
  pageSlide = false;
  return slide;
}

export function screenSize(): { w: number; h: number } {
  const w = Number(device()?.get?.("screenW") || "240");
  const h = Number(device()?.get?.("screenH") || "240");
  return {
    w: Number.isFinite(w) && w >= 64 ? Math.round(w) : 240,
    h: Number.isFinite(h) && h >= 64 ? Math.round(h) : 240,
  };
}
