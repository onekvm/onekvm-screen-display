import { expect, test } from 'bun:test'
import { screenVideoConfig, ScreenVideoReader } from '../web/display/screen-video'

function packet(payload: number[] = [0, 0, 0, 1, 0x65]) {
  const bytes = new Uint8Array(24 + payload.length)
  const header = new DataView(bytes.buffer)
  header.setUint32(0, 0x4f4b5346)
  header.setUint32(4, payload.length)
  header.setBigUint64(8, 1234567n)
  header.setUint16(16, 320)
  header.setUint16(18, 172)
  header.setUint8(20, 3)
  header.setUint8(21, 1)
  bytes.set(payload, 24)
  return bytes
}

test('H.264 prefers hardware decoding and supports browsers without a hardware decoder', async () => {
  expect((await screenVideoConfig(async config => ({ supported: true, config })))?.hardwareAcceleration).toBe('prefer-hardware')
  const software = await screenVideoConfig(async config => ({ supported: config.hardwareAcceleration === 'no-preference', config }))
  expect(software?.codec).toBe('avc1.42E01E')
  expect(software?.hardwareAcceleration).toBe('no-preference')
  expect(await screenVideoConfig(async config => ({ supported: false, config }))).toBeNull()
})

test('H.264 packets survive fragmentation, coalescing and idle heartbeats', () => {
  const reader = new ScreenVideoReader()
  const first = packet()
  expect(reader.push(first.slice(0, 17))).toHaveLength(0)
  const combined = new Uint8Array(first.length - 17 + 24)
  combined.set(first.slice(17))
  combined.set(packet([]), first.length - 17)
  const frames = reader.push(combined)
  expect(frames).toHaveLength(2)
  expect(frames[0]).toMatchObject({ width: 320, height: 172, timestamp: 1234567, keyframe: true, blanked: true })
  expect([...frames[0]!.data]).toEqual([0, 0, 0, 1, 0x65])
  expect(frames[1]!.data.length).toBe(0)
  reader.finish()
})

test('bad versions, oversized packets and interrupted frames fail before decoding', () => {
  const bad = packet()
  bad[21] = 2
  expect(() => new ScreenVideoReader().push(bad)).toThrow()
  const oversized = packet()
  new DataView(oversized.buffer).setUint32(4, 2 * 1024 * 1024)
  expect(() => new ScreenVideoReader().push(oversized)).toThrow()
  const truncated = new ScreenVideoReader()
  truncated.push(packet().slice(0, 25))
  expect(() => truncated.finish()).toThrow()
})
