import { describe, expect, test } from "bun:test";
import { settleTouchScroll } from "../src/shared/touchScroll";

describe("touch page settling", () => {
  test("continues from the finger instead of the original page", () => {
    expect(settleTouchScroll(0, -60, -60, -500, 150, -500)).toBe(-122);
    expect(settleTouchScroll(-200, -140, 60, 500, 150, -500)).toBe(-78);
  });
  test("long drags never snap backwards to a single page", () => {
    expect(settleTouchScroll(0, -180, -180, -600, 150, -500)).toBe(-180);
    expect(settleTouchScroll(-300, -120, 180, 600, 150, -500)).toBe(-120);
  });
  test("short drags keep their position and bounds stay clamped", () => {
    expect(settleTouchScroll(-100, -110, -10, 0, 150, -500)).toBe(-110);
    expect(settleTouchScroll(-450, -480, -30, -500, 150, -500)).toBe(-500);
    expect(settleTouchScroll(-20, 0, 40, 500, 150, -500)).toBe(0);
  });
});
