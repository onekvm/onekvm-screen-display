import { DASHBOARD_CLOCK } from '../../src/shared/dashboard'
import { homeWidgetSize } from '../../src/shared/homeWidgets'
import { CLOCK_WIDGET_ID, placementKind, type ScreenLayout, type PanelInfo } from './types'
import type { DesignBox } from './designer-arrange'

export function layoutBoxes(layout: ScreenLayout, panel: PanelInfo, ids: readonly string[]): DesignBox[] {
  return ids.flatMap(id => {
    if (id === CLOCK_WIDGET_ID) {
      const dashboard = layout.face === 'screen-display/dashboard'
      const clock = dashboard ? layout.dashboard_clock || layout.clock : layout.clock
      const size = Math.min(panel.width, panel.height) * (layout.face === 'screen-display/digital' ? 1.15 : 1)
      return [{ id, x: clock.x / 100 * panel.width, y: clock.y / 100 * panel.height,
        width: (dashboard ? DASHBOARD_CLOCK.width : size) * clock.scale, height: (dashboard ? DASHBOARD_CLOCK.height : size) * clock.scale }]
    }
    const item = layout.home_widgets.find(item => item.id === id)
    if (!item) return []
    const size = homeWidgetSize(placementKind(item), item)
    return [{ id, x: (item.x ?? 50) / 100 * panel.width, y: (item.y ?? 50) / 100 * panel.height,
      width: size.width * (item.scale ?? 1), height: size.height * (item.scale ?? 1) }]
  })
}

export function positionLayout(layout: ScreenLayout, positions: readonly { id: string; x: number; y: number }[]): ScreenLayout {
  const byId = new Map(positions.map(p => [p.id, p]))
  const clock = byId.get(CLOCK_WIDGET_ID)
  const key = layout.face === 'screen-display/dashboard' ? 'dashboard_clock' : 'clock'
  return { ...layout, ...(clock ? { [key]: { ...(layout[key] || layout.clock), x: clock.x, y: clock.y } } : {}),
    home_widgets: layout.home_widgets.map(p => {
      const next = byId.get(p.id)
      return next ? { ...p, x: next.x, y: next.y } : p
    }) }
}
