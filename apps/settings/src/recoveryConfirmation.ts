export const RECOVERY_ACTIONS = ["reboot", "factory-reset", "recovery"] as const;
export type RecoveryAction = typeof RECOVERY_ACTIONS[number];
export const RECOVERY_WAIT_MS = 5000;
export const RECOVERY_HOLD_MS = 2000;

/** Wall-clock deadlines: a slow screen must not stretch a safety timer. */
export class RecoveryConfirmation {
  action: RecoveryAction | null = null;
  readyAt = 0;
  holdingAt: number | null = null;
  submitted = false;

  open(action: RecoveryAction, now: number) {
    this.action = action;
    this.readyAt = now + RECOVERY_WAIT_MS;
    this.holdingAt = null;
    this.submitted = false;
  }

  cancel() {
    this.action = null;
    this.holdingAt = null;
  }

  remaining(now: number) {
    return Math.max(0, Math.ceil((this.readyAt - now) / 1000));
  }

  startHold(now: number): boolean {
    if (!this.action || this.submitted || now < this.readyAt || this.holdingAt !== null) return false;
    this.holdingAt = now;
    return true;
  }

  release() { this.holdingAt = null; }

  progress(now: number) {
    return this.holdingAt === null ? 0 : Math.max(0, Math.min(1, (now - this.holdingAt) / RECOVERY_HOLD_MS));
  }

  submit(now: number): RecoveryAction | null {
    if (!this.action || this.submitted || this.progress(now) < 1) return null;
    this.submitted = true;
    return this.action;
  }
}
