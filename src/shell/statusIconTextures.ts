import type { HomeStatusSource } from '../shared/homeWidgets'
import { STATUS_ICON_SIZE, statusIconMasks } from '../shared/statusIconMasks'

// PocketJS textures require power-of-two dimensions. Keep the original 28px
// coverage inside a transparent 32px envelope, without stretching the artwork.
const TEXTURE_SIZE = 32
const PADDING = (TEXTURE_SIZE - STATUS_ICON_SIZE) / 2

interface TextureOps {
  uploadTexture(pixels: Uint8Array, width: number, height: number, psm: number): number
  freeTexture(handle: number): void
}

export function statusIconTextureBounds(width: number, height: number) {
  const unit = Math.min(width, height) / STATUS_ICON_SIZE
  return {
    insetL: (width - STATUS_ICON_SIZE * unit) / 2 - PADDING * unit,
    insetT: (height - STATUS_ICON_SIZE * unit) / 2 - PADDING * unit,
    width: TEXTURE_SIZE * unit,
    height: TEXTURE_SIZE * unit,
  }
}

/** Share only live color variants; layout edits must not retain old colors. */
export function createStatusIconTextures(ops: TextureOps) {
  const entries = new Map<string, { handle: number; references: number }>()
  return {
    acquire(source: HomeStatusSource, color: number) {
      color >>>= 0 // Native colors are packed ABGR, including their alpha.
      const key = `${source}:${color}`
      let entry = entries.get(key)
      if (!entry) {
        const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4)
        const rows = statusIconMasks[source]
        for (let y = 0; y < STATUS_ICON_SIZE; y++) {
          for (let x = 0; x < STATUS_ICON_SIZE; x++) {
            const at = ((y + PADDING) * TEXTURE_SIZE + x + PADDING) * 4
            pixels[at] = color & 255
            pixels[at + 1] = (color >>> 8) & 255
            pixels[at + 2] = (color >>> 16) & 255
            pixels[at + 3] = Math.round(parseInt(rows[y][x], 16) * 17 * (color >>> 24) / 255)
          }
        }
        const handle = ops.uploadTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE, 3)
        if (handle < 0) return { handle, release() {} }
        entry = { handle, references: 0 }
        entries.set(key, entry)
      }
      entry.references++
      const acquired = entry
      let released = false
      return {
        handle: acquired.handle,
        release() {
          if (released) return
          released = true
          if (--acquired.references === 0) {
            entries.delete(key)
            ops.freeTexture(acquired.handle)
          }
        },
      }
    },
  }
}
