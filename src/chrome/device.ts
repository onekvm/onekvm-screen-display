export interface DeviceBridge {
  get?(key: string): string;
  set?(key: string, value: string): void;
}

export function device(): DeviceBridge | undefined {
  return (globalThis as { onekvm?: DeviceBridge }).onekvm;
}

export function setHot(on: boolean) {
  device()?.set?.("hot", on ? "1" : "0");
}

export function screenSize(): { w: number; h: number } {
  const w = Number(device()?.get?.("screenW") || "240");
  const h = Number(device()?.get?.("screenH") || "240");
  return {
    w: Number.isFinite(w) && w >= 64 ? Math.round(w) : 240,
    h: Number.isFinite(h) && h >= 64 ? Math.round(h) : 240,
  };
}
