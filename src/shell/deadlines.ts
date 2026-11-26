export function nextShellDelay(now: number, clockVisible: boolean, secondsVisible: boolean, rotationAt = Infinity): number {
  const period = secondsVisible ? 1000 : 60_000;
  const clockAt = clockVisible ? now + period - ((now % period + period) % period) : Infinity;
  const next = Math.min(clockAt, rotationAt);
  return Number.isFinite(next) ? Math.max(1, next - now) : 0;
}
