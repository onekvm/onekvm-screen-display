/** PocketJS colors are packed ABGR, not CSS/ARGB. */
export const COLOR = {
  black: 0xff000000,
  white: 0xffffffff,
  zinc100: 0xfff5f4f4,
  zinc400: 0xffaaa1a1,
  zinc800: 0xff272727,
  zinc950: 0xff0b0909,
  amber400: 0xff24bffb,
  primary: 0xfff6823b, // #3b82f6
  muted: 0xffaaa1a1,
  panel: 0xff272727,
  success: 0xff80de4a, // #4ade80
  warning: 0xff24bffb, // #fbbf24
  danger: 0xff4444ef, // #ef4444
} as const;

/** Baked atlas slots: 0=12, 1=14, 2=16, 7=12 bold, 15=54 bold. */
export const FONT = { xs: 0, sm: 1, base: 2, xsBold: 7, face: 15 } as const;
