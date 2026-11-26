import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backgroundFill, cropBackgroundImage, cropGeometry, normalizeBackgroundCrop } from '../web/display/background-crop'
import { parseBackgroundImage, serializeBackgroundImage } from '../web/display/background-image'
import { parseLayout } from '../web/display/types'

const pixels = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const source = serializeBackgroundImage(4, 4, pixels)
function output(x: number, y: number, background = '#00ff00') {
  return parseBackgroundImage(cropBackgroundImage(source, 4, 4, { x, y, zoom: 0.5 }, background))!.bytes
}

test('zoom supports 10–400%, keeps cover at 100%, and survives saved layout parsing', () => {
  assert.equal(normalizeBackgroundCrop({ zoom: 0.5 }).zoom, 0.5)
  assert.equal(normalizeBackgroundCrop({ zoom: 0 }).zoom, 0.1)
  assert.equal(normalizeBackgroundCrop({ zoom: 10 }).zoom, 4)
  assert.equal(normalizeBackgroundCrop({ zoom: NaN }).zoom, 1)
  assert.equal(parseLayout(JSON.stringify({ background_crop: { x: 20, y: 30, zoom: 0.1 } })).background_crop?.zoom, 0.1)
  assert.equal(cropBackgroundImage(source, 4, 4, { x: 50, y: 50, zoom: 1 }), source)
  assert.deepEqual(cropGeometry({ width: 4, height: 4 }, { width: 4, height: 4 }, { x: 50, y: 50, zoom: 0.5 }), { x: -2, y: -2, width: 8, height: 8, scale: 0.5 })
})

test('zoom out pads with selected color on all sides without stretching edge pixels', () => {
  const result = output(50, 50)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const actual = [...result.slice((y * 4 + x) * 2, (y * 4 + x) * 2 + 2)]
    const offset = ((y - 1) * 2 * 4 + (x - 1) * 2) * 2
    const expected = x >= 1 && x <= 2 && y >= 1 && y <= 2 ? [...pixels.slice(offset, offset + 2)] : [0xe0, 0x07]
    assert.deepEqual(actual, expected, `pixel ${x},${y}`)
  }
  assert.deepEqual([...output(0, 0).slice(0, 2)], [...pixels.slice(0, 2)])
  assert.deepEqual([...output(0, 0).slice(-2)], [0xe0, 0x07])
  assert.deepEqual([...output(100, 100).slice(0, 2)], [0xe0, 0x07])
  assert.deepEqual([...output(100, 100).slice(-2)], [...pixels.slice(20, 22)])
})

test('transparent page color is composited over black consistently', () => {
  assert.equal(backgroundFill('#ff000080'), '#800000')
  assert.equal(backgroundFill('transparent'), '#000000')
  assert.equal(backgroundFill('#ffffff00'), '#000000')
  assert.deepEqual([...output(50, 50, '#ff000080').slice(0, 2)], [0, 0x80])
})
