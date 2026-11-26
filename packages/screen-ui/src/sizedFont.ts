/** A font slot the host rasterized at a requested size, with the offsets
 * that place one line of it in a Text box (logical px). */
export interface SizedFont {
  slot: number;
  lineHeight: number;
  /** Text box top to the baseline. */
  baseline: number;
  /** Height of capitals and lining figures above the baseline. */
  capHeight: number;
}

/** Text at any pixel size. Request every character the Text will show; the
 * host keeps eight sizes per App and reuses the least recently requested
 * one. Undefined when the host cannot rasterize text (simulators). */
export function sizedFont(px: number, text: string): SizedFont | undefined {
  const bridge = (globalThis as { onekvm?: { font?(px: number, text: string): number[] } }).onekvm;
  const result = bridge?.font?.(px, text);
  if (!result || result.length < 4) return undefined;
  const [slot, lineHeight, baseline, capHeight] = result;
  return { slot, lineHeight, baseline, capHeight };
}
