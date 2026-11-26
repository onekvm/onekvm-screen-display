import { expect, test } from 'bun:test'
import { cropBackgroundImage, cropGeometry, normalizeBackgroundCrop } from '../web/display/background-crop'
import { parseBackgroundImage, serializeBackgroundImage } from '../web/display/background-image'
import { DEFAULT_BACKGROUND_IMAGE, withDefaultBackground, DEFAULT_BACKGROUND_ID } from '../web/display/default-background'
import { parseMediaAssets, serializeMediaAssets } from '../web/display/media-asset'
import { parseLayout } from '../web/display/types'
import { abgrColor } from '../src/shared/colors'

test('crop uses bounded cover coordinates and maintains the display aspect ratio', () => {
  expect(normalizeBackgroundCrop({ x: -5, y: NaN, zoom: 10 })).toEqual({ x: 0, y: 50, zoom: 4 })
  expect(cropGeometry({ width: 400, height: 200 }, { width: 100, height: 100 }, { x: 100, y: 50, zoom: 1 })).toEqual({ x: 200, y: 0, width: 200, height: 200, scale: 0.5 })
})
test('panning and zooming bake the correct pixels without altering the source', () => {
  const source = serializeBackgroundImage(4, 2, new Uint8Array([1,0,2,0,3,0,4,0,5,0,6,0,7,0,8,0]))
  const crop = (x: number, zoom = 1) => [...parseBackgroundImage(cropBackgroundImage(source, 2, 2, { x, y: 0, zoom }))!.bytes]
  expect(crop(0)).toEqual([1,0,2,0,5,0,6,0])
  expect(crop(100)).toEqual([3,0,4,0,7,0,8,0])
  expect(crop(100, 2)).toEqual([4,0,4,0,4,0,4,0])
  expect(parseBackgroundImage(source)!.width).toBe(4)
})
test('default image is valid and remains an editable library source after saving', () => {
  expect(parseBackgroundImage(DEFAULT_BACKGROUND_IMAGE)!.width).toBeGreaterThan(0)
  const saved = parseMediaAssets(serializeMediaAssets(withDefaultBackground({ v: 1, assets: {} })))
  expect(saved.assets[DEFAULT_BACKGROUND_ID]!.frames.length).toBe(1)
})
test('alpha and crop survive save/reopen and PocketJS keeps RGBA alpha in ABGR', () => {
  const layout = parseLayout(JSON.stringify({ background: 'transparent', background_crop: { x: 20, y: 80, zoom: 2 }, home_widgets: [{ id: 'box', kind: 'rect', background: '#12345680' }] }))
  expect(parseLayout(JSON.stringify(layout)).background_crop).toEqual({ x: 20, y: 80, zoom: 2 })
  expect(layout.background).toBe('#00000000')
  expect(layout.home_widgets[0]!.background).toBe('#12345680')
  expect(abgrColor('#12345680', 0)).toBe(0x80563412)
  expect(abgrColor('transparent', 0xff000000)).toBe(0)
  expect(abgrColor('#123456', 0)).toBe(0xff563412)
})
