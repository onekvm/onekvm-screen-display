import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BUILTIN_HOME_WIDGET_SOURCES,
  expandHomeWidgetTemplate,
  normalizeHomeWidgetStatus,
} from '../src/shared/homeWidgets'
import { canPlaceOnHome, defaultHomeWidgetPlacement, parseLayout, parsePanel, parsePluginApps, prepareHomeLayout } from '../web/display/types'
import { dashboardWidgets } from '../src/shared/dashboard'
import { parseRotations } from '../src/shared/rotation'

test('Pro rotation choices and landscape dimensions come from the screen host', () => {
  const panel = parsePanel(JSON.stringify({ width: 320, height: 172, shape: 'rect', rotations: [0, 180] }))
  assert.deepEqual(panel.rotations, [0, 180])
  assert.equal(panel.width, 320)
  assert.equal(panel.height, 172)
  assert.deepEqual(parseRotations('[0,180]'), [0, 180])
  assert.deepEqual(parseRotations(parsePanel('{}').rotations), [0, 90, 180, 270])
  assert.deepEqual(parseRotations('bad data'), [0, 90, 180, 270])
  assert.deepEqual(parseRotations([0, 0, 999, 180]), [0, 180])
})

test('app-only plugins stay off the home face', () => {
  const [app] = parsePluginApps(JSON.stringify([{
    id: 'stream',
    title: '屏幕串流',
    icon: 'stream.png',
    slots: ['app'],
  }]))

  assert.equal(canPlaceOnHome(app), false)
})

test('the overview materializes editable components once and preserves edits and removals', () => {
  const panel = { width: 320, height: 172 }
  const upgraded = prepareHomeLayout(parseLayout('{"face":"screen-display/dashboard"}'), panel)
  assert.deepEqual(upgraded.home_widgets, dashboardWidgets(320, 172))
  assert.equal(upgraded.home_widgets.find(item => item.id === 'dashboard-ip')?.text, '{ip}')
  const edited = { ...upgraded, home_widgets: upgraded.home_widgets.filter(item => item.id !== 'dashboard-hdmi').map(item => item.id === 'dashboard-ip' ? { ...item, x: 43, accent: '#123456', font_size: 14 } : item) }
  const reloaded = prepareHomeLayout(parseLayout(JSON.stringify(edited)), panel)
  assert.equal(reloaded.home_widgets.some(item => item.id === 'dashboard-hdmi'), false)
  assert.equal(reloaded.home_widgets.find(item => item.id === 'dashboard-ip')?.x, 43)
  assert.equal(reloaded.home_widgets.find(item => item.id === 'dashboard-ip')?.font_size, 14)
  assert.deepEqual(prepareHomeLayout({ ...reloaded, home_widgets: [] }, panel).home_widgets, [])
  assert.deepEqual(reloaded.dashboard_clock, upgraded.dashboard_clock)
  assert.equal(upgraded.clock.x, 50)
})

test('overview live values and progress have useful disconnected defaults', () => {
  const status = normalizeHomeWidgetStatus({})
  assert.equal(expandHomeWidgetTemplate('{video} {cpu_value}', status), 'NO SIGNAL --')
})

test('home templates preserve unknown variables and literal replacement text', () => {
  const status = normalizeHomeWidgetStatus({ network: { hostname: '$&' } })
  assert.equal(expandHomeWidgetTemplate('CPU label', status), 'CPU label')
  assert.equal(expandHomeWidgetTemplate('{hostname}/{hostname} {unknown}', status), '$&/$& {unknown}')
})

test('apps require image metadata and never construct letter fallbacks', () => {
  const apps = parsePluginApps(JSON.stringify([
    { id: 'missing', title: 'Missing' },
    { id: 'legacy', title: 'Legacy', glyph: 'L', icon: 'stream.png' },
    { id: 'blank', icon: ' ' },
    { id: 'stream', title: 'Stream', icon: 'stream.png' },
    { id: 'vpn/main', icon: 'app-icon:vpn/main:123' },
  ]))
  assert.deepEqual(apps.map(app => app.id), ['stream', 'vpn/main'])
  assert.equal(apps[0].icon, 'stream')
  assert.equal(apps[1].icon, 'app-icon:vpn/main:123')
  assert.equal('glyph' in apps[0], false)
})

test('custom home widgets and background survive layout parsing', () => {
  const parsed = parseLayout(JSON.stringify({
    face: 'screen-display/classic',
    mode: 'free',
    background: '#123456',
    home_widgets: [{
      id: 'home-text-1',
      widget: BUILTIN_HOME_WIDGET_SOURCES.text,
      kind: 'text',
      text: 'IP {ip}',
      accent: '#abcdef',
      background: '#101820',
      show_background: true,
      width: 132,
      height: 26,
      x: 44,
      y: 76,
      scale: 1.2,
    }],
  }))

  assert.equal(parsed.background, '#123456')
  assert.deepEqual(parsed.home_widgets[0], {
    id: 'home-text-1',
    widget: BUILTIN_HOME_WIDGET_SOURCES.text,
    kind: 'text',
    text: 'IP {ip}',
    status: undefined,
    accent: '#abcdef',
    inactive: undefined,
    background: '#101820',
    show_background: true,
    filled: undefined,
    hidden: false,
    width: 132,
    height: 26,
    slot: undefined,
    column: 0,
    row: 0,
    x: 44,
    y: 76,
    scale: 1.2,
  })
})

test('built-in widget defaults create editable instances', () => {
  const text = defaultHomeWidgetPlacement(BUILTIN_HOME_WIDGET_SOURCES.text, 'home-text-1')
  const status = defaultHomeWidgetPlacement(BUILTIN_HOME_WIDGET_SOURCES.status, 'home-status-1')
  const media = defaultHomeWidgetPlacement(BUILTIN_HOME_WIDGET_SOURCES.media, 'home-media-1')

  assert.equal(text.text, '{ip}')
  assert.equal(text.show_background, false)
  assert.equal(status.status, 'hdmi')
  assert.equal(status.filled, true)
  assert.equal(media.media_fit, 'contain')
  assert.equal(media.media_speed, 1)
  assert.equal(media.media_loop, true)
})

test('media playback settings survive parsing with compatible defaults', () => {
  const configured = parseLayout(JSON.stringify({
    mode: 'free',
    home_widgets: [{
      id: 'home-media-1',
      widget: BUILTIN_HOME_WIDGET_SOURCES.media,
      kind: 'media',
      media_fit: 'cover',
      media_speed: 1.5,
      media_loop: false,
    }],
  })).home_widgets[0]
  const legacy = parseLayout(JSON.stringify({
    mode: 'free',
    home_widgets: [{ id: 'home-media-2', widget: BUILTIN_HOME_WIDGET_SOURCES.media, kind: 'media' }],
  })).home_widgets[0]

  assert.equal(configured.media_fit, 'cover')
  assert.equal(configured.media_speed, 1.5)
  assert.equal(configured.media_loop, false)
  assert.equal(legacy.media_fit, 'contain')
  assert.equal(legacy.media_speed, 1)
  assert.equal(legacy.media_loop, true)
})

test('legacy fixed placements migrate to freely editable coordinates', () => {
  const parsed = parseLayout(JSON.stringify({
    mode: 'fixed',
    home_widgets: [{
      id: 'home-text-1',
      widget: BUILTIN_HOME_WIDGET_SOURCES.text,
      slot: 'bottom-left',
    }],
  }))

  assert.equal(parsed.mode, 'free')
  assert.equal(parsed.home_widgets[0].x, 34)
  assert.equal(parsed.home_widgets[0].y, 88)
})

test('hidden home widgets survive parsing instead of being removed', () => {
  const parsed = parseLayout(JSON.stringify({
    mode: 'free',
    home_widgets: [{
      id: 'home-text-1',
      widget: BUILTIN_HOME_WIDGET_SOURCES.text,
      hidden: true,
      x: 50,
      y: 64,
    }],
  }))

  assert.equal(parsed.home_widgets.length, 1)
  assert.equal(parsed.home_widgets[0].hidden, true)
})

test('OLED-compatible live variables expand from Core status', () => {
  const status = normalizeHomeWidgetStatus({
    uptime_seconds: 3720,
    video: { active: true, hdmi_connected: true, codec: 'h264', actual_fps: 47, input_width: 1920, input_height: 1080 },
    network: { hostname: 'pro', ip: '192.0.2.5', ethernet_connected: true },
    system: { cpu_percent: 23, memory_used_bytes: 50, memory_total_bytes: 100, storage_available_bytes: 25, storage_total_bytes: 100 },
  })

  assert.equal(
    expandHomeWidgetTemplate('{ip} {resolution} {codec} {fps} {uptime} {cpu_percent} {mem_percent} {disk_percent}', status),
    '192.0.2.5 1920x1080 H264 47 1H02M 23% 50% 75%',
  )
})


test('shared media and state image references survive saving without pixel duplication', () => {
  const parsed = parseLayout(JSON.stringify({ background_asset: 'shared', home_widgets: [
    { id: 'one', kind: 'media', media_asset: 'shared' },
    { id: 'two', kind: 'status', status_active_image: 'on', status_inactive_image: 'off' },
  ] }))
  assert.equal(parsed.background_asset, 'shared')
  assert.equal(parsed.home_widgets[0].media_asset, 'shared')
  assert.equal(parsed.home_widgets[1].status_active_image, 'on')
  assert.equal(parsed.home_widgets[1].status_inactive_image, 'off')
})

test('real session count is independent of encoder activity and rejects malformed values', () => {
  for (const [input, expected] of [[3, 3], [0, 0], [-2, 0], [2.9, 2], ['8', 0], [Infinity, 0], [null, 0]] as const) {
    const status = normalizeHomeWidgetStatus({ video: { active: true, session_count: input } })
    assert.equal(status.sessionCount, expected)
    assert.equal(expandHomeWidgetTemplate('{session_count}', status), String(expected))
  }
  assert.equal(normalizeHomeWidgetStatus({}).sessionCount, 0)
})

test('status appearance survives a round trip while older image layouts keep working', () => {
  const configured = parseLayout(JSON.stringify({ home_widgets: [
    { id: 'one', kind: 'status', status_style: 'icon', show_border: false, status_active_image: 'on' },
    { id: 'two', kind: 'status', status_active_image: 'on' },
  ] }))
  const saved = parseLayout(JSON.stringify(configured))
  assert.equal(saved.home_widgets[0].status_style, 'icon')
  assert.equal(saved.home_widgets[0].show_border, false)
  assert.equal(saved.home_widgets[0].status_active_image, 'on')
  assert.equal(saved.home_widgets[1].status_style, undefined)
})

test('overview includes Wi-Fi and session count within the real panel bounds', () => {
  for (const [width, height] of [[320, 172], [240, 240]]) {
    const widgets = dashboardWidgets(width, height)
    assert(widgets.some(item => item.status === 'wifi' && item.status_style === 'icon'))
    assert(widgets.some(item => item.status === 'live' && item.status_style === 'icon'))
    assert(widgets.filter(item => item.kind === 'status').every(item => item.show_border === false))
    for (const item of widgets) {
      const x = item.x / 100 * width, y = item.y / 100 * height
      assert(x - item.width / 2 >= -0.001 && x + item.width / 2 <= width + 0.001, item.id)
      assert(y - item.height / 2 >= -0.001 && y + item.height / 2 <= height + 0.001, item.id)
    }
  }
})
