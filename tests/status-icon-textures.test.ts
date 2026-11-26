import { describe, expect, test } from 'bun:test'
import { statusIconMasks } from '../src/shared/statusIconMasks'
import { createStatusIconTextures, statusIconTextureBounds } from '../src/shell/statusIconTextures'

function host() {
  const uploads: { pixels: Uint8Array; width: number; height: number; psm: number }[] = []
  const freed: number[] = []
  const textures = createStatusIconTextures({
    uploadTexture(pixels, width, height, psm) {
      uploads.push({ pixels, width, height, psm })
      return uploads.length - 1
    },
    freeTexture(handle) { freed.push(handle) },
  })
  return { textures, uploads, freed }
}

describe('shared status icon textures', () => {
  test('duplicates borrow one texture, and the last consumer releases it once', () => {
    const { textures, uploads, freed } = host()
    const first = textures.acquire('eth', 0xff123456)
    const second = textures.acquire('eth', 0xff123456 | 0)
    expect(first.handle).toBe(0) // Zero is a valid native handle.
    expect(second.handle).toBe(first.handle)
    expect(uploads).toHaveLength(1)
    first.release()
    first.release()
    expect(freed).toEqual([])
    second.release()
    expect(freed).toEqual([0])
    const next = textures.acquire('eth', 0xff123456)
    expect(next.handle).toBe(1)
    next.release()
    expect(freed).toEqual([0, 1])
  })

  test('source and color variants have independent lifetimes', () => {
    const { textures, uploads, freed } = host()
    const variants = [textures.acquire('hdmi', 0xff000000), textures.acquire('eth', 0xff000000), textures.acquire('hdmi', 0x80000000)]
    expect(uploads).toHaveLength(3)
    for (const texture of variants) texture.release()
    expect(freed).toEqual([0, 1, 2])
    for (let i = 0; i < 100; i++) textures.acquire('live', 0xff000000 + i).release()
    expect(freed).toHaveLength(103)
  })

  test('every mask preserves RGB, coverage and color alpha inside transparent padding', () => {
    const { textures, uploads } = host()
    for (const source of Object.keys(statusIconMasks) as (keyof typeof statusIconMasks)[]) {
      const texture = textures.acquire(source, 0x80402010)
      const upload = uploads.at(-1)!
      expect([upload.width, upload.height, upload.psm]).toEqual([32, 32, 3])
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const at = (y * 32 + x) * 4
        const inside = x >= 2 && x < 30 && y >= 2 && y < 30
        expect([...upload.pixels.subarray(at, at + 4)]).toEqual(inside
          ? [0x10, 0x20, 0x40, Math.round(parseInt(statusIconMasks[source][y - 2][x - 2], 16) * 17 * 128 / 255)]
          : [0, 0, 0, 0])
      }
      texture.release()
    }
  })

  test('an unsuccessful upload is not cached or freed, and the next request retries', () => {
    let attempts = 0
    const freed: number[] = []
    const textures = createStatusIconTextures({
      uploadTexture() { return attempts++ === 0 ? -1 : 0 },
      freeTexture(handle) { freed.push(handle) },
    })
    const failed = textures.acquire('wifi', 0xffffffff)
    expect(failed.handle).toBe(-1)
    failed.release()
    const retry = textures.acquire('wifi', 0xffffffff)
    expect(retry.handle).toBe(0)
    retry.release()
    expect(freed).toEqual([0])
  })

  test('padding preserves centered contain geometry in wide, tall and scaled placements', () => {
    for (const [width, height] of [[28, 28], [84, 28], [28, 84], [37, 21]]) {
      const bounds = statusIconTextureBounds(width, height)
      const unit = Math.min(width, height) / 28
      expect(bounds.insetL + 2 * unit).toBeCloseTo((width - 28 * unit) / 2)
      expect(bounds.insetT + 2 * unit).toBeCloseTo((height - 28 * unit) / 2)
      expect(bounds.width - 4 * unit).toBeCloseTo(Math.min(width, height))
      expect(bounds.height).toBe(bounds.width)
    }
  })
})
