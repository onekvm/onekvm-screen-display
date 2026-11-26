import { parseBackgroundImage, serializeBackgroundImage } from './background-image'
import { normalizeColor } from '../../src/shared/colors'

export interface BackgroundCrop { x: number; y: number; zoom: number }
export const DEFAULT_BACKGROUND_CROP: BackgroundCrop = { x: 50, y: 50, zoom: 1 }
export const MIN_BACKGROUND_ZOOM = 0.1
export const MAX_BACKGROUND_ZOOM = 4

/** RGB565 backgrounds are composited over the device's black surface. */
export function backgroundFill(background = '#000000'): string {
  const color = normalizeColor(background, '#000000')
  const alpha = color.length === 9 ? Number.parseInt(color.slice(7), 16) / 255 : 1
  return '#' + [1, 3, 5].map(offset => Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * alpha).toString(16).padStart(2, '0')).join('')
}
export function normalizeBackgroundCrop(value: unknown): BackgroundCrop {
  const crop = (value && typeof value === 'object' ? value : {}) as Partial<BackgroundCrop>
  const bound = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
  return { x: bound(crop.x, 50, 0, 100), y: bound(crop.y, 50, 0, 100), zoom: bound(crop.zoom, 1, MIN_BACKGROUND_ZOOM, MAX_BACKGROUND_ZOOM) }
}
export function cropGeometry(source: { width: number; height: number }, target: { width: number; height: number }, value: BackgroundCrop) {
  const crop = normalizeBackgroundCrop(value)
  const scale = Math.max(target.width / source.width, target.height / source.height) * crop.zoom
  const width = target.width / scale, height = target.height / scale
  return { x: (source.width - width) * crop.x / 100, y: (source.height - height) * crop.y / 100, width, height, scale }
}

/** Bake the framing into RGB565. Native and Web consume this same result. */
export function cropBackgroundImage(raw: string, width: number, height: number, crop: BackgroundCrop, background = '#000000'): string {
  const source = parseBackgroundImage(raw)
  if (!source || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 512 * 512) return ''
  const region = cropGeometry(source, { width, height }, crop)
  const output = new Uint8Array(width * height * 2)
  const fill = backgroundFill(background)
  const pixel = (Number.parseInt(fill.slice(1, 3), 16) >> 3) << 11 | (Number.parseInt(fill.slice(3, 5), 16) >> 2) << 5 | Number.parseInt(fill.slice(5, 7), 16) >> 3
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(region.y + y / height * region.height)
    for (let x = 0; x < width; x++) {
      const sx = Math.floor(region.x + x / width * region.width)
      const from = (sy * source.width + sx) * 2, to = (y * width + x) * 2
      if (sx < 0 || sx >= source.width || sy < 0 || sy >= source.height) {
        output[to] = pixel & 255
        output[to + 1] = pixel >> 8
        continue
      }
      output[to] = source.bytes[from]!
      output[to + 1] = source.bytes[from + 1]!
    }
  }
  return serializeBackgroundImage(width, height, output)
}
