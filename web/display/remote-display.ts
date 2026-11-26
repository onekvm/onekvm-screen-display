export interface RemoteFrame {
  ready: boolean
  width: number
  height: number
  sequence: number
  pixels: string
  controls: string[]
  blanked: boolean
}

export interface GesturePoint { x: number; y: number; t: number }

export function remotePoint(clientX: number, clientY: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, width: number, height: number) {
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor((clientX - rect.left) * width / rect.width))),
    y: Math.max(0, Math.min(height - 1, Math.floor((clientY - rect.top) * height / rect.height))),
  }
}

export function remotePixels(frame: RemoteFrame) {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width * frame.height > 1024 * 1024)
    throw new Error('Invalid screen dimensions')
  const raw = atob(frame.pixels)
  if (raw.length !== frame.width * frame.height * 2) throw new Error('Invalid screen frame')
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4)
  for (let i = 0; i < raw.length / 2; i += 1) {
    const pixel = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8)
    rgba[i * 4] = Math.round(((pixel >> 11) & 31) * 255 / 31)
    rgba[i * 4 + 1] = Math.round(((pixel >> 5) & 63) * 255 / 63)
    rgba[i * 4 + 2] = Math.round((pixel & 31) * 255 / 31)
    rgba[i * 4 + 3] = 255
  }
  return rgba
}
