import { describe, expect, test } from "bun:test";
import { RecoveryConfirmation, RECOVERY_ACTIONS } from "../apps/settings/src/recoveryConfirmation";

describe("recovery safety confirmation", () => {
  for (const action of RECOVERY_ACTIONS) {
    test(`${action}: waits five seconds, then requires a new two-second hold`, () => {
      const c = new RecoveryConfirmation();
      c.open(action, 1000);
      expect(c.remaining(1000)).toBe(5);
      expect(c.startHold(5999)).toBe(false);
      expect(c.submit(9000)).toBe(null);
      expect(c.startHold(9000)).toBe(true);
      expect(c.submit(10999)).toBe(null);
      expect(c.submit(11000)).toBe(action);
      expect(c.submit(12000)).toBe(null);
    });
  }
  test("release and cancel discard progress; reopening restarts the countdown", () => {
    const c = new RecoveryConfirmation();
    c.open("factory-reset", 0);
    c.startHold(5000);
    expect(c.progress(6000)).toBe(0.5);
    c.release();
    expect(c.submit(8000)).toBe(null);
    c.startHold(8000);
    c.cancel();
    expect(c.submit(12000)).toBe(null);
    c.open("recovery", 20000);
    expect(c.startHold(24999)).toBe(false);
    expect(c.remaining(20000)).toBe(5);
  });
});
