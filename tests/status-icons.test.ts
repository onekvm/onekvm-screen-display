import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { statusIconBadge, statusIconRects } from '../src/shared/statusIcons'
import { DASHBOARD_CLOCK, dashboardClock, dashboardWidgets } from '../src/shared/dashboard'

const sources = ['eth', 'hdmi', 'hid', 'wifi', 'live'] as const

test('status icons preserve square pixels and their proportions in wide and tall components', () => {
  for (const source of sources) {
    const square = statusIconRects(source, 28, 28)
    for (const [width, height] of [[84, 28], [28, 84], [56, 56]]) {
      const scale = Math.min(width, height) / 28
      const left = (width - 28 * scale) / 2
      const top = (height - 28 * scale) / 2
      const actual = statusIconRects(source, width, height)
      assert.equal(actual.length, square.length)
      actual.forEach((rect, i) => {
        assert.equal(rect.x, left + square[i].x * scale)
        assert.equal(rect.y, top + square[i].y * scale)
        assert.equal(rect.width, square[i].width * scale)
        assert.equal(rect.height, square[i].height * scale)
        assert.equal(rect.opacity, square[i].opacity)
        assert(rect.opacity > 0 && rect.opacity <= 1)
        assert(rect.x >= 0 && rect.x + rect.width <= width)
        assert(rect.y >= 0 && rect.y + rect.height <= height)
      })
    }
    assert(square.some(rect => rect.opacity < 1), `${source} retains antialiased edges`)
  }
})

test('Pro overview puts full-size icons, session count and clock on one nonoverlapping header row', () => {
  const widgets = dashboardWidgets(320, 172)
  const clock = dashboardClock(320, 172)
  const statuses = widgets.filter(widget => widget.kind === 'status')
  const bounds = statuses.map(widget => ({
    id: widget.id, left: widget.x * 3.2 - widget.height / 2,
    right: widget.x * 3.2 + widget.height / 2,
    top: widget.y * 1.72 - widget.height / 2,
    bottom: widget.y * 1.72 + widget.height / 2,
  })).sort((a, b) => a.left - b.left)
  for (const widget of statuses.filter(widget => widget.status_style === 'icon' && widget.status !== 'live')) {
    assert.equal(widget.width, 28)
    assert.equal(widget.height, 28)
    assert(Math.abs(widget.y - clock.y) < 0.001)
  }
  for (let i = 1; i < bounds.length; i++) assert(Math.abs(bounds[i].left - bounds[i - 1].right - 6) < 0.001)
  const live = statuses.find(widget => widget.status === 'live')!
  const badge = statusIconBadge('live', live.width, live.height, 100)!
  assert(live.x * 3.2 - live.width / 2 + badge.x + badge.width <= clock.x * 3.2 - DASHBOARD_CLOCK.width / 2)
  assert.equal(clock.x * 3.2 + DASHBOARD_CLOCK.width / 2, 308)
  const body = widgets.find(widget => widget.id === 'dashboard-network-card')!
  assert(body.y * 1.72 - body.height / 2 > Math.max(...bounds.map(rect => rect.bottom)))
  assert(!widgets.some(widget => widget.id === 'dashboard-brand'))
})

test('live counts use a corner badge with bounded geometry and no badge at zero', () => {
  for (const count of [0, -1, NaN, Infinity]) assert.equal(statusIconBadge('live', 44, 28, count), null)
  assert.equal(statusIconBadge('eth', 28, 28, 2), null)
  for (const [count, text] of [[1, '1'], [2, '2'], [12, '12'], [99, '99'], [100, '99+'], [10000, '99+']] as const) {
    for (const [width, height] of [[44, 28], [40, 24], [28, 28], [84, 28], [28, 84], [2, 1]]) {
      const badge = statusIconBadge('live', width, height, count)!
      assert.equal(badge.text, text)
      assert(badge.x >= 0 && badge.y >= 0)
      assert(badge.x + badge.width <= width)
      assert(badge.y + badge.height <= height)
    }
  }
  const widgets = dashboardWidgets(320, 172)
  const live = widgets.find(widget => widget.status === 'live')!
  assert.equal(live.status_style, 'icon')
  assert.equal(live.text, '')
})
