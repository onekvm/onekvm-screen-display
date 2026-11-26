import { expect, test } from 'bun:test'
import { effectScope, ref } from 'vue'
import { importMediaFile, mediaAssetDimensions, mediaAssetStorageBytes, mediaImageUrl, parseMediaAssets, serializeMediaAssets } from '../web/display/media-asset'
import { useDesignerHistory } from '../web/display/useDesignerHistory'

test('portrait image uploads the original File and preserves dimensions across save and reopen', async () => {
  const before = { fetch: globalThis.fetch, bitmap: globalThis.createImageBitmap, document: globalThis.document }
  const bytes = new Uint8Array([255, 216, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  const file = new File([bytes], 'portrait.jpg', { type: 'image/jpeg' })
  const controller = new AbortController()
  let closed = false
  globalThis.createImageBitmap = (async () => ({ width: 1920, height: 2830, close: () => { closed = true } })) as unknown as typeof createImageBitmap
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: (_x: number, _y: number, width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) }) }) } as unknown as Document
  globalThis.fetch = (async (url, options) => {
    expect(url).toBe('/api/plugins/screen-display/remote/media/image')
    expect(options?.body).toBe(file)
    expect(options?.signal).toBe(controller.signal)
    expect(new Uint8Array(await (options!.body as File).arrayBuffer())).toEqual(bytes)
    return new Response(JSON.stringify({ file: `${'a'.repeat(32)}.jpg`, size_bytes: file.size }), { status: 201 })
  }) as typeof fetch
  try {
    const asset = await importMediaFile(file, controller.signal)
    expect([asset.width, asset.height]).toEqual([163, 240])
    const saved = parseMediaAssets(serializeMediaAssets({ v: 1, assets: { portrait: asset } })).assets.portrait!
    expect(mediaAssetDimensions(saved)).toMatchObject({ width: 1920, height: 2830 })
    expect(mediaImageUrl(saved)).toEndWith(`${'a'.repeat(32)}.jpg`)
    expect(mediaAssetStorageBytes(saved)).toBe(163 * 240 * 2 + bytes.length)
    expect(saved.original).toEqual(asset.original)
    expect(closed).toBe(true)
    const invalid = { ...asset, original: { ...asset.original, file: '../other.jpg' } }
    expect(parseMediaAssets(serializeMediaAssets({ v: 1, assets: { invalid } } as never)).assets).toEqual({})
  } finally {
    globalThis.fetch = before.fetch
    globalThis.createImageBitmap = before.bitmap
    globalThis.document = before.document
  }
})

test('asynchronous background selection is one undo step after the rendered image is ready', () => {
  const scope = effectScope()
  const state = ref({ asset: 'old', background: 'old' })
  const pending = ref(false)
  const history = scope.run(() => useDesignerHistory(() => state.value, value => { state.value = value }, (a, b) => a.asset === b.asset && a.background === b.background, () => pending.value))!
  try {
    pending.value = true
    state.value = { asset: 'original', background: 'old' }
    state.value = { asset: 'original', background: 'full-resolution crop' }
    expect(history.canUndo.value).toBe(false)
    pending.value = false
    history.undo()
    expect(state.value).toEqual({ asset: 'old', background: 'old' })
    history.redo()
    expect(state.value).toEqual({ asset: 'original', background: 'full-resolution crop' })
  } finally { history.dispose(); scope.stop() }
})
