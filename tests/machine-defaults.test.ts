import { expect, test } from 'bun:test'
import layout from '../src/shared/default-layouts/nanokvm-pro-desk.json'
import goLayout from '../src/shared/default-layouts/nanokvm-go.json'
import picoLayout from '../src/shared/default-layouts/picokvm.json'
import { DASHBOARD_CLOCK } from '../src/shared/dashboard'
import background from '../src/shared/default-background.json'
import { parseMachineDefaults, restoreMachineDefaults } from '../web/display/machine-defaults'
import { readHomeLayout } from '../src/shell/homeLayout'

function defaults() {
  return parseMachineDefaults(JSON.stringify({ layout_json: JSON.stringify(layout), background_image: JSON.stringify(background),
    media_assets: JSON.stringify({ v: 1, assets: { 'screen-default-background': { v: 1, format: 'image', width: background.width, height: background.height, frames: [background.pixels], durations: [100] } } }) }))!
}

test('model defaults restore independently while retaining the user media library', () => {
  const preset = defaults()
  const restored = restoreMachineDefaults(preset, { v: 1, assets: { custom: preset.mediaAssets.assets['screen-default-background']! } })
  expect(restored.layout.dashboard_clock).toEqual({ x: 77.96875, y: 13.953488372093023, scale: 1.5 })
  expect(restored.layout.home_widgets).toHaveLength(15)
  expect(restored.mediaAssets.assets.custom).toBeDefined()
  expect(restored.mediaAssets.assets[restored.layout.background_asset!]).toBeDefined()
  restored.layout.dashboard_clock!.scale = 1
  expect(preset.layout.dashboard_clock!.scale).toBe(1.5)
  expect(parseMachineDefaults(undefined)).toBeNull()
  expect(parseMachineDefaults('{}')).toBeNull()
  expect(parseMachineDefaults('{')).toBeNull()
})

test('the captured model layout renders live data and the same clock in the native shell', () => {
  const previous = globalThis.onekvm
  try {
    globalThis.onekvm = { get: key => key === 'layout' ? JSON.stringify(layout) : key === 'system' ? JSON.stringify({ network: { primary_ip: '192.0.2.8', ip: '192.0.2.8' } }) : '' }
    const home = readHomeLayout()
    expect(home.clock).toEqual(layout.dashboard_clock)
    expect(home.clockFormat).toBe('12h')
    expect(home.widgets.filter(widget => widget.statusIcon)).toHaveLength(5)
    expect(layout.home_widgets.find(widget => widget.id === 'dashboard-ip')!.text).toBe('{ip}')
    expect(home.widgets.find(widget => widget.id === 'dashboard-network-card')!.background).toBe(0x99201911)
  } finally { globalThis.onekvm = previous }
})

test('the Go model layout fits its landscape panel and has no Ethernet icon', () => {
  const previous = globalThis.onekvm
  try {
    for (const widget of goLayout.home_widgets) {
      const x = widget.x * 284 / 100, y = widget.y * 240 / 100
      expect(x - widget.width / 2).toBeGreaterThanOrEqual(0)
      expect(x + widget.width / 2).toBeLessThanOrEqual(284)
      expect(y - widget.height / 2).toBeGreaterThanOrEqual(0)
      expect(y + widget.height / 2).toBeLessThanOrEqual(240)
    }
    globalThis.onekvm = { get: key => key === 'layout' ? JSON.stringify(goLayout) : key === 'system' ? JSON.stringify({ network: { primary_ip: '192.0.2.8', ip: '192.0.2.8' } }) : '' }
    const home = readHomeLayout()
    expect(home.clock).toEqual(goLayout.dashboard_clock)
    expect(home.widgets.filter(widget => widget.statusIcon)).toHaveLength(4)
    for (const widget of goLayout.home_widgets) {
      const placed = home.widgets.find(item => item.id === widget.id)
      expect([placed?.width, placed?.height]).toEqual([widget.width, widget.height])
    }
    expect(goLayout.home_widgets.some(widget => (widget as { status?: string }).status === 'eth')).toBe(false)
  } finally { globalThis.onekvm = previous }
})

test('the PicoKVM model layout fits its square panel without overlap or Wi-Fi', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ left: x * 240 / 100 - width / 2, right: x * 240 / 100 + width / 2, top: y * 240 / 100 - height / 2, bottom: y * 240 / 100 + height / 2 })
  const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  const inside = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom
  const placed = picoLayout.home_widgets.map(widget => ({ ...widget, box: box(widget.x, widget.y, widget.width, widget.height) }))
  for (const widget of placed) {
    expect(widget.box.left).toBeGreaterThanOrEqual(0)
    expect(widget.box.right).toBeLessThanOrEqual(240)
    expect(widget.box.top).toBeGreaterThanOrEqual(0)
    expect(widget.box.bottom).toBeLessThanOrEqual(240)
  }
  const cards = placed.filter(widget => widget.kind === 'rect')
  const content = placed.filter(widget => widget.kind !== 'rect')
  for (const [index, card] of cards.entries())
    for (const other of cards.slice(index + 1)) expect(overlap(card.box, other.box)).toBe(false)
  for (const [index, widget] of content.entries())
    for (const other of content.slice(index + 1)) expect([widget.id, other.id, overlap(widget.box, other.box)]).toEqual([widget.id, other.id, false])
  // Ethernet and HDMI sit on the card they describe; USB HID and live sessions share the clock's row.
  for (const widget of content.filter(item => !['dashboard-hid', 'dashboard-live'].includes(item.id)))
    expect([widget.id, cards.some(card => inside(widget.box, card.box))]).toEqual([widget.id, true])
  const clock = box(picoLayout.dashboard_clock.x, picoLayout.dashboard_clock.y, DASHBOARD_CLOCK.width * picoLayout.dashboard_clock.scale, DASHBOARD_CLOCK.height * picoLayout.dashboard_clock.scale)
  expect(clock.left).toBeGreaterThanOrEqual(0)
  expect(clock.right).toBeLessThanOrEqual(240)
  for (const widget of placed) expect([widget.id, overlap(clock, widget.box)]).toEqual([widget.id, false])
  expect(picoLayout.home_widgets.some(widget => (widget as { status?: string }).status === 'wifi')).toBe(false)
  const previous = globalThis.onekvm
  try {
    globalThis.onekvm = { get: key => key === 'layout' ? JSON.stringify(picoLayout) : key === 'system' ? JSON.stringify({ network: { primary_ip: '192.0.2.8', ip: '192.0.2.8' } }) : '' }
    const home = readHomeLayout()
    expect(home.clock).toEqual(picoLayout.dashboard_clock)
    expect(home.widgets.filter(widget => widget.statusIcon).map(widget => widget.statusIcon)).toEqual(['hid', 'live', 'eth', 'hdmi'])
    for (const widget of picoLayout.home_widgets) {
      const shown = home.widgets.find(item => item.id === widget.id)
      expect([shown?.width, shown?.height]).toEqual([widget.width, widget.height])
    }
  } finally { globalThis.onekvm = previous }
})
