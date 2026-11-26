import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { homeLayerOrder } from '../src/shared/homeLayers'
import { readHomeLayout } from '../src/shell/homeLayout'
import { parseLayout } from '../web/display/types'

test('legacy layer order keeps the clock behind widgets and new widgets in front', () => {
  assert.deepEqual(homeLayerOrder(['card', 'video'], undefined), ['clock', 'card', 'video'])
  assert.deepEqual(homeLayerOrder(['card', 'video', 'label'], ['video', 'clock', 'card']), ['video', 'clock', 'card', 'label'])
})

test('stale and duplicate layer IDs cannot hide valid layers', () => {
  assert.deepEqual(homeLayerOrder(['card', 'video'], ['deleted', 'video', null, 'video', 3]), ['clock', 'video', 'card'])
  assert.deepEqual(homeLayerOrder([], {}), ['clock'])
})

test('layer changes survive saving without changing placement or grid order', () => {
  const home_widgets = [
    { id: 'card', kind: 'rect', column: 2, row: 1 },
    { id: 'video', kind: 'media', column: 1, row: 2 },
  ]
  const saved = parseLayout(JSON.stringify({ mode: 'grid', home_widgets, layer_order: ['video', 'clock', 'card'] }))
  const reloaded = parseLayout(JSON.stringify(saved))
  assert.deepEqual(reloaded.layer_order, ['video', 'clock', 'card'])
  assert.deepEqual(reloaded.home_widgets.map(({ id, column, row }) => ({ id, column, row })), home_widgets.map(({ id, column, row }) => ({ id, column, row })))
})

test('device layer order includes the clock, skips hidden layers and retains native media slots', () => {
  const previous = globalThis.onekvm
  const layout = {
    face: 'screen-display/dashboard', dashboard_layout: true, mode: 'free',
    home_widgets: [
      { id: 'hidden', widget: 'screen-display/media', hidden: true },
      { id: 'card', widget: 'screen-display/rect' },
      { id: 'video', widget: 'screen-display/media' },
      { id: 'label', widget: 'screen-display/text' },
    ],
    layer_order: ['hidden', 'video', 'clock', 'label', 'card'],
  }
  globalThis.onekvm = { get: key => key === 'layout' ? JSON.stringify(layout) : '' }
  try {
    let home = readHomeLayout()
    assert.deepEqual(home.widgets.map(widget => widget.id), ['video', 'label', 'card'])
    assert.equal(home.clockLayer, 1)
    assert.equal(home.widgets[0].mediaSlot, 2)
    layout.layer_order = ['card', 'label', 'clock', 'hidden', 'video']
    home = readHomeLayout()
    assert.deepEqual(home.widgets.map(widget => widget.id), ['card', 'label', 'video'])
    assert.equal(home.clockLayer, 2)
    assert.equal(home.widgets[2].mediaSlot, 2)
  } finally {
    globalThis.onekvm = previous
  }
})

test('native home uses the real session count and switches between icons and legacy state images', () => {
  const previous = globalThis.onekvm
  let sessionCount = 2
  const placement = { id: 'live', widget: 'screen-display/status', status: 'live', status_style: 'icon', show_border: false, status_active_image: 'on', text: '{session_count}' }
  globalThis.onekvm = { get: key => key === 'layout' ? JSON.stringify({ face: 'screen-display/dashboard', dashboard_layout: true, home_widgets: [placement] }) : key === 'system' ? JSON.stringify({ video: { active: true, session_count: sessionCount } }) : '' }
  try {
    let widget = readHomeLayout().widgets[0]
    assert.equal(widget.text, '2')
    assert.equal(widget.active, true)
    assert.equal(widget.statusIcon, 'live')
    assert.equal(widget.statusCount, 2)
    placement.text = 'LIVE'
    sessionCount = 3
    assert.equal(readHomeLayout().widgets[0].statusCount, 3)
    assert.equal(widget.statusImage, false)
    assert.equal(widget.showBorder, false)
    sessionCount = 0
    widget = readHomeLayout().widgets[0]
    assert.equal(widget.text, 'LIVE')
    assert.equal(widget.active, false)
    assert.equal(widget.statusCount, 0)
    placement.status_style = 'image'
    sessionCount = 1
    assert.equal(readHomeLayout().widgets[0].statusImage, true)
    assert.equal(readHomeLayout().widgets[0].statusCount, null)
  } finally { globalThis.onekvm = previous }
})
