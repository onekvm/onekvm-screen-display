/** Settle a page drag from the last displayed position, never its old origin. */
export function settleTouchScroll(
  start: number, current: number, dy: number, velocity: number, viewport: number, minimum: number,
): number {
  const step = Math.max(48, viewport - 28);
  let target = current;
  if (dy <= -28 || (dy < 0 && velocity <= -380)) target = Math.min(current, start - step);
  else if (dy >= 28 || (dy > 0 && velocity >= 380)) target = Math.max(current, start + step);
  return Math.max(minimum, Math.min(0, target));
}
