import { expect, test } from 'bun:test'
import { formatClockTime, normalizeClockFormat } from '../src/shared/clockFormat'
import { nowParts } from '../src/shell/clock'
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
