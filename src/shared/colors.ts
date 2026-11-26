/** Canonical CSS hex, with optional trailing alpha (#RRGGBBAA). */
export function normalizeColor(value: unknown, fallback: string): string {
  if (value === 'transparent') return '#00000000'
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value) ? value : fallback
}
/** PocketJS colors are ABGR, including the alpha byte. */
export function abgrColor(value: unknown, fallback: number): number {
  const color = normalizeColor(value, '')
  if (!color) return fallback
  const rgb = Number.parseInt(color.slice(1, 7), 16)
  const alpha = color.length === 9 ? Number.parseInt(color.slice(7), 16) : 255
  return ((alpha << 24) | ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 255)) >>> 0
}
