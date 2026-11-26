import { expect, test } from 'bun:test'
import { readHomeLayout } from '../src/shell/homeLayout'
import { parseLayout } from '../web/display/types'

test('double-size clocks survive saving and use the same scale on the device', () => {
  const previous = globalThis.onekvm
  try {
    for (const face of ['screen-display/dashboard', 'screen-display/classic']) {
      const saved = parseLayout(JSON.stringify({
        face, dashboard_layout: true,
        clock: { x: 50, y: 50, scale: 2 },
        dashboard_clock: { x: 79.375, y: 24 / 172 * 100, scale: 2 },
        home_widgets: [{ id: 'label', widget: 'screen-display/text', scale: 2 }],
      }))
      const reloaded = parseLayout(JSON.stringify(saved))
      expect(reloaded.clock.scale).toBe(2)
      expect(reloaded.dashboard_clock?.scale).toBe(2)
      expect(reloaded.home_widgets[0]?.scale).toBe(1.5)
      globalThis.onekvm = { get: key => key === 'layout' ? JSON.stringify(reloaded) : '' }
      expect(readHomeLayout().clock.scale).toBe(2)
    }
  } finally {
    globalThis.onekvm = previous
  }
})
