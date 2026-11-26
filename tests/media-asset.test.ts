import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  emptyMediaAssets,
  mediaFrameIndex,
  parseMediaAssets,
  serializeMediaAssets,
  importMediaFile,
  mediaVideoUrl,
  mediaAssetStorageBytes,
} from '../web/display/media-asset'

test('media assets round-trip RGB565 frames and timing', () => {
  const encoded = serializeMediaAssets({
    v: 1,
    assets: {
      'home-media-1': {
        v: 1,
        name: 'demo.gif',
        format: 'gif',
        width: 2,
        height: 1,
        durations: [100, 140],
        frames: ['AQACAA==', 'AwAEAA=='],
      },
    },
  })
  const parsed = parseMediaAssets(encoded)

  assert.equal(parsed.assets['home-media-1'].frames.length, 2)
  assert.deepEqual(parsed.assets['home-media-1'].durations, [100, 140])
})

test('invalid media frame payloads are discarded', () => {
  const parsed = parseMediaAssets(JSON.stringify({
    v: 1,
    assets: {
      bad: {
        v: 1,
        name: 'bad.webp',
        format: 'webp',
        width: 2,
        height: 1,
        durations: [100],
        frames: ['AQA='],
      },
    },
  }))

  assert.deepEqual(parsed, emptyMediaAssets())
})

test('static image frames use the same validated device payload', () => {
  const parsed = parseMediaAssets(JSON.stringify({
    v: 1,
    assets: {
      still: {
        v: 1,
        name: 'panel.png',
        format: 'image',
        width: 1,
        height: 1,
        durations: [1000],
        frames: ['AQA='],
      },
    },
  }))

  assert.equal(parsed.assets.still.format, 'image')
  assert.equal(parsed.assets.still.frames.length, 1)
})

test('large decoded media is preserved without a library quota', () => {
  const width = 160
  const height = 160
  const frame = Buffer.alloc(width * height * 2).toString('base64')
  const frames = Array.from({ length: 60 }, () => frame)
  const asset = {
    v: 1 as const,
    name: 'large.gif',
    format: 'gif' as const,
    width,
    height,
    durations: frames.map(() => 100),
    frames,
  }
  const encoded = serializeMediaAssets({ v: 1, assets: { first: asset, second: asset } })
  assert.equal(Object.keys(parseMediaAssets(encoded).assets).length, 2)
})


test('60 FPS timestamps survive save and late preview frames follow elapsed time', () => {
  const durations = Array.from({ length: 60 }, (_, index) => Math.round((index + 1) * 1000 / 60) - Math.round(index * 1000 / 60))
  const asset = { v: 1 as const, name: '60fps.mp4', format: 'h264' as const, width: 1, height: 1, durations, frames: durations.map(() => 'AQA=') }
  const parsed = parseMediaAssets(serializeMediaAssets({ v: 1, assets: { demo: asset } }))
  assert.deepEqual(parsed.assets.demo.durations, durations)
  assert.equal(durations.reduce((a, b) => a + b, 0), 1000)
  assert.equal(mediaFrameIndex(durations, 500), 30)
  assert.equal(mediaFrameIndex(durations, 1000), 0)
  assert.equal(mediaFrameIndex(durations, 2000, false), 59)
})

test('MP4 assets retain compressed source resolution without a duration quota', () => {
  const mp4 = Buffer.from('00000018667479706d70343200000000', 'hex').toString('base64')
  const encoded = serializeMediaAssets({
    v: 1,
    assets: {
      clip: {
        v: 2,
        name: 'clip.mp4',
        format: 'mp4',
        container: 'mp4',
        codec: 'h264',
        width: 1920,
        height: 1080,
        duration_ms: 120 * 60 * 1000,
        durations: [],
        frames: [],
        data: mp4,
      },
    },
  })
  const parsed = parseMediaAssets(encoded)
  assert.equal(parsed.assets.clip.width, 1920)
  assert.equal(parsed.assets.clip.height, 1080)
  assert.equal(parsed.assets.clip.duration_ms, 120 * 60 * 1000)
  assert.equal(parsed.assets.clip.frames.length, 0)
  assert.equal(parseMediaAssets(encoded.replace('7200000', '7200001')).assets.clip.duration_ms, 7200001)
})

test('large MP4 upload sends the File directly and only metadata enters settings', async () => {
  const fetchBefore = globalThis.fetch
  const file = new File(['video'], 'large.mp4', { type: 'video/mp4' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => { throw new Error('whole file must not be buffered') } })
  const metadata = { v: 3, format: 'mp4', container: 'mp4', codec: 'h264', width: 320, height: 172,
    duration_ms: 120000, size_bytes: 128 * 1024 * 1024, file: `${'a'.repeat(32)}.mp4` }
  globalThis.fetch = (async (url, options) => {
    assert.equal(url, '/api/plugins/screen-display/remote/media')
    assert.equal(options?.body, file)
    return Response.json(metadata)
  }) as typeof fetch
  try {
    const asset = await importMediaFile(file)
    const encoded = serializeMediaAssets({ v: 1, assets: { clip: asset } })
    assert.ok(encoded.length < 1024)
    assert.equal(asset.data, undefined)
    assert.equal(mediaAssetStorageBytes(asset), 128 * 1024 * 1024)
    assert.equal(parseMediaAssets(encoded).assets.clip.file, metadata.file)
    assert.equal(mediaVideoUrl(asset), `/api/plugins/screen-display/remote/media/${metadata.file}`)
    assert.deepEqual(parseMediaAssets(encoded.replace(metadata.file, '../outside.mp4')).assets, {})
  } finally { globalThis.fetch = fetchBefore }
})
