import { expect, test } from 'bun:test'
import { formatClockTime, normalizeClockFormat } from '../src/shared/clockFormat'
import { CLOCK_CHARS, centeredLabel, clockFont, dashboardClockLayout, nowParts } from '../src/shell/clock'
import { FONT } from '../src/shell/ui'
import { readHomeLayout } from '../src/shell/homeLayout'
import { parseLayout } from '../web/display/types'

test('12-hour time handles midnight, noon and afternoon without changing minutes', () => {
  for (const [hours, hh, period] of [[0, '12', 'AM'], [1, '01', 'AM'], [11, '11', 'AM'], [12, '12', 'PM'], [13, '01', 'PM'], [23, '11', 'PM']] as const) {
    expect(formatClockTime(hours, 7)).toEqual({ hh, mm: '07', period })
    expect(nowParts('en', '12h', new Date(2026, 9, 29, hours, 7, 42))).toMatchObject({ hh, mm: '07', period, ss: 42 })
  }
})

test('24-hour time retains 00–23 and hides the AM/PM label', () => {
  expect(formatClockTime(0, 0, '24h')).toEqual({ hh: '00', mm: '00', period: '' })
  expect(formatClockTime(23, 59, '24h')).toEqual({ hh: '23', mm: '59', period: '' })
})

test('clock text requests its font at the drawn size with every clock character', () => {
  const previous = globalThis.onekvm
  const requests: Array<[number, string]> = []
  try {
    globalThis.onekvm = { font: (px: number, text: string) => { requests.push([px, text]); return [17, 35, 28, 17.592] } }
    expect(clockFont(24)).toEqual({ slot: 17, lineHeight: 35, baseline: 28, capHeight: 17.592 })
    expect(requests).toEqual([[24, CLOCK_CHARS]])
    for (const period of ['AM', 'PM']) {
      for (const char of period) expect(CLOCK_CHARS).toContain(char)
    }
    globalThis.onekvm = { font: () => [] }
    expect(clockFont(18.4).slot).toBe(FONT.base)
    globalThis.onekvm = undefined
    expect(clockFont(16).slot).toBe(FONT.base)
  } finally {
    globalThis.onekvm = previous
  }
})

test('dashboard clock text keeps the bitmap clock positions and centers capitals on y', () => {
  const font = { slot: 16, lineHeight: 24, baseline: 19, capHeight: 11.728 }
  for (const scale of [0.5, 1, 1.5, 2]) {
    const layout = dashboardClockLayout(100, 50, scale, font)
    expect(layout.time.insetL).toBeCloseTo(100 - 1.5 * scale)
    expect(layout.time.insetT).toBeCloseTo(50 - 19 + 5.864)
    expect(layout.period.insetL + layout.period.width / 2).toBeCloseTo(100 - 19.75 * scale)
    expect(layout.period.insetT).toBe(layout.time.insetT)
  }
  // Clock faces center AM/PM's capitals on the old bitmap's center.
  const period = centeredLabel(40, 60, 13.8, { slot: 17, lineHeight: 21, baseline: 16, capHeight: 10.115 })
  expect(period.insetL + period.width / 2).toBeCloseTo(40)
  expect(period.insetT + 16 - 10.115 / 2).toBeCloseTo(60)
})

test('saved clock format defaults to 12-hour and matches the native shell after reopening', () => {
  const previous = globalThis.onekvm
  try {
    for (const input of [undefined, null, 'invalid', '12h', '24h']) {
      const saved = parseLayout(JSON.stringify({ clock_format: input, dashboard_clock: { x: 83.59375, y: 14, scale: 1.5 } }))
      const reopened = parseLayout(JSON.stringify(saved))
      const expected = input === '24h' ? '24h' : '12h'
      expect(normalizeClockFormat(input)).toBe(expected)
      expect(reopened.clock_format).toBe(expected)
      globalThis.onekvm = { get: key => key === 'layout' ? JSON.stringify(reopened) : '' }
      expect(readHomeLayout().clockFormat).toBe(expected)
      expect(readHomeLayout().clock.scale).toBe(1.5)
    }
  } finally {
    globalThis.onekvm = previous
  }
})
