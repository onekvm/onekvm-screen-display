import type { InjectionKey, ShallowRef } from 'vue'

export const appIconAssetsKey: InjectionKey<ShallowRef<Record<string, string>>> = Symbol('app-icon-assets')

/** Decode the same validated ICO1 artwork that the framebuffer uses. */
export function iconPixels(encoded: string): { width: number; height: number; pixels: Uint8ClampedArray } | null {
  if (encoded.length > 270_000) return null
  let raw: string
  try { raw = atob(encoded) } catch { return null }
  if (!raw.startsWith('ICO1') || raw.length < 8) return null
  const width = raw.charCodeAt(4) | raw.charCodeAt(5) << 8
  const height = raw.charCodeAt(6) | raw.charCodeAt(7) << 8
  if (!width || !height || width > 256 || height > 256 || (width & (width - 1)) || (height & (height - 1))) return null
  const count = width * height
  if (raw.length !== 8 + count * 3) return null
  const pixels = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i++) {
    const rgb = raw.charCodeAt(8 + i * 2) | raw.charCodeAt(9 + i * 2) << 8
    const r = rgb >> 11 & 31, g = rgb >> 5 & 63, b = rgb & 31
    pixels.set([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), raw.charCodeAt(8 + count * 2 + i)], i * 4)
  }
  return { width, height, pixels }
}

export function parseIconAssets(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') return {}
  try {
    const entries: unknown = JSON.parse(raw)
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {}
    return Object.fromEntries(Object.entries(entries).flatMap(([key, value]) => {
      if (!key.startsWith('app-icon:') || typeof value !== 'string') return []
      const icon = iconPixels(value)
      if (!icon) return []
      const canvas = document.createElement('canvas')
      canvas.width = icon.width; canvas.height = icon.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return []
      const image = ctx.createImageData(icon.width, icon.height)
      image.data.set(icon.pixels)
      ctx.putImageData(image, 0, 0)
      return [[key, canvas.toDataURL('image/png')]]
    }))
  } catch { return {} }
}
