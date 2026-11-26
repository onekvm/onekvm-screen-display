export interface ScreenVideoPacket {
  width: number
  height: number
  timestamp: number
  keyframe: boolean
  blanked: boolean
  data: Uint8Array<ArrayBuffer>
}

export async function screenVideoConfig(supports: (config: VideoDecoderConfig) => Promise<VideoDecoderSupport>): Promise<VideoDecoderConfig | null> {
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
    const config: VideoDecoderConfig = { codec: 'avc1.42E01E', optimizeForLatency: true, hardwareAcceleration }
    if ((await supports(config)).supported) return config
  }
  return null
}

/** HTTP chunks and H.264 access units have independent boundaries. */
export class ScreenVideoReader {
  private pending = new Uint8Array(0)

  push(bytes: Uint8Array): ScreenVideoPacket[] {
    const combined = new Uint8Array(this.pending.length + bytes.length)
    combined.set(this.pending)
    combined.set(bytes, this.pending.length)
    const packets: ScreenVideoPacket[] = []
    let offset = 0
    while (combined.length - offset >= 24) {
      const header = new DataView(combined.buffer, offset, 24)
      if (header.getUint32(0) !== 0x4f4b5346 || header.getUint8(21) !== 1) throw new Error('Invalid screen video header')
      const size = header.getUint32(4)
      if (size > 1024 * 1024) throw new Error('Screen video packet too large')
      if (combined.length - offset < 24 + size) break
      const width = header.getUint16(16)
      const height = header.getUint16(18)
      if (size && (!width || !height || width * height > 1024 * 1024)) throw new Error('Invalid screen video dimensions')
      packets.push({
        width, height, timestamp: Number(header.getBigUint64(8)),
        keyframe: Boolean(header.getUint8(20) & 1), blanked: Boolean(header.getUint8(20) & 2),
        data: combined.slice(offset + 24, offset + 24 + size),
      })
      offset += 24 + size
    }
    this.pending = combined.slice(offset)
    return packets
  }

  finish() {
    if (this.pending.length) throw new Error('Truncated screen video packet')
  }
}
