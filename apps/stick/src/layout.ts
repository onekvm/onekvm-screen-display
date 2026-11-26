export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function stickLayout(screen: { w: number; h: number }) {
  const { w, h } = screen;
  if (w > h) {
    // Pro's landscape panel: movement on the left, two mouse buttons on the
    // right, speed underneath. Keep the Back edge and Home strip clear.
    const size = Math.min(120, h - 48);
    const x = 24 + size + 16;
    const width = w - 16 - x;
    const buttonWidth = Math.floor((width - 8) / 2);
    return {
      joystick: { x: 24, y: 12, w: size, h: size },
      left: { x, y: 12, w: buttonWidth, h: 64 },
      right: { x: x + buttonWidth + 8, y: 12, w: buttonWidth, h: 64 },
      speed: { x, y: 104, w: width, h: 28 },
      speedHit: { x, y: 96, w: width, h: 44 },
      notice: { x: 24, y: h - 36, w: size, h: 16 },
    };
  }
  const buttonWidth = Math.min(88, Math.floor((w - 56) / 2));
  const speedWidth = Math.min(208, w - 48);
  return {
    joystick: { x: Math.round(w / 2) - 60, y: Math.round(h * 78 / 240) - 60, w: 120, h: 120 },
    left: { x: 24, y: h - 72, w: buttonWidth, h: 36 },
    right: { x: w - 24 - buttonWidth, y: h - 72, w: buttonWidth, h: 36 },
    speed: { x: Math.round((w - speedWidth) / 2), y: h - 98, w: speedWidth, h: 22 },
    speedHit: { x: Math.round((w - speedWidth) / 2), y: h - 98, w: speedWidth, h: 22 },
    notice: { x: Math.round((w - 96) / 2), y: 0, w: 96, h: 16 },
  };
}
