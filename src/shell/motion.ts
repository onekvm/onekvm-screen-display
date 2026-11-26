/** Motion timings shared by the Shell and bundled screen apps. */
export const PAGE_SLIDE_MS = 280;
// Rotary list reveals should settle within one deliberate detent. Keeping
// this in the same window as the settings host compositor avoids the launcher
// feeling slower than the settings list.
export const PAGE_SCROLL_MS = 80;
export const DRAWER_EXIT_MS = 128;

// A guest frame on the Pro panel includes a JS/raster pass and can take much
// longer than the nominal 16 ms display tick. Holding the guest hot for a
// nominal 60 Hz frame count therefore stretches a short rotary move into
// hundreds of milliseconds. The native compositor keeps ticking while its
// cached transition is active, so only a few guest frames are needed to settle
// the cursor/highlight state.
export const INPUT_HOLD_FRAMES = 3;

export function animationFrames(duration: number): number {
  return Math.ceil(duration / (1000 / 60)) + 2;
}
