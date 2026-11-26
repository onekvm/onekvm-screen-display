export const MAX_BACKGROUND_SOURCE_BYTES = 16 * 1024 * 1024

const MAX_SIDE = 1024
const MAX_PIXELS = 512 * 512

export interface BackgroundImagePayload {
  v: 1
  width: number
  height: number
  pixels: string
}

export interface ParsedBackgroundImage extends BackgroundImagePayload {
  bytes: Uint8Array
}

export class BackgroundImageError extends Error {
  constructor(readonly code: 'invalid' | 'too-large') {
    super(code)
  }
}

function validDimensions(width: number, height: number): boolean {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width >= 1
    && height >= 1
    && width <= MAX_SIDE
    && height <= MAX_SIDE
    && width * height <= MAX_PIXELS
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
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return globalThis.btoa(binary)
}

export function parseBackgroundImage(raw: unknown): ParsedBackgroundImage | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const value = JSON.parse(raw) as Partial<BackgroundImagePayload>
    if (value.v !== 1 || !validDimensions(Number(value.width), Number(value.height)) || typeof value.pixels !== 'string')
      return null
    const width = Number(value.width)
    const height = Number(value.height)
    const bytes = decodeBase64(value.pixels)
    if (!bytes || bytes.length !== width * height * 2) return null
    return { v: 1, width, height, pixels: value.pixels, bytes }
  } catch {
    return null
  }
}

export function serializeBackgroundImage(width: number, height: number, bytes: Uint8Array): string {
  if (!validDimensions(width, height) || bytes.length !== width * height * 2)
    throw new BackgroundImageError('invalid')
  return JSON.stringify({ v: 1, width, height, pixels: encodeBase64(bytes) } satisfies BackgroundImagePayload)
}

export function rgbaToRgb565(image: ImageData): Uint8Array {
  const pixels = image.width * image.height
  const output = new Uint8Array(pixels * 2)
  for (let index = 0; index < pixels; index += 1) {
    const source = index * 4
    const red = image.data[source]
    const green = image.data[source + 1]
    const blue = image.data[source + 2]
    const packed = ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3)
    output[index * 2] = packed & 0xff
    output[index * 2 + 1] = packed >> 8
  }
  return output
}

export function backgroundImageDataUrl(raw: unknown): string {
  const image = parseBackgroundImage(raw)
  if (!image || typeof document === 'undefined') return ''
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) return ''
  const output = context.createImageData(image.width, image.height)
  for (let index = 0; index < image.width * image.height; index += 1) {
    const packed = image.bytes[index * 2] | (image.bytes[index * 2 + 1] << 8)
    const target = index * 4
    output.data[target] = Math.round(((packed >> 11) & 0x1f) * 255 / 31)
    output.data[target + 1] = Math.round(((packed >> 5) & 0x3f) * 255 / 63)
    output.data[target + 2] = Math.round((packed & 0x1f) * 255 / 31)
    output.data[target + 3] = 255
  }
  context.putImageData(output, 0, 0)
  return canvas.toDataURL('image/png')
}

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
      reject(new BackgroundImageError('invalid'))
    }
    image.src = url
  })
}

export async function encodeBackgroundImage(file: File, width: number, height: number): Promise<string> {
  if (file.size > MAX_BACKGROUND_SOURCE_BYTES)
    throw new BackgroundImageError('too-large')
  if ((file.type && !file.type.startsWith('image/')) || !validDimensions(width, height))
    throw new BackgroundImageError('invalid')

  let image: LoadedImage | null = null
  try {
    image = await loadImage(file)
    if (!image.width || !image.height || image.width * image.height > 80_000_000)
      throw new BackgroundImageError('too-large')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new BackgroundImageError('invalid')

    const scale = Math.max(width / image.width, height / image.height)
    const sourceWidth = width / scale
    const sourceHeight = height / scale
    const sourceX = (image.width - sourceWidth) / 2
    const sourceY = (image.height - sourceHeight) / 2
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      image.source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    )
    return serializeBackgroundImage(width, height, rgbaToRgb565(context.getImageData(0, 0, width, height)))
  } catch (error) {
    if (error instanceof BackgroundImageError) throw error
    throw new BackgroundImageError('invalid')
  } finally {
    image?.close()
  }
}
