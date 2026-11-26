import { expect, test } from 'bun:test'
import { fitEnd, rowTexts } from '../src/shell/textFit'
import { FONT } from '../src/shell/ui'

// 8 px per character for titles, 7 for values, 6 for tags.
const measure = (text: string, slot: number) => Array.from(text).length * (slot === FONT.base ? 8 : slot === FONT.sm ? 7 : 6)
const ssid = 'Conference Room Guest Network 5G'
const pills = (tags: string[]) => tags.reduce((width, tag, index) => width + measure(tag, FONT.xs) + 8 + (index ? 4 : 0), 0)

test('fitEnd keeps the start and marks the cut', () => {
  expect(fitEnd('Office', 100, FONT.sm, measure)).toBe('Office')
  expect(fitEnd(ssid, 70, FONT.sm, measure)).toBe('Conferenc…')
  // A cut before a space does not leave it before the mark.
  expect(fitEnd(ssid, 84, FONT.sm, measure)).toBe('Conference…')
  expect(fitEnd(ssid, 3, FONT.sm, measure)).toBe('…')
})

test('a long value is cut at the padding, after the title and tags', () => {
  for (const width of [200, 244, 280]) {
    const fitted = rowTexts({ width, icon: true, title: 'wlan0', value: ssid, tags: ['Connected'] }, measure)
    expect(fitted.title).toBe('wlan0')
    expect(fitted.tags).toEqual(['Connected'])
    expect(fitted.value.endsWith('…')).toBe(true)
    const label = Math.max(measure('wlan0', FONT.base), pills(['Connected']))
    expect(24 + 56 + label + 12 + measure(fitted.value, FONT.sm)).toBeLessThanOrEqual(width)
  }
  expect(rowTexts({ width: 600, icon: true, title: 'wlan0', value: ssid }, measure).value).toBe(ssid)
})

test('text that fits whole may use part of the right padding', () => {
  // 15 title characters = 120 px in a 132 px text area, 4 px past the padding is allowed.
  expect(rowTexts({ width: 152, title: 'Confirm passwor' }, measure).title).toBe('Confirm passwor')
  // One more character leaves less than 4 px to the edge: cut at the padding.
  expect(rowTexts({ width: 133, title: 'Confirm password' }, measure).title).toBe('Confirm pass…')
  // Title 32 + gap 12 + value 91 = 135 px > 132 px space, 3 px into the padding.
  expect(rowTexts({ width: 156, title: 'Mask', value: '255.255.255.0' }, measure).value).toBe('255.255.255.0')
  expect(rowTexts({ width: 150, title: 'Mask', value: '255.255.255.0' }, measure).value).toBe('255.255.25…')
})

test('a value or tag cut to fewer than three characters is left out', () => {
  // A 172 px portrait panel: 132 px rows. The title then has the whole row.
  expect(rowTexts({ width: 132, icon: true, title: 'wlan0', value: ssid, tags: ['Connected'] }, measure)).toEqual({ title: 'wlan0', value: '', tags: ['Connec…'] })
  expect(rowTexts({ width: 132, title: 'Office', tags: ['Wi-Fi 6', '2.4G', '5G', 'WPA2'] }, measure)).toEqual({ title: 'Office', value: '', tags: ['Wi-Fi 6', '2.4G', '5G'] })
  expect(rowTexts({ width: 110, title: 'Office', tags: ['Wi-Fi 6', '2.4G', '5G', 'WPA2'] }, measure).tags).toEqual(['Wi-Fi 6', '2.4G'])
})

test('a long title is cut to the row', () => {
  const alone = rowTexts({ width: 132, icon: true, title: 'Hotspot (AP)' }, measure)
  expect(alone.title.endsWith('…')).toBe(true)
  expect(24 + 56 + measure(alone.title, FONT.base)).toBeLessThanOrEqual(132)
  const shared = rowTexts({ width: 200, title: 'A very long network interface name', value: ssid }, measure)
  expect(measure(shared.title, FONT.base)).toBeLessThanOrEqual(200 - 24)
  expect(shared.value).toBe('')
})
