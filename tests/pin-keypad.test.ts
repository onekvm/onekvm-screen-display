import { expect, test } from "bun:test";
import { pinKeypad } from "../apps/settings/src/pinKeypad";

test("PIN keypad keeps feedback and Home strip clear in every screen orientation", () => {
  for (const screen of [{ w: 320, h: 172 }, { w: 172, h: 320 }, { w: 240, h: 240 }]) {
    const caps = pinKeypad(screen);
    expect(caps.map(k => k.token).sort()).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "BS", "OK", "X"]);
    for (const key of caps) {
      expect(key.y).toBeGreaterThanOrEqual(64);
      expect(key.y + key.h).toBeLessThanOrEqual(screen.h - 20);
      expect(key.x + key.w).toBeLessThanOrEqual(screen.w - 12);
    }
  }
});
