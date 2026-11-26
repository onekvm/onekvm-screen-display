import { BUILTIN_HOME_WIDGET_SOURCES, type HomeWidgetKind, type HomeStatusSource } from './homeWidgets'

export const MAX_HOME_WIDGETS = 32
export const isDashboardWidget = (id: string) => id.startsWith('dashboard-')
export const DASHBOARD_CLOCK = { width: 78, height: 22, fontSize: 16, periodGap: 8 } as const

export interface DashboardWidget {
  id: string
  widget: string
  kind: HomeWidgetKind
  text: string
  status?: HomeStatusSource
  x: number
  y: number
  width: number
  height: number
  scale: number
  accent: string
  inactive: string
  background: string
  status_style?: 'text' | 'icon' | 'image'
  show_border?: boolean
  show_background: boolean
  filled: boolean
  radius: number
  font_size: number
  text_align: 'left' | 'center' | 'right'
  metric?: 'cpu' | 'memory' | 'storage'
}

export function dashboardClock(width: number, height: number) {
  const pad = width < 260 ? 24 : 12
  return { x: (width - pad - DASHBOARD_CLOCK.width / 2) / width * 100, y: (height < 200 ? 24 : 44) / height * 100, scale: 1 }
}

/** The device and designer use the same editable preset, in back-to-front order. */
export function dashboardWidgets(width: number, height: number): DashboardWidget[] {
  const pad = width < 260 ? 24 : 12
  const inner = width - pad * 2
  const landscape = width >= 260 && height < 200
  const bodyY = landscape ? 50 : 100
  const bodyH = landscape ? height - bodyY - 12 : 104
  const sideW = width < 260 ? 64 : 88
  const infoW = inner - sideW - 8
  const cpuX = pad + infoW + 8
  const iconSize = landscape ? 28 : 24
  const iconGap = 6
  const statusY = landscape ? 10 : 64
  const liveW = iconSize + 16
  // Align the icon's square, allowing the badge its extra horizontal room.
  const liveX = pad + 4 * (iconSize + iconGap) - (liveW - iconSize) / 2
  function item(id: string, kind: keyof typeof BUILTIN_HOME_WIDGET_SOURCES, x: number, y: number, w: number, h: number, text = '', extra: Partial<DashboardWidget> = {}): DashboardWidget {
    return {
      id: `dashboard-${id}`, widget: BUILTIN_HOME_WIDGET_SOURCES[kind], kind,
      text, x: (x + w / 2) / width * 100, y: (y + h / 2) / height * 100,
      width: w, height: h, scale: 1, accent: '#f4f4f5', inactive: '#a1a1aa',
      background: '#111920', show_background: false, filled: false,
      radius: 0, font_size: 12, text_align: 'left', ...extra,
    }
  }
  return [
    item('network-card', 'rect', pad, bodyY, infoW, bodyH, '', { filled: true, radius: 12, background: '#11192099' }),
    item('cpu-card', 'rect', cpuX, bodyY, sideW, bodyH, '', { filled: true, radius: 12, background: '#11192099' }),
    ...(landscape ? [] : [item('brand', 'text', pad, 35, 90, 18, 'OneKVM', { font_size: 14, accent: '#3b82f6' })]),
    ...(['wifi', 'eth', 'hdmi', 'hid'] as const).map((status, index) => item(status, 'status', pad + index * (iconSize + iconGap), statusY, iconSize, iconSize, '', {
      status, status_style: 'icon', show_border: false, accent: '#22c55e', inactive: '#71717a', show_background: false, radius: 0, text_align: 'center',
    })),
    item('live', 'status', liveX, statusY, liveW, iconSize, '', {
      status: 'live', status_style: 'icon', show_border: false, accent: '#22c55e', inactive: '#71717a', text_align: 'center',
    }),
    item('ip-label', 'text', pad + 12, bodyY + 9, infoW - 24, 14, 'IP ADDRESS', { accent: '#a1a1aa' }),
    item('ip', 'text', pad + 12, bodyY + 28, infoW - 24, 20, '{ip}', { font_size: 16 }),
    item('hostname', 'text', pad + 12, bodyY + 54, infoW - 24, 14, '{hostname}', { accent: '#a1a1aa' }),
    item('video', 'text', pad + 12, bodyY + 80, infoW - 24, 16, '{video}'),
    item('cpu-label', 'text', cpuX + 12, bodyY + 9, sideW - 24, 14, 'CPU %', { accent: '#a1a1aa' }),
    item('cpu', 'text', cpuX + 12, bodyY + 28, sideW - 24, 30, '{cpu_value}', { font_size: 24, accent: '#3b82f6' }),
    item('cpu-bar', 'progress', cpuX + 12, bodyY + 74, sideW - 24, 4, '', { metric: 'cpu', accent: '#3b82f6', background: '#2c3949', radius: 2 }),
    item('date', 'text', cpuX + 12, bodyY + 88, sideW - 24, 14, '{date}', { accent: '#a1a1aa' }),
  ]
}
