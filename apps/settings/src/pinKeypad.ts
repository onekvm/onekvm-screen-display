export const PIN_ROWS = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["BS", "0", "X", "OK"]] as const;

/** Reserve the title, feedback, masked value and native Home strip. */
export function pinKeypad(screen: { w: number; h: number }) {
  const gap = 4, top = 64, margin = 12;
  const height = Math.max(16, Math.floor((screen.h - top - 20 - gap * 3) / 4));
  return PIN_ROWS.flatMap((row, r) => {
    const width = Math.floor((screen.w - margin * 2 - gap * (row.length - 1)) / row.length);
    return row.map((token, c) => ({ token, x: margin + c * (width + gap), y: top + r * (height + gap), w: width, h: height }));
  });
}
