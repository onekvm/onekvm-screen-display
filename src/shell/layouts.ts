import { device } from "./device";

export type KeyboardBoard = "nine" | "grid";

/** Welcome: stack is logo above the address. Split puts the logo on the left. */
export type WelcomeArrange = "stack" | "split";

export type MachineLayout = {
  machine: string;
  match: { width: number; height: number };
  keyboard: KeyboardBoard;
  welcome: WelcomeArrange;
  /** Radius of the panel's rounded corners in px; 0 for square corners. */
  corner: number;
};

/** Kept in sync with packaging/onekvm/layouts/*.json. Screen list rows are not per machine. */
export const MACHINE_LAYOUTS: readonly MachineLayout[] = [
  { machine: "picokvm", match: { width: 240, height: 240 }, keyboard: "nine", welcome: "stack", corner: 0 },
  { machine: "nanokvm-pro", match: { width: 172, height: 320 }, keyboard: "grid", welcome: "split", corner: 0 },
  // Go's corner radius is not measured yet; 40 px is the upper bound the layouts allow for.
  { machine: "nanokvm-go", match: { width: 240, height: 284 }, keyboard: "nine", welcome: "stack", corner: 40 },
];

function sameFace(layout: MachineLayout, w: number, h: number): boolean {
  const face = layout.match;
  return (face.width === w && face.height === h) || (face.width === h && face.height === w);
}

/** Distance from both edges at which a point clears a rounded corner of radius `corner`. */
export function cornerInset(corner: number): number {
  return corner > 0 ? Math.ceil(corner * (1 - Math.SQRT1_2)) : 0;
}

export function layoutFor(scr: { w: number; h: number }, machine?: string): MachineLayout {
  const id = machine !== undefined ? machine : device()?.get?.("machine") || "";
  const byId = MACHINE_LAYOUTS.find((layout) => layout.machine === id);
  if (byId) return byId;
  const exact = MACHINE_LAYOUTS.find(
    (layout) => layout.match.width === scr.w && layout.match.height === scr.h,
  );
  if (exact) return exact;
  const turned = MACHINE_LAYOUTS.find((layout) => sameFace(layout, scr.w, scr.h));
  if (turned) return turned;
  return scr.h >= 300 ? MACHINE_LAYOUTS[1] : MACHINE_LAYOUTS[0];
}
