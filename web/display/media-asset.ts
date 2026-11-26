// Media assets are persisted as-is.  The display still scales decoded frames
// to its native working size, but does not impose file, duration, or frame
// count quotas on the library.
export const MAX_MEDIA_SIDE = 240
export const MAX_MEDIA_SOURCE_SIDE = 4096

export type MediaFormat = 'image' | 'gif' | 'webp' | 'h264' | 'mp4'

export interface MediaImageOriginal {
  file: string
  width: number
  height: number
  size_bytes: number
}

export interface MediaAsset {
  v: 1 | 2 | 3
  name: string
  format: MediaFormat
  width: number
  height: number
  durations: number[]
  frames: string[]
  container?: 'mp4'
  codec?: 'h264'
  duration_ms?: number
  data?: string
  file?: string
  size_bytes?: number
  original?: MediaImageOriginal
}

export interface MediaAssetLibrary {
  v: 1
  assets: Record<string, MediaAsset>
}

export class MediaAssetError extends Error {
  constructor(public readonly code: 'invalid' | 'too-large' | 'unsupported') {
    super(code)
  }
}

export function emptyMediaAssets(): MediaAssetLibrary {
  return { v: 1, assets: {} }
}

export function isCompressedVideo(asset: MediaAsset | undefined): asset is MediaAsset & { format: 'mp4'; duration_ms: number } {
  return Boolean(asset && (asset.v === 2 || asset.v === 3) && asset.format === 'mp4' && Number.isFinite(asset.duration_ms))
}

export function mediaVideoUrl(asset: MediaAsset): string {
  return asset.v === 3 ? `/api/plugins/screen-display/remote/media/${asset.file}` : `data:video/mp4;base64,${asset.data}`
}

export function mediaImageUrl(asset: MediaAsset | undefined): string {
  return asset?.original ? `/api/plugins/screen-display/remote/media/${asset.original.file}` : ''
}

export function mediaAssetDimensions(asset: MediaAsset): { width: number; height: number } {
  return asset.original ?? asset
}

export function mediaAssetDurationMs(asset: MediaAsset): number {
  return isCompressedVideo(asset) ? asset.duration_ms : asset.durations.reduce((sum, value) => sum + value, 0)
}

export function mediaAssetStorageBytes(asset: MediaAsset): number {
  if (isCompressedVideo(asset)) return asset.v === 3 ? asset.size_bytes ?? 0 : Math.floor((asset.data?.length ?? 0) * 3 / 4)
  return asset.width * asset.height * 2 * asset.frames.length + (asset.original?.size_bytes ?? 0)
}

function parseOriginal(value: unknown): MediaImageOriginal | null {
  if (!value || typeof value !== 'object') return null
  const original = value as Partial<MediaImageOriginal>
  if (typeof original.file !== 'string' || !/^[a-f0-9]{32}\.(png|jpg|gif|webp|bmp|avif)$/.test(original.file)) return null
  if (!isDimension(original.width, 65535) || !isDimension(original.height, 65535)) return null
  if (!Number.isSafeInteger(original.size_bytes) || Number(original.size_bytes) < 1) return null
  return { file: original.file, width: original.width, height: original.height, size_bytes: original.size_bytes! }
}

function isDimension(value: unknown, max = MAX_MEDIA_SIDE): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= max
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = globalThis.atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return globalThis.btoa(binary)
}

function looksLikeMp4(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
}

function parseAsset(value: unknown): MediaAsset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const asset = value as Partial<MediaAsset>
  if ((asset.v !== 1 && asset.v !== 2 && asset.v !== 3) || !isDimension(asset.width, asset.v !== 1 ? MAX_MEDIA_SOURCE_SIDE : MAX_MEDIA_SIDE) || !isDimension(asset.height, asset.v !== 1 ? MAX_MEDIA_SOURCE_SIDE : MAX_MEDIA_SIDE)) return null
  if (asset.v === 3 && asset.format === 'mp4') {
    if (asset.container !== 'mp4' || asset.codec !== 'h264' || typeof asset.file !== 'string' || !/^[a-f0-9]{32}\.mp4$/.test(asset.file)) return null
    if (!Number.isSafeInteger(asset.size_bytes) || Number(asset.size_bytes) < 1 || !Number.isSafeInteger(asset.duration_ms) || Number(asset.duration_ms) < 1) return null
    return { v: 3, name: typeof asset.name === 'string' ? asset.name.slice(0, 96) : '', format: 'mp4', width: asset.width, height: asset.height, durations: [], frames: [], container: 'mp4', codec: 'h264', duration_ms: asset.duration_ms, file: asset.file, size_bytes: asset.size_bytes }
  }
  if (asset.v === 2 && asset.format === 'mp4') {
    if (asset.container !== 'mp4' || asset.codec !== 'h264' || typeof asset.data !== 'string') return null
    const duration = Number(asset.duration_ms)
    const bytes = decodeBase64(asset.data)
    if (!bytes || !looksLikeMp4(bytes) || !Number.isInteger(duration) || duration < 1) return null
    return {
      v: 2,
      name: typeof asset.name === 'string' ? asset.name.slice(0, 96) : '',
      format: 'mp4', width: asset.width, height: asset.height, durations: [], frames: [],
      container: 'mp4', codec: 'h264', duration_ms: duration, data: asset.data,
    }
  }
  if (asset.v !== 1 || (asset.format !== 'image' && asset.format !== 'gif' && asset.format !== 'webp' && asset.format !== 'h264')) return null
  if (!Array.isArray(asset.frames) || !Array.isArray(asset.durations)) return null
  if (asset.frames.length < 1 || asset.frames.length !== asset.durations.length) return null
  const expected = asset.width * asset.height * 2
  const frames: string[] = []
  for (const frame of asset.frames) {
    if (typeof frame !== 'string') return null
    const bytes = decodeBase64(frame)
    if (!bytes || bytes.length !== expected) return null
    frames.push(frame)
  }
  const durations = asset.durations.map((duration) => Number(duration))
  if (durations.some((duration) => !Number.isFinite(duration) || duration < 16 || duration > 2000)) return null
  const original = asset.original === undefined ? undefined : parseOriginal(asset.original)
  if (original === null) return null
  return {
    v: 1,
    name: typeof asset.name === 'string' ? asset.name.slice(0, 96) : '',
    format: asset.format,
    width: asset.width,
    height: asset.height,
    durations: durations.map((duration) => Math.round(duration)),
    frames,
    ...(original ? { original } : {}),
  }
}

export function parseMediaAssets(raw: unknown): MediaAssetLibrary {
  if (typeof raw !== 'string' || !raw.trim()) return emptyMediaAssets()
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; assets?: unknown }
    if ((parsed.v !== 1 && parsed.v !== 2 && parsed.v !== 3) || !parsed.assets || typeof parsed.assets !== 'object' || Array.isArray(parsed.assets))
      return emptyMediaAssets()
    const assets: Record<string, MediaAsset> = {}
    for (const [id, value] of Object.entries(parsed.assets)) {
      if (!/^[a-zA-Z0-9/_-]{1,64}$/.test(id)) continue
      const asset = parseAsset(value)
      if (!asset) continue
      assets[id] = asset
    }
    return { v: 1, assets }
  } catch {
    return emptyMediaAssets()
  }
}

export function serializeMediaAssets(library: MediaAssetLibrary): string {
  return JSON.stringify({ v: 2, assets: library.assets })
}

export function rgb565ToImageData(frame: string, width: number, height: number): ImageData | null {
  if (typeof ImageData === 'undefined') return null
  const bytes = decodeBase64(frame)
  if (!bytes || bytes.length !== width * height * 2) return null
  const image = new ImageData(width, height)
  for (let index = 0; index < width * height; index += 1) {
    const pixel = bytes[index * 2] | (bytes[index * 2 + 1] << 8)
    const target = index * 4
    image.data[target] = Math.round(((pixel >> 11) & 31) * 255 / 31)
    image.data[target + 1] = Math.round(((pixel >> 5) & 63) * 255 / 63)
    image.data[target + 2] = Math.round((pixel & 31) * 255 / 31)
    image.data[target + 3] = 255
  }
  return image
}

function imageDataToRgb565(image: ImageData): string {
  const count = image.width * image.height
  const bytes = new Uint8Array(count * 2)
  for (let index = 0; index < count; index += 1) {
    const source = index * 4
    const pixel = ((image.data[source] & 0xf8) << 8)
      | ((image.data[source + 1] & 0xfc) << 3)
      | (image.data[source + 2] >> 3)
    bytes[index * 2] = pixel & 0xff
    bytes[index * 2 + 1] = pixel >> 8
  }
  return encodeBase64(bytes)
}

function outputSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new MediaAssetError('invalid')
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function encodeSource(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, maxSide = MAX_MEDIA_SIDE): { frame: string; width: number; height: number } {
  const size = outputSize(sourceWidth, sourceHeight, maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new MediaAssetError('invalid')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, size.width, size.height)
  return { frame: imageDataToRgb565(context.getImageData(0, 0, size.width, size.height)), ...size }
}

type BrowserImageDecoder = {
  tracks: { ready: Promise<void>; selectedTrack?: { frameCount?: number } }
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>
  close(): void
}

type BrowserImageDecoderConstructor = new (options: { data: ArrayBuffer; type: string }) => BrowserImageDecoder

interface LoadedImage {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  }

  const url = URL.createObjectURL(file)
  return await new Promise<LoadedImage>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new MediaAssetError('invalid'))
    }
    image.src = url
  })
}

async function storeOriginalImage(file: File, width: number, height: number, signal?: AbortSignal): Promise<MediaImageOriginal> {
  const response = await fetch('/api/plugins/screen-display/remote/media/image', {
    method: 'POST', credentials: 'same-origin', body: file, signal,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
  if (!response.ok) throw new MediaAssetError('invalid')
  const original = parseOriginal({ ...await response.json(), width, height })
  if (!original || original.size_bytes !== file.size) throw new MediaAssetError('invalid')
  return original
}

async function decodeStaticImage(file: File, signal?: AbortSignal): Promise<MediaAsset> {
  let image: LoadedImage | null = null
  try {
    image = await loadImage(file)
    if (!image.width || !image.height) throw new MediaAssetError('invalid')
    const encoded = encodeSource(image.source, image.width, image.height)
    return {
      v: 1,
      name: file.name.slice(0, 96),
      format: 'image',
      width: encoded.width,
      height: encoded.height,
      durations: [1000],
      frames: [encoded.frame],
      original: await storeOriginalImage(file, image.width, image.height, signal),
    }
  } catch (error) {
    throw error instanceof MediaAssetError ? error : new MediaAssetError('invalid')
  } finally {
    image?.close()
  }
}

async function decodeAnimatedImage(file: File, format: 'gif' | 'webp', signal?: AbortSignal): Promise<MediaAsset> {
  const Decoder = (globalThis as unknown as { ImageDecoder?: BrowserImageDecoderConstructor }).ImageDecoder
  if (!Decoder) throw new MediaAssetError('unsupported')
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: format === 'gif' ? 'image/gif' : 'image/webp' })
  try {
    await decoder.tracks.ready
    const frameCount = Math.max(1, Number(decoder.tracks.selectedTrack?.frameCount || 1))
    const count = frameCount
    const maxSide = Math.min(MAX_MEDIA_SIDE, Math.floor(Math.sqrt(5_000_000 / (2 * count))))
    const indices = Array.from({ length: count }, (_, index) => Math.min(frameCount - 1, Math.floor(index * frameCount / count)))
    const frames: string[] = []
    const durations: number[] = []
    let width = 0
    let height = 0
    let originalWidth = 0
    let originalHeight = 0
    for (const frameIndex of indices) {
      const decoded = await decoder.decode({ frameIndex })
      const image = decoded.image
      try {
        const encoded = encodeSource(image, image.displayWidth || image.codedWidth, image.displayHeight || image.codedHeight, maxSide)
        originalWidth = image.displayWidth || image.codedWidth
        originalHeight = image.displayHeight || image.codedHeight
        width = encoded.width
        height = encoded.height
        frames.push(encoded.frame)
        const duration = Number(image.duration || 100_000) / 1000
        durations.push(Math.max(16, Math.min(2000, Math.round(duration))))
      } finally {
        image.close()
      }
    }
    if (!frames.length) throw new MediaAssetError('invalid')
    return { v: 1, name: file.name.slice(0, 96), format, width, height, durations, frames,
      original: await storeOriginalImage(file, originalWidth, originalHeight, signal) }
  } catch (error) {
    throw error instanceof MediaAssetError ? error : new MediaAssetError('invalid')
  } finally {
    decoder.close()
  }
}

function waitFor(target: EventTarget, success: string, failure: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new MediaAssetError('invalid'))
    }
    const cleanup = () => {
      target.removeEventListener(success, done)
      target.removeEventListener(failure, failed)
    }
    target.addEventListener(success, done, { once: true })
    target.addEventListener(failure, failed, { once: true })
  })
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.002) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return
  }
  const ready = waitFor(video, 'seeked', 'error')
  video.currentTime = time
  await ready
}

async function decodeVideoFile(file: File, signal?: AbortSignal): Promise<MediaAsset> {
  // Passing the File directly lets the browser and Core proxy stream it to disk.
  // Neither a full ArrayBuffer nor a Base64/JSON copy is created.
  const response = await fetch('/api/plugins/screen-display/remote/media', {
    method: 'POST', credentials: 'same-origin', body: file, signal,
    headers: { 'Content-Type': 'video/mp4' },
  })
  if (!response.ok) throw new MediaAssetError('invalid')
  const asset = parseAsset({ ...await response.json(), name: file.name.slice(0, 96) })
  if (!asset || asset.v !== 3) throw new MediaAssetError('invalid')
  return asset
}

interface NalUnit { bytes: Uint8Array; type: number }

function annexBUnits(data: Uint8Array): NalUnit[] {
  const starts: number[] = []
  for (let index = 0; index + 3 < data.length; index += 1) {
    if (data[index] !== 0 || data[index + 1] !== 0) continue
    if (data[index + 2] === 1) {
      starts.push(index)
      index += 2
    } else if (data[index + 2] === 0 && data[index + 3] === 1) {
      starts.push(index)
      index += 3
    }
  }
  return starts.flatMap((start, index): NalUnit[] => {
    const prefix = data[start + 2] === 1 ? 3 : 4
    const end = index + 1 < starts.length ? starts[index + 1] : data.length
    const bytes = data.subarray(start + prefix, end)
    return bytes.length ? [{ bytes, type: bytes[0] & 0x1f }] : []
  })
}

function firstMacroblock(unit: Uint8Array): number | null {
  const rbsp: number[] = []
  for (let index = 1, zeros = 0; index < unit.length; index += 1) {
    const byte = unit[index]
    if (zeros >= 2 && byte === 3) {
      zeros = 0
      continue
    }
    rbsp.push(byte)
    zeros = byte === 0 ? zeros + 1 : 0
  }
  let bit = 0
  const read = () => {
    if (bit >= rbsp.length * 8) return -1
    const value = (rbsp[Math.floor(bit / 8)] >> (7 - bit % 8)) & 1
    bit += 1
    return value
  }
  let leading = 0
  while (read() === 0) {
    leading += 1
    if (leading > 31) return null
  }
  let value = (1 << leading) - 1
  for (let index = leading - 1; index >= 0; index -= 1) {
    const next = read()
    if (next < 0) return null
    value += next << index
  }
  return value
}

function accessUnits(units: NalUnit[]): NalUnit[][] {
  const result: NalUnit[][] = []
  let current: NalUnit[] = []
  let hasSlice = false
  const flush = () => {
    if (current.some((unit) => unit.type === 1 || unit.type === 5)) result.push(current)
    current = []
    hasSlice = false
  }
  for (const unit of units) {
    const slice = unit.type === 1 || unit.type === 5
    if ((unit.type === 9 && current.length) || (slice && hasSlice && firstMacroblock(unit.bytes) === 0)) flush()
    current.push(unit)
    if (slice) hasSlice = true
  }
  flush()
  return result
}

function encodeAccessUnit(units: NalUnit[]): Uint8Array {
  const size = units.reduce((sum, unit) => sum + 4 + unit.bytes.length, 0)
  const encoded = new Uint8Array(size)
  let offset = 0
  for (const unit of units) {
    encoded.set([0, 0, 0, 1], offset)
    offset += 4
    encoded.set(unit.bytes, offset)
    offset += unit.bytes.length
  }
  return encoded
}

async function decodeRawH264(file: File): Promise<MediaAsset> {
  const Decoder = (globalThis as unknown as { VideoDecoder?: typeof VideoDecoder }).VideoDecoder
  const Chunk = (globalThis as unknown as { EncodedVideoChunk?: typeof EncodedVideoChunk }).EncodedVideoChunk
  if (!Decoder || !Chunk) throw new MediaAssetError('unsupported')
  const units = annexBUnits(new Uint8Array(await file.arrayBuffer()))
  const sps = units.find((unit) => unit.type === 7)?.bytes
  const chunks = accessUnits(units)
  const maxSide = Math.min(160, Math.floor(Math.sqrt(5_000_000 / (2 * Math.max(1, chunks.length)))))
  if (!sps || sps.length < 4 || !chunks.length) throw new MediaAssetError('invalid')
  const codec = `avc1.${[sps[1], sps[2], sps[3]].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  const frames: string[] = []
  let width = 0
  let height = 0
  let outputError: unknown = null
  const decoder = new Decoder({
    output(frame) {
      try {
        const encoded = encodeSource(frame, frame.displayWidth || frame.codedWidth, frame.displayHeight || frame.codedHeight, maxSide)
        width = encoded.width
        height = encoded.height
        frames.push(encoded.frame)
      } catch (error) {
        outputError = error
      } finally {
        frame.close()
      }
    },
    error(error) { outputError = error },
  })
  try {
    const config = { codec, optimizeForLatency: true, avc: { format: 'annexb' } } as unknown as VideoDecoderConfig
    const support = await Decoder.isConfigSupported(config)
    if (!support.supported) throw new MediaAssetError('unsupported')
    decoder.configure(config)
    chunks.forEach((units, index) => decoder.decode(new Chunk({
      type: units.some((unit) => unit.type === 5) ? 'key' : 'delta',
      timestamp: Math.round(index * 1_000_000 / 60),
      duration: Math.round(1_000_000 / 60),
      data: encodeAccessUnit(units),
    })))
    await decoder.flush()
    if (outputError || !frames.length) throw new MediaAssetError('invalid')
    return {
      v: 1, name: file.name.slice(0, 96), format: 'h264', width, height,
      durations: frames.map((_, index) => Math.round((index + 1) * 1000 / 60) - Math.round(index * 1000 / 60)), frames,
    }
  } catch (error) {
    throw error instanceof MediaAssetError ? error : new MediaAssetError('invalid')
  } finally {
    decoder.close()
  }
}

export async function importMediaFile(file: File, signal?: AbortSignal): Promise<MediaAsset> {
  const name = file.name.toLowerCase()
  if (file.type === 'image/gif' || name.endsWith('.gif')) return decodeAnimatedImage(file, 'gif', signal)
  if (file.type === 'image/webp' || name.endsWith('.webp')) return decodeAnimatedImage(file, 'webp', signal)
  if (name.endsWith('.h264') || name.endsWith('.264')) return decodeRawH264(file)
  if (file.type.startsWith('video/') || name.endsWith('.mp4') || name.endsWith('.m4v')) return decodeVideoFile(file, signal)
  if (file.type.startsWith('image/') || /\.(png|jpe?g|bmp|avif)$/i.test(name)) return decodeStaticImage(file, signal)
  throw new MediaAssetError('unsupported')
}

/** Select by elapsed time, so a late browser frame never slows playback. */
export function mediaFrameIndex(durations: number[], elapsed: number, loop = true): number {
  const cycle = durations.reduce((sum, duration) => sum + duration, 0)
  if (!cycle || !durations.length) return 0
  if (!loop && elapsed >= cycle) return durations.length - 1
  let cursor = Math.max(0, elapsed) % cycle
  for (let index = 0; index < durations.length; index++) {
    if (cursor < durations[index]) return index
    cursor -= durations[index]
  }
  return durations.length - 1
}
