import { expect, test } from "bun:test";
import { stickLayout, type Rect } from "../apps/stick/src/layout";

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test("Pro touchpad targets are large, separate and outside system gesture edges", () => {
  const layout = stickLayout({ w: 320, h: 172 });
  expect(layout.joystick.x + layout.joystick.w).toBeLessThan(layout.left.x);
  expect(layout.left.x + layout.left.w).toBeLessThan(layout.right.x);
  for (const rect of [layout.joystick, layout.left, layout.right, layout.speedHit]) {
    expect(rect.w).toBeGreaterThanOrEqual(44);
    expect(rect.h).toBeGreaterThanOrEqual(44);
    expect(rect.x).toBeGreaterThanOrEqual(20);
    expect(rect.x + rect.w).toBeLessThanOrEqual(320);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.h).toBeLessThanOrEqual(152);
  }
  const targets = [layout.joystick, layout.left, layout.right, layout.speedHit];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) expect(overlaps(targets[i], targets[j])).toBe(false);
    expect(overlaps(targets[i], layout.notice)).toBe(false);
  }
});

test("square and portrait screens keep separate controls", () => {
  for (const screen of [{ w: 240, h: 240 }, { w: 172, h: 320 }]) {
    const layout = stickLayout(screen);
    const targets = [layout.joystick, layout.left, layout.right, layout.speedHit];
    for (let i = 0; i < targets.length; i++) {
      expect(targets[i].x).toBeGreaterThanOrEqual(20);
      expect(targets[i].x + targets[i].w).toBeLessThanOrEqual(screen.w);
      expect(targets[i].y + targets[i].h).toBeLessThanOrEqual(screen.h - 20);
      for (let j = i + 1; j < targets.length; j++) expect(overlaps(targets[i], targets[j])).toBe(false);
    }
  }
});
