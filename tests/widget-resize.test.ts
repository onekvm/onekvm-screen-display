import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { homeWidgetSize, MAX_HOME_WIDGET_HEIGHT, MAX_HOME_WIDGET_WIDTH } from '../src/shared/homeWidgets'
import { parseLayout } from '../web/display/types'
import { resizeHomeWidget } from '../web/display/widget-resize'

const panel = { width: 320, height: 172 }
const start = { x: 50, y: 50, width: 100, height: 40, scale: 1 }

test('resizing accounts for both preview zoom and widget scale while keeping the upper-left corner', () => {
  const scaled = { ...start, scale: 1.5 }
  const result = resizeHomeWidget(scaled, { x: 60, y: 24 }, panel, { width: 640, height: 344 }, 'free')
  assert.equal(result.width, 120)
  assert.equal(result.height, 48)
  const upperLeft = (widget: typeof scaled) => ({
    x: widget.x / 100 * panel.width - widget.width * widget.scale / 2,
    y: widget.y / 100 * panel.height - widget.height * widget.scale / 2,
  })
  const before = upperLeft(scaled)
  const after = upperLeft({ ...scaled, ...result })
  assert.ok(Math.abs(before.x - after.x) < 1e-9)
  assert.ok(Math.abs(before.y - after.y) < 1e-9)
})

test('grid resizing keeps the cell center and moves the lower-right edge with the pointer', () => {
  const result = resizeHomeWidget(start, { x: 12, y: 6 }, panel, panel, 'grid')
  assert.deepEqual(result, { width: 124, height: 52 })
})

test('dragged sizes survive layout saving at both size limits', () => {
  for (const delta of [{ x: 10000, y: 10000 }, { x: -10000, y: -10000 }]) {
    const result = resizeHomeWidget(start, delta, panel, panel, 'free')
    const saved = parseLayout(JSON.stringify({ mode: 'free', home_widgets: [{ id: 'resized', kind: 'rect', ...result }] })).home_widgets[0]
    assert.equal(saved.width, result.width)
    assert.equal(saved.height, result.height)
    assert.ok(result.width! >= 2 && result.width! <= Math.min(MAX_HOME_WIDGET_WIDTH, panel.width))
    assert.ok(result.height! >= 1 && result.height! <= Math.min(MAX_HOME_WIDGET_HEIGHT, panel.height))
  }
})

test('small panels and collapsed previews do not produce invalid dimensions', () => {
  assert.deepEqual(resizeHomeWidget(start, { x: 1000, y: 1000 }, { width: 80, height: 64 }, panel, 'grid'), { width: 80, height: 64 })
  assert.deepEqual(resizeHomeWidget(start, { x: 12, y: 6 }, panel, { width: 0, height: 0 }, 'free'), {})
})

test('preview, native display and inspector share the default media and label sizes', () => {
  assert.deepEqual(homeWidgetSize('media', {}), { width: 120, height: 68 })
  assert.deepEqual(homeWidgetSize('text', {}), { width: 126, height: 24 })
  assert.deepEqual(homeWidgetSize('status', {}), { width: 64, height: 28 })
  assert.deepEqual(homeWidgetSize('line', { width: Number.NaN, height: -1 }), { width: 104, height: 1 })
})
