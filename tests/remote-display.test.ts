import { test, expect } from 'bun:test'
import { remotePoint, remotePixels, type RemoteFrame } from '../web/display/remote-display'

test('remote input scales to logical panel dimensions and stays within the panel', () => {
  const rect = { left: 20, top: 40, width: 640, height: 344 }
  expect(remotePoint(340, 212, rect, 320, 172)).toEqual({ x: 160, y: 86 })
  expect(remotePoint(-10, 1000, rect, 320, 172)).toEqual({ x: 0, y: 171 })
})
test('remote snapshots preserve RGB565 colour and reject truncated payloads', () => {
  const frame = { width: 2, height: 1, pixels: btoa(String.fromCharCode(0, 248, 31, 0)) } as RemoteFrame
  expect([...remotePixels(frame)]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  expect(() => remotePixels({ ...frame, width: 3 })).toThrow()
})

test('new home styles include a device overview while preserving saved clock selections', async () => {
  const { BUILTIN_FACES, parseLayout } = await import('../web/display/types')
  expect(BUILTIN_FACES.map((face) => face.id)).toContain('screen-display/flip')
  expect(parseLayout('').face).toBe('screen-display/dashboard')
  expect(parseLayout('{"face":"screen-display/classic"}').face).toBe('screen-display/classic')
})
