import { normalizeColor } from '../../src/shared/colors'
import { normalizeClockFormat, type ClockFormat } from '../../src/shared/clockFormat'
import { normalizeBackgroundCrop, type BackgroundCrop } from './background-crop'
import {
  BUILTIN_HOME_WIDGET_SOURCES,
  MAX_HOME_WIDGET_HEIGHT,
  MAX_HOME_WIDGET_WIDTH,
  builtinHomeWidgetKind,
  type HomeStatusSource,
  type HomeWidgetKind,
} from '../../src/shared/homeWidgets'
import { parseRotations, type Rotation } from '../../src/shared/rotation'
import { dashboardClock, dashboardWidgets } from '../../src/shared/dashboard'

export { CLOCK_WIDGET_ID } from '../../src/shared/homeLayers'
export type PreviewMode = 'home' | 'apps' | 'detail'
export type PanelShape = 'round' | 'rect'
export type AppView = 'icons' | 'list'
export type PlacementMode = 'grid' | 'free'
export type MediaFit = 'contain' | 'cover' | 'fill'
export type SettingValue = string | number | boolean | null
export type Settings = Record<string, SettingValue>

export interface DisplayWidget {
  id: string
  source: string
  title: string
  glyph?: string
  icon: string
  subtitle: string
  accent: string
  on: boolean
  slots: string[]
  order: number
  builtin: boolean
  placement?: PlacementMode[]
  preview?: string
  kind?: HomeWidgetKind
  programmable?: boolean
}

export function canPlaceOnHome(widget: DisplayWidget): boolean {
  return widget.slots.includes('complication')
}

export interface FaceSlot { id: string; x: number; y: number }
export interface DisplayFace {
  id: string
  title: string
  dial: 'ticks' | 'plain'
  background: string
  modes: PlacementMode[]
  defaultMode: PlacementMode
  columns: number
  rows: number
  slots: FaceSlot[]
}

export interface HomeWidgetPlacement {
  id: string
  settings?: Record<string, unknown>
  widget?: string
  kind?: HomeWidgetKind
  text?: string
  status?: HomeStatusSource
  accent?: string
  inactive?: string
  background?: string
  show_background?: boolean
  show_border?: boolean
  status_style?: 'text' | 'icon' | 'image'
  filled?: boolean
  width?: number
  height?: number
  scale?: number
  font_size?: number
  text_align?: 'left' | 'center' | 'right'
  radius?: number
  metric?: 'cpu' | 'memory' | 'storage'
  slot?: string
  column?: number
  row?: number
  x?: number
  y?: number
  hidden?: boolean
  media_asset?: string
  status_active_image?: string
  status_inactive_image?: string
  media_fit?: MediaFit
  media_speed?: number
  media_loop?: boolean
}

export interface ScreenLayout {
  face: string
  home?: string
  home_settings?: Record<string, unknown>
  mode: PlacementMode
  background: string
  background_asset?: string
  background_crop?: BackgroundCrop
  clock: { x: number; y: number; scale: number }
  clock_enabled: boolean
  clock_format: ClockFormat
  layer_order?: string[]
  dashboard_layout?: boolean
  dashboard_clock?: { x: number; y: number; scale: number }
  home_widgets: HomeWidgetPlacement[]
  complications: string[]
  apps: string[]
  apps_hidden: string[]
  app_view: AppView
}

export interface HomeWidgetItem {
  placement: HomeWidgetPlacement
  widget: DisplayWidget
}

export interface PanelInfo {
  width: number
  height: number
  bpp: number
  shape: PanelShape
  device: string
  rotations?: Rotation[]
}

export interface SettingsSchema {
  type?: string
  additionalProperties?: boolean
  required?: string[]
  properties?: Record<string, unknown>
}

export interface PageHost {
  apiVersion: 1
  extension: Readonly<{ value: {
    id?: string
    settings: Settings
    settings_schema?: SettingsSchema
  } }>
  getStatus: () => Promise<unknown>
  invoke: <T = unknown>(method: string, payload?: unknown) => Promise<T>
  registerSettings: (adapter: {
    dirty: Readonly<{ value: boolean }>
    valid: Readonly<{ value: boolean }>
    collect: () => Settings
    reset: (settings: Settings) => void
  }) => () => void
}

export const DEFAULT_LAYOUT: ScreenLayout = {
  face: 'screen-display/dashboard',
  mode: 'free',
  background: '#000000',
  clock: { x: 50, y: 50, scale: 1 },
  clock_enabled: true,
  clock_format: '12h',
  home_widgets: [],
  complications: [],
  apps: [],
  apps_hidden: [],
  app_view: 'list',
}

export interface BuiltinHomeWidgetTitles {
  text: string
  status: string
  line: string
  rect: string
  media: string
  progress?: string
}

export function builtinHomeWidgets(titles: BuiltinHomeWidgetTitles): DisplayWidget[] {
  return [
    {
      id: BUILTIN_HOME_WIDGET_SOURCES.text, source: 'screen-display', title: titles.text,
      glyph: 'TXT', icon: '', subtitle: '{ip}', accent: '#f4f0e6', on: true,
      slots: ['complication'], order: 10, builtin: true, placement: ['grid', 'free'],
      preview: '{ip}', kind: 'text',
    },
    {
      id: BUILTIN_HOME_WIDGET_SOURCES.status, source: 'screen-display', title: titles.status,
      glyph: 'HDMI', icon: '', subtitle: 'HDMI', accent: '#22c55e', on: true,
      slots: ['complication'], order: 20, builtin: true, placement: ['grid', 'free'],
      preview: 'HDMI', kind: 'status',
    },
    {
      id: BUILTIN_HOME_WIDGET_SOURCES.line, source: 'screen-display', title: titles.line,
      glyph: '—', icon: '', subtitle: '', accent: '#f4f0e6', on: true,
      slots: ['complication'], order: 30, builtin: true, placement: ['grid', 'free'],
      preview: '—', kind: 'line',
    },
    {
      id: BUILTIN_HOME_WIDGET_SOURCES.rect, source: 'screen-display', title: titles.rect,
      glyph: 'BOX', icon: '', subtitle: 'ONEKVM', accent: '#f4f0e6', on: true,
      slots: ['complication'], order: 40, builtin: true, placement: ['grid', 'free'],
      preview: 'ONEKVM', kind: 'rect',
    },
    {
      id: BUILTIN_HOME_WIDGET_SOURCES.progress, source: 'screen-display', title: titles.progress || 'Progress',
      glyph: 'BAR', icon: '', subtitle: '', accent: '#3b82f6', on: true,
      slots: ['complication'], order: 45, builtin: true, placement: ['grid', 'free'], kind: 'progress',
    },
    {
      id: BUILTIN_HOME_WIDGET_SOURCES.media, source: 'screen-display', title: titles.media,
      glyph: 'IMG', icon: '', subtitle: '', accent: '#6ee7ff', on: true,
      slots: ['complication'], order: 50, builtin: true, placement: ['grid', 'free'],
      preview: 'IMG', kind: 'media',
    },
  ]
}

export function placementWidgetId(placement: HomeWidgetPlacement): string {
  return placement.widget || placement.id
}

export function placementKind(placement: HomeWidgetPlacement, widget?: DisplayWidget): HomeWidgetKind {
  return placement.kind || builtinHomeWidgetKind(placementWidgetId(placement)) || widget?.kind || 'external'
}

export function defaultHomeWidgetPlacement(source: string, id: string): HomeWidgetPlacement {
  const kind = builtinHomeWidgetKind(source) || 'external'
  const common: HomeWidgetPlacement = {
    id,
    widget: source === id ? undefined : source,
    kind,
    x: 50,
    y: 78,
    scale: 1,
  }
  if (kind === 'text') return {
    ...common, text: '{ip}', accent: '#f4f0e6', background: '#111821',
    show_background: false, width: 126, height: 24,
  }
  if (kind === 'status') return {
    ...common, text: 'HDMI', status: 'hdmi', accent: '#22c55e', inactive: '#667085',
    background: '#111821', show_background: true, filled: true, width: 64, height: 28,
  }
  if (kind === 'line') return {
    ...common, accent: '#f4f0e6', width: 104, height: 2,
  }
  if (kind === 'rect') return {
    ...common, text: 'ONEKVM', accent: '#f4f0e6', background: '#1f2937',
    filled: false, width: 104, height: 28,
  }
  if (kind === 'media') return {
    ...common, width: 120, height: 68, y: 70,
    media_fit: 'contain', media_speed: 1, media_loop: true,
  }
  if (kind === 'progress') return {
    ...common, text: '', metric: 'cpu', accent: '#3b82f6', background: '#2c3949', width: 104, height: 4,
  }
  return {
    ...common, text: '', accent: '#f4f0e6', background: '#111821',
    show_background: true, width: 56, height: 32,
  }
}

export const BUILTIN_FACES: DisplayFace[] = [
  ...['dashboard', 'flip', 'digital'].map((style): DisplayFace => ({
    id: `screen-display/${style}`, title: style === 'dashboard' ? 'Device overview' : style === 'flip' ? 'Flip clock' : 'Digital',
    dial: 'plain', background: '#05080c', modes: ['grid', 'free'], defaultMode: 'free', columns: 4, rows: 4, slots: [],
  })),
  {
    id: 'screen-display/classic', title: 'Classic', dial: 'ticks', background: '#000000',
    modes: ['grid', 'free'], defaultMode: 'free', columns: 4, rows: 4,
    slots: [
      { id: 'bottom-left', x: 34, y: 88 },
      { id: 'bottom-center', x: 50, y: 88 },
      { id: 'bottom-right', x: 66, y: 88 },
    ],
  },
  {
    id: 'screen-display/minimal', title: 'Minimal', dial: 'plain', background: '#05080c',
    modes: ['grid', 'free'], defaultMode: 'grid', columns: 4, rows: 4, slots: [],
  },
]

interface Contribution { id?: unknown; data?: unknown }

function contributionArray(raw: unknown): Contribution[] {
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const modes: PlacementMode[] = ['grid', 'free']
const validColor = normalizeColor
const widgetKinds: HomeWidgetKind[] = ['text', 'status', 'line', 'rect', 'progress', 'media', 'external']
const statusSources: HomeStatusSource[] = ['eth', 'hdmi', 'hid', 'wifi', 'live']
const mediaFits: MediaFit[] = ['contain', 'cover', 'fill']
export function accentColor(value: string): string {
  if (value === 'amber') return '#ffb000'
  if (value === 'cyan') return '#6ee7ff'
  if (value === 'violet') return '#c4b5fd'
  return validColor(value, '#f4f0e6')
}
const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback

export function parseFaces(raw: unknown): DisplayFace[] {
  const faces = [...BUILTIN_FACES]
  for (const item of contributionArray(raw)) {
    if (typeof item.id !== 'string' || !item.id.includes('/') || !item.data || typeof item.data !== 'object') continue
    const data = item.data as Record<string, unknown>
    const supported = Array.isArray(data.modes)
      ? data.modes.flatMap((mode): PlacementMode[] => mode === 'fixed' ? ['free'] : modes.includes(mode as PlacementMode) ? [mode as PlacementMode] : [])
      : []
    if (!supported.length) continue
    const slotNames = new Set<string>()
    const slots = Array.isArray(data.slots) ? data.slots.flatMap((value): FaceSlot[] => {
      if (!value || typeof value !== 'object') return []
      const slot = value as Record<string, unknown>
      if (typeof slot.id !== 'string' || !/^[a-z0-9_-]{1,31}$/.test(slot.id) || slotNames.has(slot.id)) return []
      slotNames.add(slot.id)
      return [{ id: slot.id, x: bounded(slot.x, 50, 0, 100), y: bounded(slot.y, 50, 0, 100) }]
    }) : []
    const validModes = [...new Set(supported)]
    if (!validModes.length) continue
    faces.push({
      id: item.id,
      title: typeof data.title === 'string' ? data.title.slice(0, 64) : item.id,
      dial: data.dial === 'plain' ? 'plain' : 'ticks',
      background: validColor(data.background, '#000000'),
      modes: validModes,
      defaultMode: data.default_mode === 'fixed'
        ? (validModes.includes('free') ? 'free' : validModes[0])
        : validModes.includes(data.default_mode as PlacementMode) ? data.default_mode as PlacementMode : validModes[0],
      columns: Math.floor(bounded((data.grid as Record<string, unknown> | undefined)?.columns, 4, 1, 8)),
      rows: Math.floor(bounded((data.grid as Record<string, unknown> | undefined)?.rows, 4, 1, 8)),
      slots,
    })
  }
  return faces.filter((face) => face.modes.length > 0)
}

export function parseContributedWidgets(raw: unknown): DisplayWidget[] {
  return contributionArray(raw).flatMap((item): DisplayWidget[] => {
    if (typeof item.id !== 'string' || !item.id.includes('/') || !item.data || typeof item.data !== 'object') return []
    const data = item.data as Record<string, unknown>
    const placement = Array.isArray(data.placement)
      ? [...new Set(data.placement.flatMap((mode): PlacementMode[] => mode === 'fixed' ? ['free'] : modes.includes(mode as PlacementMode) ? [mode as PlacementMode] : []))]
      : modes
    if (!placement.length) return []
    return [{
      id: item.id, source: item.id.split('/')[0],
      title: typeof data.title === 'string' ? data.title.slice(0, 64) : item.id,
      glyph: typeof data.glyph === 'string' ? data.glyph.slice(0, 2) : '•',
      icon: typeof data.icon === 'string' ? data.icon : '',
      subtitle: typeof data.preview === 'string' ? data.preview.slice(0, 24) : '',
      preview: typeof data.preview === 'string' ? data.preview.slice(0, 24) : undefined,
      accent: validColor(data.accent, '#f4f0e6'), on: true,
      slots: ['complication'], placement, order: 50, builtin: false, kind: 'external', programmable: typeof data.bundle === 'string',
    }]
  })
}

export function parsePluginApps(raw: unknown): DisplayWidget[] {
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim())
    return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed))
      return []
    const widgets: DisplayWidget[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object')
        continue
      const rec = item as Record<string, unknown>
      const id = typeof rec.id === 'string' ? rec.id : ''
      if (!id || seen.has(id) || typeof rec.icon !== 'string' || !rec.icon.trim() || 'glyph' in rec)
        continue
      seen.add(id)
      const slots = Array.isArray(rec.slots)
        ? rec.slots.filter((slot): slot is string => typeof slot === 'string')
        : ['app']
      widgets.push({
        id,
        source: typeof rec.source === 'string' ? rec.source : 'plugin',
        title: typeof rec.title === 'string' && rec.title ? rec.title : id,
        icon: typeof rec.icon === 'string' && rec.icon ? rec.icon.replace(/\.png$/, '') : id,
        subtitle: typeof rec.subtitle === 'string' ? rec.subtitle : id,
        accent: typeof rec.accent === 'string' ? rec.accent : 'ink',
        on: rec.on !== false,
        slots: slots.length ? slots : ['app'],
        order: typeof rec.order === 'number' ? rec.order : 50,
        builtin: false,
      })
    }
    return widgets.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  } catch {
    return []
  }
}

export const FALLBACK_SETTING_KEYS = [
  'service_enabled',
  'transition',
  'transition_ms',
  'layout_json',
  'brightness',
  'media_assets',
] as const

export function settingKeys(schema?: SettingsSchema): string[] {
  const names = Object.keys(schema?.properties || {})
  return names.length ? names : [...FALLBACK_SETTING_KEYS]
}

export function hasSetting(schema: SettingsSchema | undefined, name: string): boolean {
  return settingKeys(schema).includes(name)
}

export function normalizeRotate(value: unknown): 0 | 90 | 180 | 270 {
  const n = Number(value)
  if (n === 90 || n === 180 || n === 270)
    return n
  return 0
}

export interface LauncherLayout {
  iconColumns: number
  iconRows: number
  iconSize: number
  listRows: number
}

export const DEFAULT_LAUNCHER: LauncherLayout = {
  iconColumns: 3,
  iconRows: 3,
  iconSize: 52,
  listRows: 4,
}

export function parseLauncher(raw: unknown): LauncherLayout {
  const next = { ...DEFAULT_LAUNCHER }
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim())
    return next
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const columns = Number(parsed.icon_columns)
    const rows = Number(parsed.icon_rows)
    const size = Number(parsed.icon_size)
    const listRows = Number(parsed.list_rows)
    if (columns >= 1 && columns <= 5)
      next.iconColumns = Math.floor(columns)
    if (rows >= 1 && rows <= 5)
      next.iconRows = Math.floor(rows)
    if (size >= 24 && size <= 96)
      next.iconSize = Math.floor(size)
    if (listRows >= 1 && listRows <= 8)
      next.listRows = Math.floor(listRows)
  } catch {
    /* keep defaults */
  }
  return next
}

export const DEFAULT_PANEL: PanelInfo = {
  width: 240,
  height: 240,
  bpp: 16,
  shape: 'round',
  device: '/dev/fb0',
}

export function parsePanel(raw: unknown): PanelInfo {
  if (typeof raw !== 'string') return { ...DEFAULT_PANEL }
  try {
    const value = JSON.parse(raw) as Partial<PanelInfo>
    return {
      width: bounded(value.width, DEFAULT_PANEL.width, 64, 4096),
      height: bounded(value.height, DEFAULT_PANEL.height, 64, 4096),
      bpp: bounded(value.bpp, 16, 1, 32),
      shape: value.shape === 'rect' ? 'rect' : 'round',
      device: typeof value.device === 'string' ? value.device : DEFAULT_PANEL.device,
      ...(value.rotations === undefined ? {} : { rotations: parseRotations(value.rotations) }),
    }
  } catch { return { ...DEFAULT_PANEL } }
}

export function parseLayout(raw: unknown): ScreenLayout {
  if (typeof raw !== 'string' || !raw.trim())
    return { ...DEFAULT_LAYOUT, home_widgets: [], complications: [], apps: [], apps_hidden: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<ScreenLayout>
    const complications = Array.isArray(parsed.complications)
      ? parsed.complications.filter((id): id is string => typeof id === 'string')
      : [...DEFAULT_LAYOUT.complications]
    const apps = Array.isArray(parsed.apps)
      ? parsed.apps.filter((id): id is string => typeof id === 'string')
      : [...DEFAULT_LAYOUT.apps]
    const apps_hidden = Array.isArray(parsed.apps_hidden)
      ? parsed.apps_hidden.filter((id): id is string => typeof id === 'string')
      : []
    const app_view = parsed.app_view === 'icons' ? 'icons' : 'list'
    const legacyFixed = (parsed as { mode?: unknown }).mode === 'fixed'
    const legacySlots = new Map(BUILTIN_FACES.flatMap((face) => face.slots.map((slot) => [slot.id, slot] as const)))
    const home_widgets = Array.isArray(parsed.home_widgets)
      ? parsed.home_widgets.flatMap((entry): HomeWidgetPlacement[] => {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') return []
        const source = typeof entry.widget === 'string' ? entry.widget : entry.id
        const kind = widgetKinds.includes(entry.kind as HomeWidgetKind)
          ? entry.kind as HomeWidgetKind
          : builtinHomeWidgetKind(source) || 'external'
        const legacySlot = typeof entry.slot === 'string' ? legacySlots.get(entry.slot) : undefined
        const mediaSettings = kind === 'media' ? {
          media_fit: mediaFits.includes(entry.media_fit as MediaFit) ? entry.media_fit as MediaFit : 'contain' as const,
          media_speed: bounded(entry.media_speed, 1, 0.25, 2),
          media_loop: entry.media_loop !== false,
        } : {}
        return [{ id: entry.id.slice(0, 64),
          widget: typeof entry.widget === 'string' ? entry.widget.slice(0, 96) : undefined,
          kind,
          text: typeof entry.text === 'string' ? entry.text.slice(0, 64) : undefined,
          status: statusSources.includes(entry.status as HomeStatusSource) ? entry.status as HomeStatusSource : undefined,
          accent: typeof entry.accent === 'string' ? validColor(entry.accent, '#f4f0e6') : undefined,
          inactive: typeof entry.inactive === 'string' ? validColor(entry.inactive, '#667085') : undefined,
          background: typeof entry.background === 'string' ? validColor(entry.background, '#111821') : undefined,
          show_background: typeof entry.show_background === 'boolean' ? entry.show_background : undefined,
          ...(typeof entry.show_border === 'boolean' ? { show_border: entry.show_border } : {}),
          ...(['text', 'icon', 'image'].includes(entry.status_style || '') ? { status_style: entry.status_style } : {}),
          filled: typeof entry.filled === 'boolean' ? entry.filled : undefined,
          hidden: entry.hidden === true,
          width: entry.width === undefined ? undefined : bounded(entry.width, 64, 2, MAX_HOME_WIDGET_WIDTH),
          height: entry.height === undefined ? undefined : bounded(entry.height, 24, 1, MAX_HOME_WIDGET_HEIGHT),
          slot: typeof entry.slot === 'string' ? entry.slot : undefined,
          column: bounded(entry.column, 0, 0, 7), row: bounded(entry.row, 0, 0, 7),
          x: bounded(entry.x, legacyFixed ? legacySlot?.x ?? 50 : 50, 0, 100),
          y: bounded(entry.y, legacyFixed ? legacySlot?.y ?? 88 : 88, 0, 100),
          scale: bounded(entry.scale, 1, 0.5, 1.5),
          ...(entry.font_size === undefined ? {} : { font_size: bounded(entry.font_size, 12, 10, 32) }),
          ...(['left', 'center', 'right'].includes(entry.text_align || '') ? { text_align: entry.text_align } : {}),
          ...(entry.radius === undefined ? {} : { radius: bounded(entry.radius, 7, 0, 32) }),
          ...(['cpu', 'memory', 'storage'].includes(entry.metric || '') ? { metric: entry.metric } : {}),
          ...(typeof entry.media_asset === 'string' ? { media_asset: entry.media_asset.slice(0, 64) } : {}),
          ...(typeof entry.status_active_image === 'string' ? { status_active_image: entry.status_active_image.slice(0, 64) } : {}),
          ...(typeof entry.status_inactive_image === 'string' ? { status_inactive_image: entry.status_inactive_image.slice(0, 64) } : {}),
          ...mediaSettings,
          ...(entry.settings && typeof entry.settings === 'object' && !Array.isArray(entry.settings) ? { settings: entry.settings } : {}),
        }]
      })
      : complications.map((id, index) => ({ id, slot: BUILTIN_FACES.find((face) => face.id === 'screen-display/classic')!.slots[index % 3].id, x: 34 + index * 16, y: 88 }))
    const clock = parsed.clock && typeof parsed.clock === 'object' ? parsed.clock : DEFAULT_LAYOUT.clock
    return {
      face: typeof parsed.face === 'string' ? parsed.face : DEFAULT_LAYOUT.face,
      ...(typeof parsed.home === 'string' ? { home: parsed.home.slice(0, 128) } : {}),
      ...(parsed.home_settings && typeof parsed.home_settings === 'object' && !Array.isArray(parsed.home_settings) ? { home_settings: parsed.home_settings } : {}),
      mode: legacyFixed ? 'free' : modes.includes(parsed.mode as PlacementMode) ? parsed.mode as PlacementMode : DEFAULT_LAYOUT.mode,
      background: validColor(parsed.background, DEFAULT_LAYOUT.background),
      ...(parsed.background_crop ? { background_crop: normalizeBackgroundCrop(parsed.background_crop) } : {}),
      background_asset: typeof parsed.background_asset === 'string' ? parsed.background_asset.slice(0, 64) : undefined,
      clock: { x: bounded(clock.x, 50, 0, 100), y: bounded(clock.y, 50, 0, 100), scale: bounded(clock.scale, 1, 0.5, 2) },
      clock_enabled: parsed.clock_enabled !== false,
      clock_format: normalizeClockFormat(parsed.clock_format),
      ...(Array.isArray(parsed.layer_order) ? { layer_order: parsed.layer_order.filter((id): id is string => typeof id === 'string') } : {}),
      ...(parsed.dashboard_layout === true ? { dashboard_layout: true } : {}),
      ...(parsed.dashboard_clock ? { dashboard_clock: {
        x: bounded(parsed.dashboard_clock.x, 85, 0, 100), y: bounded(parsed.dashboard_clock.y, 10, 0, 100), scale: bounded(parsed.dashboard_clock.scale, 1, 0.5, 2),
      } } : {}),
      home_widgets, complications, apps, apps_hidden, app_view,
    }
  } catch {
    return { ...DEFAULT_LAYOUT, home_widgets: [], complications: [], apps: [], apps_hidden: [] }
  }
}

export function prepareHomeLayout(layout: ScreenLayout, panel: Pick<PanelInfo, 'width' | 'height'>): ScreenLayout {
  if (layout.face !== 'screen-display/dashboard' || layout.dashboard_layout) return layout
  return {
    ...layout, mode: 'free', dashboard_layout: true,
    dashboard_clock: layout.dashboard_clock || dashboardClock(panel.width, panel.height),
    home_widgets: [...dashboardWidgets(panel.width, panel.height), ...layout.home_widgets],
  }
}
