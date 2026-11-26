import { expect, test } from 'bun:test'
import layout from '../src/shared/default-layouts/nanokvm-pro-desk.json'
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
