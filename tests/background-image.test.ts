import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseBackgroundImage,
  rgbaToRgb565,
  serializeBackgroundImage,
} from '../web/display/background-image'

test('background images round-trip as RGB565 little endian', () => {
  const image = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]),
  } as ImageData
  const bytes = rgbaToRgb565(image)
  assert.deepEqual([...bytes], [0x00, 0xf8, 0xe0, 0x07])

  const parsed = parseBackgroundImage(serializeBackgroundImage(2, 1, bytes))
  assert.equal(parsed?.width, 2)
  assert.equal(parsed?.height, 1)
  assert.deepEqual([...(parsed?.bytes || [])], [...bytes])
})

test('background image parsing rejects a mismatched pixel payload', () => {
  assert.equal(parseBackgroundImage(JSON.stringify({
    v: 1,
    width: 2,
    height: 1,
    pixels: 'AAA=',
  })), null)
})
