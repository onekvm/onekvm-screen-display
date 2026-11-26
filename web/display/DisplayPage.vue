<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { NAlert, NButton, NButtonGroup, NColorPicker, NDropdown, NModal, NSelect, NSlider, NSpin, NSwitch, NTabPane, NTabs } from 'naive-ui'

import { appIconAssetsKey, parseIconAssets } from './icon-assets'
import BackgroundRegionEditor from './BackgroundRegionEditor.vue'
import { useBackgroundRenderer } from './useBackgroundRenderer'
import { useHomeWidgetStatus } from './useHomeWidgetStatus'
import { parseMachineDefaults, restoreMachineDefaults, type MachineDefaults } from './machine-defaults'
import { cropBackgroundImage, DEFAULT_BACKGROUND_CROP, type BackgroundCrop } from './background-crop'
import { DEFAULT_BACKGROUND_ID, DEFAULT_BACKGROUND_IMAGE, withDefaultBackground } from './default-background'
import AssetSelector from './AssetSelector.vue'
import MediaLibrary from './MediaLibrary.vue'
import ClockWidgetInspector from './ClockWidgetInspector.vue'
import DisplayPreview from './DisplayPreview.vue'
import RemoteDisplay from './RemoteDisplay.vue'
import ScreenDevtools from './ScreenDevtools.vue'
import HomeWidgetInspector from './HomeWidgetInspector.vue'
import HomeSourceSelect from './HomeSourceSelect.vue'
import { useDesignerHistory } from './useDesignerHistory'
import SelectionToolbar from './SelectionToolbar.vue'
import { useDesignerSelection } from './useDesignerSelection'
import { arrangeBoxes, moveLayerGroup, stepLayerGroup, type SelectionGesture, type ArrangeAction } from './designer-arrange'
import { layoutBoxes, positionLayout } from './designer-layout'
import DisplayVariables from './DisplayVariables.vue'
import MediaWidgetControl from './MediaWidgetControl.vue'
import ScreenLayerToolbar, { type ScreenToolbarState } from './ScreenLayerToolbar.vue'
import WidgetList, { type WidgetListItem } from './WidgetList.vue'
import { detectLocale, translate, type MessageKey } from './i18n'
import { readPanelInfo } from './panel-info'
import { dashboardClock, isDashboardWidget, MAX_HOME_WIDGETS } from '../../src/shared/dashboard'
import { homeLayerOrder } from '../../src/shared/homeLayers'
import { backgroundImageDataUrl, parseBackgroundImage } from './background-image'
import {
  emptyMediaAssets,
  parseMediaAssets,
  serializeMediaAssets,
  MAX_MEDIA_SIDE,
  type MediaAsset,
  type MediaAssetLibrary,
} from './media-asset'
import {
  expandHomeWidgetTemplate,
  normalizeHomeWidgetStatus,
  homeStatusStyle,
} from '../../src/shared/homeWidgets'
import {
  CLOCK_WIDGET_ID,
  DEFAULT_LAUNCHER,
  DEFAULT_LAYOUT,
  DEFAULT_PANEL,
  BUILTIN_FACES,
  accentColor,
  builtinHomeWidgets,
  canPlaceOnHome,
  defaultHomeWidgetPlacement,
  hasSetting,
  normalizeRotate,
  parseLauncher,
  parseLayout,
  prepareHomeLayout,
  parsePanel,
  parsePluginApps,
  parseContributedWidgets,
  parseFaces,
  placementKind,
  placementWidgetId,
  settingKeys,
  type DisplayWidget,
  type DisplayFace,
  type HomeWidgetItem,
  type HomeWidgetPlacement,
  type PlacementMode,
  type LauncherLayout,
  type PageHost,
  type PanelInfo,
  type PreviewMode,
  type ScreenLayout,
  type Settings,
  type SettingsSchema,
} from './types'

const props = defineProps<{ host: PageHost }>()
const appIconAssets = shallowRef<Record<string, string>>({})
provide(appIconAssetsKey, appIconAssets)

const locale = ref(detectLocale())
const activeTab = ref('remote')
const pageError = ref('')
const pageNoticeKey = ref<MessageKey | ''>('')
const pageState = shallowRef<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
const panel = ref<PanelInfo>({ ...DEFAULT_PANEL })
const enabled = ref(true)
const transition = ref('slide')
const brightness = ref(100)
const rotate = ref<0 | 90 | 180 | 270>(0)
const backgroundImage = shallowRef('')
const backgroundOpen = ref(false)
const mediaPickerOpen = ref(false)
const mediaAssets = shallowRef<MediaAssetLibrary>(emptyMediaAssets())
const layout = ref<ScreenLayout>(parseLayout(''))
const mode = ref<PreviewMode>('home')
const detailId = ref('')
const selection = useDesignerSelection(() => pageItems.value.map(item => item.id), CLOCK_WIDGET_ID)
const { selectedId, selectedIds } = selection
const plugins = ref<DisplayWidget[]>([])
const widgets = ref<DisplayWidget[]>([])
const contributedWidgets = ref<DisplayWidget[]>([])
const homes = ref<DisplayWidget[]>([])
const faces = ref<DisplayFace[]>([...BUILTIN_FACES])
const launcher = ref<LauncherLayout>({ ...DEFAULT_LAUNCHER })
const { status: screenStatus, update: updateScreenStatus } = useHomeWidgetStatus()
const dirty = ref(false)
const backgroundRenderer = useBackgroundRenderer(raw => { backgroundImage.value = raw; markDirty() })
const { pending: backgroundPending, error: backgroundRenderError } = backgroundRenderer
const valid = computed(() => !backgroundPending.value && !backgroundRenderError.value)
let unregisterSettings: (() => void) | null = null
let localeObserver: MutationObserver | null = null
let statusTimer: number | null = null
let baseline = ''
let baselineMediaAssets = mediaAssets.value
let loadGeneration = 0

const t = (key: MessageKey, values: Record<string, string | number> = {}) => translate(locale.value, key, values)
const schema = computed<SettingsSchema | undefined>(() => props.host.extension.value.settings_schema)
const pageNotice = computed(() => pageNoticeKey.value ? t(pageNoticeKey.value) : '')
const builtinWidgets = computed(() => builtinHomeWidgets({
  text: t('textWidget'),
  status: t('statusWidget'),
  line: t('lineWidget'),
  rect: t('rectWidget'),
  media: t('mediaWidget'),
  progress: t('progressWidget'),
}))
const catalog = computed(() => {
  const byId = new Map<string, DisplayWidget>()
  for (const widget of [...builtinWidgets.value, ...plugins.value, ...widgets.value, ...contributedWidgets.value])
    byId.set(widget.id, widget)
  return [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
})
const catalogApps = computed(() => catalog.value.filter((widget) => widget.slots.includes('app') || widget.slots.length === 0))
const homeWidgetCatalog = computed(() => catalog.value.filter(canPlaceOnHome))
const widgetById = computed(() => {
  const map = new Map(catalog.value.map((widget) => [widget.id, widget]))
  return map
})
const homeWidgetItems = computed<HomeWidgetItem[]>(() => layout.value.home_widgets.filter((item) => layout.value.face === 'screen-display/dashboard' || !isDashboardWidget(item.id)).flatMap((placement) => {
  const widget = widgetById.value.get(placementWidgetId(placement))
  return widget && canPlaceOnHome(widget) ? [{ placement, widget }] : []
}))
const visibleHomeWidgetItems = computed(() => homeWidgetItems.value.filter((item) => item.placement.hidden !== true))
const homeLayers = computed(() => homeLayerOrder(layout.value.home_widgets.map(item => item.id), layout.value.layer_order))
const selectedFace = computed(() => faces.value.find((face) => face.id === layout.value.face) || BUILTIN_FACES[0])
const clockPosition = computed(() => layout.value.face === 'screen-display/dashboard' ? layout.value.dashboard_clock || dashboardClock(panel.value.width, panel.value.height) : layout.value.clock)
const backgroundColor = computed(() => layout.value.background || selectedFace.value.background)
const backgroundPreviewUrl = computed(() => backgroundImageDataUrl(backgroundImage.value))
const backgroundAsset = computed(() => mediaAssets.value.assets[layout.value.background_asset || ''])
const backgroundSource = computed(() => {
  const asset = backgroundAsset.value
  return asset?.frames.length === 1 ? JSON.stringify({ v: 1, width: asset.width, height: asset.height, pixels: asset.frames[0] }) : backgroundImage.value
})
const faceOptions = computed(() => faces.value.map((face) => ({ label: ({ 'screen-display/dashboard': t('faceDashboard'), 'screen-display/flip': t('faceFlip'), 'screen-display/digital': t('faceDigital'), 'screen-display/classic': t('faceClassic'), 'screen-display/minimal': t('faceMinimal') } as Record<string, string>)[face.id] || face.title, value: face.id })))
const modeOptions = computed(() => selectedFace.value.modes.map((mode) => ({
  label: t(mode === 'grid' ? 'gridMode' : 'freeMode'), value: mode,
})))
const selectedPlacement = computed(() => layout.value.home_widgets.find((item) => item.id === selectedId.value))
const selectedHomeItem = computed(() => homeWidgetItems.value.find((item) => item.placement.id === selectedId.value))
const selectedMediaAsset = computed(() => mediaAssets.value.assets[selectedPlacement.value?.media_asset ?? selectedId.value])
const usedAssetIds = computed(() => [layout.value.background_asset || '', ...layout.value.home_widgets.flatMap((item) => [item.media_asset ?? (placementKind(item) === 'media' ? item.id : ''), item.status_active_image || '', item.status_inactive_image || ''])].filter(Boolean))
const assetLabels = computed(() => Object.fromEntries(['materialLibrary', 'materialStillOnly', 'materialSearch', 'materialHint', 'materialSaveHint', 'materialEmpty', 'materialChoose', 'materialInUse', 'materialDelete', 'materialDeleteConfirm', 'mediaProcessing', 'mediaUpload', 'mediaTooLarge', 'mediaInvalid', 'mediaUnsupported', 'mediaFrames', 'mediaEmpty', 'mediaRemove'].map((key) => [key, t(key as MessageKey)])))
const encodedMediaAssets = computed(() => serializeMediaAssets(mediaAssets.value))
const orderedApps = computed(() => {
  const ordered: string[] = []
  const seen = new Set<string>()
  const saved = layout.value.apps.length
    ? layout.value.apps
    : catalogApps.value.map((widget) => widget.id)
  for (const id of saved) {
    if (seen.has(id) || !widgetById.value.has(id))
      continue
    seen.add(id)
    ordered.push(id)
  }
  for (const widget of catalogApps.value) {
    if (seen.has(widget.id))
      continue
    seen.add(widget.id)
    ordered.push(widget.id)
  }
  return ordered
    .map((id) => widgetById.value.get(id))
    .filter((widget): widget is DisplayWidget => Boolean(widget))
})
const previewApps = computed(() => {
  const hidden = new Set(layout.value.apps_hidden)
  return orderedApps.value.filter((widget) => !hidden.has(widget.id))
})
const currentSlot = computed<'complications' | 'apps'>(() => mode.value === 'home' ? 'complications' : 'apps')
function listItem(widget: DisplayWidget, type: 'complicationType' | 'appType', id = widget.id, preview?: string, hidden = false): WidgetListItem {
  return {
    id,
    name: dashboardTitle(id) || widget.title,
    type,
    icon: widget.icon || widget.id,
    accent: accentColor(widget.accent),
    hidden,
    pinned: false,
    selected: selectedIds.value.includes(id),
    preview: preview ?? (widget.slots.includes('complication') && !widget.icon ? widget.preview || widget.glyph || '' : undefined),
  }
}

function dashboardTitle(id: string): string {
  const keys: Record<string, MessageKey> = {
    'dashboard-network-card': 'dashboardNetworkCard', 'dashboard-cpu-card': 'dashboardCpuCard',
    'dashboard-brand': 'dashboardBrand', 'dashboard-eth': 'dashboardEth', 'dashboard-hdmi': 'dashboardHdmi',
    'dashboard-hid': 'dashboardUsb', 'dashboard-wifi': 'dashboardWifi', 'dashboard-live': 'dashboardLive', 'dashboard-ip-label': 'dashboardIpLabel',
    'dashboard-ip': 'dashboardIp', 'dashboard-hostname': 'dashboardHostname', 'dashboard-video': 'dashboardVideo',
    'dashboard-cpu-label': 'dashboardCpuLabel', 'dashboard-cpu': 'dashboardCpu', 'dashboard-cpu-bar': 'dashboardCpuBar', 'dashboard-date': 'dashboardDate',
  }
  return keys[id] ? t(keys[id]) : ''
}

function homeItemPreview(item: HomeWidgetItem): string | undefined {
  const kind = placementKind(item.placement, item.widget)
  if (kind === 'line' || kind === 'progress') return '—'
  if (kind === 'media') {
    const format = mediaAssets.value.assets[item.placement.media_asset ?? item.placement.id]?.format
    return format === 'image' ? 'IMG' : format?.toUpperCase() || 'IMG'
  }
  const template = item.placement.text ?? item.widget.preview ?? item.widget.glyph ?? ''
  return expandHomeWidgetTemplate(template, screenStatus.value).slice(0, 24)
}

const pageItems = computed<WidgetListItem[]>(() => {
  if (mode.value === 'home') {
    const items: WidgetListItem[] = [
      {
        id: CLOCK_WIDGET_ID,
        name: t('clock'),
        type: 'clockType',
        icon: 'clock',
        accent: '#f4f0e6',
        hidden: layout.value.clock_enabled === false,
        pinned: false,
        selected: selectedIds.value.includes(CLOCK_WIDGET_ID),
      },
      ...homeWidgetItems.value.map((item) => listItem(
        item.widget,
        'complicationType',
        item.placement.id,
        homeItemPreview(item),
        item.placement.hidden === true,
      )),
    ]
    const byId = new Map(items.map(item => [item.id, item]))
    return [...homeLayers.value].reverse().flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
  }
  const hidden = new Set(layout.value.apps_hidden)
  return orderedApps.value.map((widget) => listItem(widget, 'appType', widget.id, undefined, hidden.has(widget.id)))
})
const visibleOnPage = computed(() => pageItems.value.filter((item) => !item.hidden).length)
const toolbarState = computed<ScreenToolbarState>(() => {
  const ids = pageItems.value.map((item) => item.id)
  const index = ids.indexOf(selectedId.value)
  const item = pageItems.value[index]
  const clock = mode.value === 'home' && selectedId.value === CLOCK_WIDGET_ID
  const placement = mode.value === 'home' ? selectedPlacement.value : undefined
  const canPosition = clock || Boolean(placement && layout.value.mode === 'free')
  return {
    count: ids.length,
    name: item?.name || '',
    type: item ? t(item.type as MessageKey) : '',
    x: Math.round(clock ? clockPosition.value.x : placement?.x ?? 50),
    y: Math.round(clock ? clockPosition.value.y : placement?.y ?? 50),
    scale: Math.round((clock ? clockPosition.value.scale : placement?.scale ?? 1) * 100),
    maxScale: clock ? 200 : 150,
    showGeometry: mode.value === 'home',
    canPosition,
    canScale: clock || Boolean(placement),
    canRemove: Boolean(item && !item.pinned),
    canMoveUp: Boolean(item && !item.pinned && index > 0),
    canMoveDown: Boolean(item && !item.pinned && index < ids.length - 1),
  }
})
function slotIds(slot: 'complications' | 'apps'): string[] {
  if (slot === 'apps')
    return orderedApps.value.map((widget) => widget.id)
  return [...homeLayers.value].reverse()
}

const addWidgetOptions = computed(() => {
  const slot = currentSlot.value
  if (slot === 'complications') {
    const gridFull = layout.value.mode === 'grid' && layout.value.home_widgets.length >= selectedFace.value.columns * selectedFace.value.rows
    if (gridFull || layout.value.home_widgets.length >= MAX_HOME_WIDGETS) return []
  }
  const present = new Set(slot === 'apps'
    ? slotIds(slot)
    : layout.value.home_widgets.map(placementWidgetId))
  const pool = slot === 'apps' ? catalogApps.value : homeWidgetCatalog.value.filter((widget) =>
    !widget.placement || widget.placement.includes(layout.value.mode))
  return pool
    .filter((widget) => widget.builtin || widget.programmable || !present.has(widget.id))
    .map((widget) => ({ label: widget.title, key: widget.id }))
})
const panelMeta = computed(() => t('panelMeta', {
  width: panel.value.width,
  height: panel.value.height,
  shape: t(panel.value.shape === 'round' ? 'round' : 'rect'),
  device: panel.value.device,
}))
const transitionOptions = computed(() => [
  { label: t('slide'), value: 'slide' },
  { label: t('fade'), value: 'fade' },
])
const rotationOptions = computed(() => (panel.value.rotations ?? [0, 90, 180, 270] as const)
  .map(value => ({ label: t(`rotation${value}`), value })))
const showEnable = computed(() => hasSetting(schema.value, 'service_enabled'))
const showTransition = computed(() => hasSetting(schema.value, 'transition'))
const showBrightness = computed(() => hasSetting(schema.value, 'brightness'))
const showRotate = computed(() => hasSetting(schema.value, 'rotate'))
const showBackgroundImage = computed(() => hasSetting(schema.value, 'background_image'))

function collectAll(): Settings {
  return {
    service_enabled: enabled.value,
    transition: transition.value,
    transition_ms: 280,
    layout_json: JSON.stringify(layout.value),
    background_image: backgroundImage.value,
    media_assets: encodedMediaAssets.value,
    brightness: brightness.value,
    rotate: rotate.value,
    app_view: layout.value.app_view,
  }
}

function collectSettings(): Settings {
  const all = collectAll()
  const out: Settings = {}
  for (const key of settingKeys(schema.value)) {
    if (Object.prototype.hasOwnProperty.call(all, key))
      out[key] = all[key]
  }
  return out
}

// Geometry editing must not stringify megabytes of unchanged pixel data.
const assetVersions = new WeakMap<MediaAsset, number>()
let nextAssetVersion = 1
function snapshot() {
  const settings = collectSettings()
  delete settings.media_assets
  return JSON.stringify({ settings, assets: Object.entries(mediaAssets.value.assets).map(([id, asset]) => {
    if (!assetVersions.has(asset)) assetVersions.set(asset, nextAssetVersion++)
    return [id, assetVersions.get(asset)]
  }) })
}

const history = useDesignerHistory(
  () => ({ layout: JSON.stringify(layout.value), background: backgroundImage.value, assets: mediaAssets.value }),
  value => {
    backgroundRenderer.cancel()
    layout.value = JSON.parse(value.layout)
    backgroundImage.value = value.background
    mediaAssets.value = value.assets
    if (selectedId.value !== CLOCK_WIDGET_ID && !pageItems.value.some(item => item.id === selectedId.value))
      selectedId.value = mode.value === 'home' ? CLOCK_WIDGET_ID : (pageItems.value[0]?.id || '')
    markDirty()
  },
  (a, b) => a.layout === b.layout && a.background === b.background && a.assets === b.assets,
  () => backgroundPending.value,
)
const { canUndo, canRedo } = history
function designerPointerDown(event: PointerEvent) {
  history.pointerDown()
  if ((event.target as HTMLElement).closest('.display-preview'))
    (event.currentTarget as HTMLElement).focus({ preventScroll: true })
}
function designerKeydown(event: KeyboardEvent) {
  if (activeTab.value !== 'designer' || event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return
  if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
  const key = event.key.toLowerCase()
  if (key === 'a') { event.preventDefault(); selection.all(); return }
  if (key !== 'z' && key !== 'y') return
  event.preventDefault()
  if (key === 'y' || event.shiftKey) history.redo()
  else history.undo()
}

const machineDefaults = shallowRef<MachineDefaults | null>(null)

function applySettings(settings: Settings) {
  machineDefaults.value = parseMachineDefaults(settings.default_settings_json)
  backgroundRenderer.cancel()
  appIconAssets.value = parseIconAssets(settings.app_icons_json)
  enabled.value = settings.service_enabled !== false
  transition.value = String(settings.transition || 'slide')
  const nextBrightness = Number(settings.brightness)
  brightness.value = Number.isFinite(nextBrightness) ? Math.min(100, Math.max(5, nextBrightness)) : 100
  rotate.value = normalizeRotate(settings.rotate)
  const nextBackground = typeof settings.background_image === 'string' ? settings.background_image : ''
  const previousBackground = backgroundImage.value
  backgroundImage.value = !nextBackground || parseBackgroundImage(nextBackground) ? nextBackground : ''
  const nextAssets = withDefaultBackground(parseMediaAssets(settings.media_assets))
  const nextPanel = parsePanel(settings.panel_json)
  let nextLayout = prepareHomeLayout(parseLayout(settings.layout_json), nextPanel)
  if (settings.app_view === 'list' || settings.app_view === 'icons')
    nextLayout = { ...nextLayout, app_view: settings.app_view }
  const sameDesign = JSON.stringify(nextLayout) === JSON.stringify(prepareHomeLayout(parseLayout(JSON.stringify(layout.value)), nextPanel))
    && previousBackground === backgroundImage.value && serializeMediaAssets(nextAssets) === encodedMediaAssets.value
  const keepHistory = sameDesign && baselineMediaAssets === mediaAssets.value
  panel.value = nextPanel
  if (!sameDesign) {
    mediaAssets.value = nextAssets
    layout.value = nextLayout
  }
  plugins.value = parsePluginApps(settings.apps_json)
  contributedWidgets.value = parseContributedWidgets(settings.widgets_json)
  homes.value = parsePluginApps(settings.homes_json)
  faces.value = parseFaces(settings.faces_json)
  launcher.value = parseLauncher(settings.launcher_json)
  baseline = snapshot()
  dirty.value = false
  baselineMediaAssets = mediaAssets.value
  if (keepHistory) history.boundary()
  else history.reset()
}

function markDirty() {
  dirty.value = snapshot() !== baseline
}

function setAppSlot(id: string, on: boolean) {
  const widget = widgetById.value.get(id)
  if (!widget?.slots.includes('app')) return
  const apps = slotIds('apps')
  if (!apps.includes(id)) apps.push(id)
  const hidden = layout.value.apps_hidden.filter((item) => item !== id)
  if (!on) hidden.push(id)
  layout.value = { ...layout.value, apps, apps_hidden: hidden }
  markDirty()
}

function nextHomeWidgetId(source: string): string {
  const stem = source.split('/').pop()?.replace(/[^a-z0-9_-]/gi, '-') || 'widget'
  const used = new Set(layout.value.home_widgets.map((item) => item.id))
  let sequence = 1
  while (used.has(`home-${stem}-${sequence}`)) sequence += 1
  return `home-${stem}-${sequence}`
}

function addHomeWidget(source: string): string | null {
  const widget = widgetById.value.get(source)
  if (!widget || !canPlaceOnHome(widget)) return null
  if (!widget.builtin && !widget.programmable && layout.value.home_widgets.some((item) => placementWidgetId(item) === source)) return null
  if (widget.programmable && layout.value.home_widgets.filter(item => widgetById.value.get(placementWidgetId(item))?.programmable).length >= 8) return null
  if (layout.value.home_widgets.length >= MAX_HOME_WIDGETS) return null

  const placements = [...layout.value.home_widgets]
  const id = widget.builtin || widget.programmable ? nextHomeWidgetId(source) : source
  const placement = defaultHomeWidgetPlacement(source, id)
  const freeSlot = selectedFace.value.slots.find((item) => !placements.some((entry) => entry.slot === item.id))
  const occupiedCells = new Set(placements.map((entry) => `${entry.column ?? 0},${entry.row ?? 0}`))
  let column = 0
  let row = 0
  for (let index = 0; index < selectedFace.value.columns * selectedFace.value.rows; index += 1) {
    const candidateColumn = index % selectedFace.value.columns
    const candidateRow = Math.floor(index / selectedFace.value.columns)
    if (!occupiedCells.has(`${candidateColumn},${candidateRow}`)) {
      column = candidateColumn
      row = candidateRow
      break
    }
  }
  placements.push({
    ...placement,
    slot: freeSlot?.id,
    column,
    row,
    x: freeSlot?.x ?? 50,
    y: freeSlot?.y ?? Math.min(88, 68 + placements.length * 8),
  })
  layout.value = {
    ...layout.value,
    home_widgets: placements,
    complications: placements.map(placementWidgetId),
  }
  markDirty()
  return id
}

function removeHomeWidget(id: string) {
  const placements = layout.value.home_widgets.filter((item) => item.id !== id)
  layout.value = {
    ...layout.value,
    home_widgets: placements,
    complications: placements.map(placementWidgetId),
  }
  markDirty()
}

function setFace(id: string) {
  const face = faces.value.find((item) => item.id === id)
  if (!face) return
  const previousFace = selectedFace.value
  const mode = face.modes.includes(layout.value.mode) ? layout.value.mode : face.defaultMode
  const background = layout.value.background === previousFace.background ? face.background : layout.value.background
  renderBackgroundColor(background || face.background)
  layout.value = prepareHomeLayout({ ...layout.value, face: id, mode, background }, panel.value)
  markDirty()
}

function setMode(mode: PlacementMode) {
  if (!selectedFace.value.modes.includes(mode)) return
  let home_widgets = layout.value.home_widgets
  if (mode === 'grid') {
    home_widgets = home_widgets.map((item, index) => ({
      ...item,
      column: index % selectedFace.value.columns,
      row: Math.floor(index / selectedFace.value.columns),
    }))
  }
  layout.value = { ...layout.value, mode, home_widgets }
  markDirty()
}

function selectMediaAsset(id: string | undefined) {
  if (!selectedPlacement.value) return
  const asset = id ? mediaAssets.value.assets[id] : undefined
  updatePlacement({ media_asset: id || '', ...(asset ? { width: Math.min(160, asset.width), height: Math.min(120, Math.max(1, Math.round(Math.min(160, asset.width) * asset.height / asset.width))) } : {}) })
  mediaPickerOpen.value = false
}

function selectBackgroundAsset(id: string | undefined) {
  const asset = id ? mediaAssets.value.assets[id] : undefined
  if (asset && asset.frames.length !== 1) return
  const raw = asset ? JSON.stringify({ v: 1, width: asset.width, height: asset.height, pixels: asset.frames[0] }) : ''
  void backgroundRenderer.render(raw, asset, panel.value.width, panel.value.height, DEFAULT_BACKGROUND_CROP, backgroundColor.value)
  layout.value = { ...layout.value, background_asset: id, background_crop: { ...DEFAULT_BACKGROUND_CROP } }
  markDirty()
}

function updateBackgroundCrop(crop: BackgroundCrop) {
  let source = backgroundSource.value
  // Keep a reusable source for legacy backgrounds within the media library size limit.
  if (!layout.value.background_asset && source) {
    let image = parseBackgroundImage(source)!
    if (image.width > MAX_MEDIA_SIDE || image.height > MAX_MEDIA_SIDE) {
      const scale = Math.min(MAX_MEDIA_SIDE / image.width, MAX_MEDIA_SIDE / image.height)
      source = cropBackgroundImage(source, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)), DEFAULT_BACKGROUND_CROP)
      image = parseBackgroundImage(source)!
    }
    const id = `background-${Date.now().toString(36)}`
    mediaAssets.value = { ...mediaAssets.value, assets: { ...mediaAssets.value.assets, [id]: { v: 1, name: t('backgroundImage'), format: 'image', width: image.width, height: image.height, frames: [image.pixels], durations: [100] } } }
    layout.value = { ...layout.value, background_asset: id }
  }
  void backgroundRenderer.render(source, backgroundAsset.value, panel.value.width, panel.value.height, crop, backgroundColor.value)
  layout.value = { ...layout.value, background_crop: crop }
  markDirty()
}

function renderBackgroundColor(background: string) {
  if (backgroundSource.value && background !== backgroundColor.value)
    void backgroundRenderer.render(backgroundSource.value, backgroundAsset.value, panel.value.width, panel.value.height, layout.value.background_crop || DEFAULT_BACKGROUND_CROP, background)
}

function updateBackgroundColor(background: string) {
  renderBackgroundColor(background)
  layout.value = { ...layout.value, background }
  markDirty()
}

function updatePlacement(patch: Partial<HomeWidgetPlacement>) {
  const previous = selectedPlacement.value
  const targetColumn = patch.column ?? previous?.column
  const targetRow = patch.row ?? previous?.row
  const next = layout.value.home_widgets.map((item) => {
    if (item.id === selectedId.value) return { ...item, ...patch }
    if (patch.slot !== undefined && item.slot === patch.slot) return { ...item, slot: previous?.slot }
    if ((patch.column !== undefined || patch.row !== undefined) && item.column === targetColumn && item.row === targetRow)
      return { ...item, column: previous?.column, row: previous?.row }
    return item
  })
  layout.value = { ...layout.value, home_widgets: next }
  markDirty()
}

function moveWidget(id: string, patch: Partial<HomeWidgetPlacement>) {
  selectedId.value = id
  updatePlacement(patch)
}

function moveClock(point: Partial<ScreenLayout['clock']>) {
  selectedId.value = CLOCK_WIDGET_ID
  const key = layout.value.face === 'screen-display/dashboard' ? 'dashboard_clock' : 'clock'
  layout.value = { ...layout.value, [key]: { ...clockPosition.value, ...point } }
  markDirty()
}

function addWidget(key: string | number) {
  const source = String(key)
  if (!widgetById.value.has(source))
    return
  if (currentSlot.value === 'apps') {
    setAppSlot(source, true)
    selectedId.value = source
    return
  }
  const id = addHomeWidget(source)
  if (id) selectedId.value = id
}

function toggleWidget(id: string) {
  if (id === CLOCK_WIDGET_ID) {
    layout.value = { ...layout.value, clock_enabled: layout.value.clock_enabled === false }
    markDirty()
    return
  }
  if (currentSlot.value === 'apps') {
    setAppSlot(id, layout.value.apps_hidden.includes(id))
    selectedId.value = id
    return
  }
  const placement = layout.value.home_widgets.find((item) => item.id === id)
  if (!placement) return
  selectedId.value = id
  updatePlacement({ hidden: placement.hidden !== true })
}

function selectWidget(id: string, gesture: SelectionGesture = {}) {
  selection.select(id, gesture)
  if (id !== CLOCK_WIDGET_ID && mode.value !== 'home')
    detailId.value = id
}

function setPreviewMode(nextMode: PreviewMode) {
  mode.value = nextMode
  if (nextMode === 'home') {
    detailId.value = ''
    if (selectedId.value !== CLOCK_WIDGET_ID && !layout.value.home_widgets.some((item) => item.id === selectedId.value))
      selectedId.value = layout.value.clock_enabled !== false ? CLOCK_WIDGET_ID : (visibleHomeWidgetItems.value[0]?.placement.id || '')
  } else if (nextMode === 'apps') {
    detailId.value = ''
    if (!orderedApps.value.some((item) => item.id === selectedId.value))
      selectedId.value = orderedApps.value[0]?.id || ''
  }
}

function reorderWidget(source: string, target: string, before: boolean) {
  const slot = currentSlot.value
  const present = slotIds(slot)
  if (!present.includes(source)) return
  const ids = moveLayerGroup(present, selectedIds.value.includes(source) ? selectedIds.value : [source], target, before)
  if (slot === 'complications') {
    layout.value = { ...layout.value, layer_order: [...ids].reverse() }
  } else {
    layout.value = { ...layout.value, apps: ids }
  }
  markDirty()
}

function moveGroup(positions: { id: string; x: number; y: number }[]) {
  layout.value = positionLayout(layout.value, positions)
  markDirty()
}
function arrangeSelection(action: ArrangeAction) {
  if (mode.value !== 'home' || layout.value.mode !== 'free') return
  history.boundary()
  const boxes = arrangeBoxes(layoutBoxes(layout.value, panel.value, selectedIds.value), action)
  moveGroup(boxes.map(box => ({ id: box.id, x: box.x / panel.value.width * 100, y: box.y / panel.value.height * 100 })))
  history.boundary()
}
function stepSelection(up: boolean) {
  history.boundary()
  const ids = stepLayerGroup(pageItems.value.map(item => item.id), selectedIds.value, up)
  layout.value = mode.value === 'home' ? { ...layout.value, layer_order: ids.reverse() } : { ...layout.value, apps: ids }
  markDirty()
  history.boundary()
}

function updateToolbar(field: 'x' | 'y' | 'scale', value: number) {
  if (field === 'scale' ? !toolbarState.value.canScale : !toolbarState.value.canPosition) return
  const patch = field === 'scale' ? { scale: value / 100 } : { [field]: value }
  if (selectedId.value === CLOCK_WIDGET_ID) moveClock(patch)
  else updatePlacement(patch)
}

function runToolbarAction(action: 'center-x' | 'center-y' | 'move-up' | 'move-down' | 'remove') {
  const id = selectedId.value
  if (action === 'center-x' || action === 'center-y') {
    if (toolbarState.value.canPosition) updateToolbar(action === 'center-x' ? 'x' : 'y', 50)
    return
  }
  if (action === 'remove') {
    if (!toolbarState.value.canRemove) return
    if (id === CLOCK_WIDGET_ID) {
      layout.value = { ...layout.value, clock_enabled: false }
      markDirty()
    } else if (currentSlot.value === 'apps') setAppSlot(id, false)
    else removeHomeWidget(id)
    selectedId.value = mode.value === 'home'
      ? (visibleHomeWidgetItems.value[0]?.placement.id || '')
      : (orderedApps.value[0]?.id || '')
    return
  }
  const ids = pageItems.value.map(item => item.id)
  const index = ids.indexOf(id)
  const next = index + (action === 'move-up' ? -1 : 1)
  if (index < 0 || next < 0 || next >= ids.length) return
  if (action === 'move-up' && !toolbarState.value.canMoveUp) return
  if (action === 'move-down' && !toolbarState.value.canMoveDown) return
  reorderWidget(id, ids[next], action === 'move-up')
}

function runCanvasAction(key: string | number) {
  if (key !== 'restore')
    return
  backgroundRenderer.cancel()
  if (machineDefaults.value) {
    const restored = restoreMachineDefaults(machineDefaults.value, mediaAssets.value)
    layout.value = restored.layout
    mediaAssets.value = restored.mediaAssets
    backgroundImage.value = restored.backgroundImage
    selectedId.value = mode.value === 'home' ? CLOCK_WIDGET_ID : (orderedApps.value[0]?.id || '')
    pageError.value = ''
    pageNoticeKey.value = 'restoredDefault'
    markDirty()
    return
  }
  layout.value = prepareHomeLayout({
    face: DEFAULT_LAYOUT.face,
    mode: DEFAULT_LAYOUT.mode,
    background: DEFAULT_LAYOUT.background,
    background_asset: DEFAULT_BACKGROUND_ID,
    background_crop: { ...DEFAULT_BACKGROUND_CROP },
    clock: { ...DEFAULT_LAYOUT.clock },
    clock_enabled: true,
    clock_format: '12h',
    home_widgets: [],
    complications: [...DEFAULT_LAYOUT.complications],
    apps: [...DEFAULT_LAYOUT.apps],
    apps_hidden: [],
    app_view: layout.value.app_view,
  }, panel.value)
  mediaAssets.value = withDefaultBackground(mediaAssets.value)
  backgroundImage.value = cropBackgroundImage(DEFAULT_BACKGROUND_IMAGE, panel.value.width, panel.value.height, DEFAULT_BACKGROUND_CROP)
  selectedId.value = mode.value === 'home' ? CLOCK_WIDGET_ID : (orderedApps.value[0]?.id || '')
  pageError.value = ''
  pageNoticeKey.value = 'restoredDefault'
  markDirty()
}

async function refreshScreenStatus(generation = loadGeneration) {
  try {
    const [status, resources] = await Promise.all([
      props.host.getStatus(),
      fetch('/api/resources', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null).catch(() => null),
    ])
    if (generation === loadGeneration) {
      const normalized = normalizeHomeWidgetStatus(status)
      const cpu = resources?.samples?.at(-1)?.cpu_percent
      updateScreenStatus(typeof cpu === 'number' && Number.isFinite(cpu) ? { ...normalized, cpuPercent: Math.max(0, Math.min(100, Math.round(cpu))) } : normalized)
    }
  } catch {
    /* The designer remains usable with placeholder values. */
  }
}

async function loadPage() {
  const generation = ++loadGeneration
  pageState.value = 'loading'
  unregisterSettings?.()
  unregisterSettings = null
  applySettings(props.host.extension.value.settings || {})
  let legacyPanel = false
  try {
    const result = await readPanelInfo(props.host)
    if (generation !== loadGeneration) return
    if (result.status === 'unavailable') {
      pageState.value = 'unavailable'
      return
    }
    panel.value = result.panel
    legacyPanel = result.source === 'legacy'
  } catch {
    if (generation === loadGeneration) pageState.value = 'error'
    return
  }
  if (legacyPanel) {
    try {
      const listed = await props.host.invoke<{ widgets?: DisplayWidget[] }>('list')
      if (generation !== loadGeneration) return
      widgets.value = listed.widgets || []
    } catch {
      if (generation !== loadGeneration) return
      widgets.value = []
    }
  }
  unregisterSettings = props.host.registerSettings({
    dirty,
    valid,
    collect: collectSettings,
    reset: applySettings,
  })
  pageState.value = 'ready'
  await refreshScreenStatus(generation)
}

onMounted(() => {
  localeObserver = new MutationObserver(() => { locale.value = detectLocale() })
  localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  void loadPage()
  statusTimer = window.setInterval(() => {
    if (pageState.value === 'ready') void refreshScreenStatus()
  }, 5000)
})

watch([enabled, transition, brightness, rotate, backgroundImage, mediaAssets, layout], markDirty, { deep: true })
watch(catalog, (items) => {
  if (!items.length) return
  const byId = new Map(items.map((item) => [item.id, item]))
  const home_widgets = layout.value.home_widgets.filter((placement) => {
    const widget = byId.get(placementWidgetId(placement))
    return !widget || canPlaceOnHome(widget)
  })
  if (home_widgets.length === layout.value.home_widgets.length) return
  layout.value = {
    ...layout.value,
    home_widgets,
    complications: home_widgets.map(placementWidgetId),
  }
  if (selectedId.value !== CLOCK_WIDGET_ID && !home_widgets.some((placement) => placement.id === selectedId.value))
    selectedId.value = CLOCK_WIDGET_ID
  markDirty()
})

onBeforeUnmount(() => {
  history.dispose()
  loadGeneration += 1
  if (statusTimer !== null) window.clearInterval(statusTimer)
  localeObserver?.disconnect()
  unregisterSettings?.()
})
</script>

<template>
  <div class="screen-display-page" tabindex="-1" @keydown="designerKeydown" @pointerdown.capture="designerPointerDown" @pointerup.capture="history.pointerUp" @pointercancel.capture="history.pointerUp" @focusin="history.boundary">
    <NAlert v-if="pageError" type="error" :show-icon="false" closable @close="pageError = ''">
      {{ pageError }}
    </NAlert>
    <NAlert v-if="pageNotice" type="success" :show-icon="false" closable @close="pageNoticeKey = ''">
      {{ pageNotice }}
    </NAlert>
    <div v-if="pageState === 'loading'" class="display-page-loading" role="status" aria-live="polite">
      <NSpin size="small" />
      <span>{{ t('loading') }}</span>
    </div>
    <NAlert v-else-if="pageState === 'unavailable'" type="info" :show-icon="false">
      {{ t('noPanel') }}
    </NAlert>
    <NAlert v-else-if="pageState === 'error'" type="error" :show-icon="false">
      <div class="display-page-error">
        <span>{{ t('loadFailed') }}</span>
        <NButton size="small" @click="loadPage">{{ t('retry') }}</NButton>
      </div>
    </NAlert>

    <NTabs v-else-if="pageState === 'ready'" v-model:value="activeTab" type="line" animated class="display-page-tabs">
      <NTabPane name="remote" :tab="t('remoteTab')" display-directive="show">
        <RemoteDisplay v-if="activeTab === 'remote'" :host="host" :locale="locale" />
      </NTabPane>
      <NTabPane name="designer" :tab="t('designerTab')" display-directive="show">
        <section class="preview-card">
          <header class="section-head">
            <div>
              <h1>{{ t('title') }}</h1>
              <p>{{ t('previewHint') }}</p>
              <p class="meta">{{ panelMeta }}</p>
            </div>
            <NButtonGroup class="preview-page-switch" role="group" :aria-label="t('preview')">
              <NButton
                size="small"
                :type="mode === 'home' ? 'primary' : 'default'"
                :secondary="mode !== 'home'"
                @click="setPreviewMode('home')"
              >
                {{ t('pageHome') }}
              </NButton>
              <NButton
                size="small"
                :type="mode !== 'home' ? 'primary' : 'default'"
                :secondary="mode === 'home'"
                @click="setPreviewMode('apps')"
              >
                {{ t('pageApps') }}
              </NButton>
            </NButtonGroup>
          </header>
          <div class="canvas-workspace">
            <div class="canvas-column">
              <div class="designer-history" role="group" :aria-label="t('editHistory')">
                <NButton size="small" secondary :disabled="!canUndo" :title="`${t('undo')} (Ctrl/⌘ Z)`" @click="history.undo">{{ t('undo') }}</NButton>
                <NButton size="small" secondary :disabled="!canRedo" :title="`${t('redo')} (Ctrl/⌘ Shift Z / Ctrl Y)`" @click="history.redo">{{ t('redo') }}</NButton>
              </div>
              <div class="face-controls" v-if="mode === 'home'">
                <HomeSourceSelect v-if="homes.length || layout.home" :value="layout.home || ''" :homes="homes"
                  :labels="{ title: t('homeSource'), designer: t('homeDesigner'), unavailable: t('homeUnavailable') }"
                  @update="layout = { ...layout, home: $event }; markDirty()" />
                <label><span>{{ t('placement') }}</span><NSelect :value="layout.mode" :options="modeOptions" @update:value="setMode($event as PlacementMode)" /></label>
                <NButton v-if="showBackgroundImage" secondary @click="backgroundOpen = true">{{ t('backgroundSettings') }}</NButton>
              </div>
              <div class="canvas-stage">
                <div
                  class="display-shell"
                  :class="{ disabled: !enabled }"
                >
                  <NAlert v-if="mode === 'home' && layout.home" type="info" :show-icon="false">
                    {{ t('programmedHomePreview') }}
                    <NButton text type="primary" @click="activeTab = 'remote'">{{ t('remoteTab') }}</NButton>
                  </NAlert>
                  <DisplayPreview v-else
                    :selected-id="selectedId"
                    :selected-ids="selectedIds"
                    :resize-label="t('resizeComponent')"
                    :panel="panel"
                    :mode="mode"
                    :hdmi-on="screenStatus.hdmiConnected"
                    :usb-on="screenStatus.hidConnected"
                    :ip="screenStatus.ip || '--.--.--.--'"
                    :brightness="brightness"
                    :rotate="rotate"
                    :app-view="layout.app_view"
                    :home-items="visibleHomeWidgetItems"
                    :layer-order="homeLayers"
                    :media-assets="mediaAssets.assets"
                    :status="screenStatus"
                    :background="backgroundColor"
                    :background-image="backgroundPreviewUrl"
                    :face="selectedFace"
                    :placement-mode="layout.mode"
                    :clock-position="clockPosition"
                    :clock-format="layout.clock_format"
                    :clock-visible="layout.clock_enabled !== false"
                    :apps="previewApps"
                    :launcher="launcher"
                    :detail-id="detailId"
                    @update:mode="setPreviewMode"
                    @update:detail-id="detailId = $event; selectedId = $event"
                    @update:app-view="layout.app_view = $event; markDirty()"
                    @select-widget="selectWidget"
                    @move-widget="moveWidget"
                    @move-clock="moveClock"
                    @move-group="moveGroup"
                  />
                </div>
              </div>
              <SelectionToolbar v-if="selectedIds.length > 1" :count="selectedIds.length" :can-arrange="mode === 'home' && layout.mode === 'free'"
                :labels="{ selection: t('selectionCount', { count: selectedIds.length }), left: t('alignLeft'), center: t('alignCenter'), right: t('alignRight'), top: t('alignTop'), middle: t('alignMiddle'), bottom: t('alignBottom'), 'space-x': t('spaceHorizontal'), 'space-y': t('spaceVertical'), moveUp: t('moveUp'), moveDown: t('moveDown'), hint: t('multiSelectHint'), gridHint: t('multiSelectGridHint') }"
                @arrange="arrangeSelection" @layer="stepSelection" />
              <ScreenLayerToolbar v-else
                :state="toolbarState"
                :labels="{
                  empty: t('toolbarEmpty'), select: t('toolbarSelect'), size: t('toolbarSize'),
                  centerX: t('centerHorizontal'), centerY: t('centerVertical'),
                  moveUp: t('moveUp'), moveDown: t('moveDown'), remove: t('removeWidget'),
                }"
                @update="updateToolbar"
                @action="runToolbarAction"
              />
              <ClockWidgetInspector
                v-if="selectedIds.length === 1 && mode === 'home' && selectedId === CLOCK_WIDGET_ID"
                :value="layout.face"
                :format="layout.clock_format"
                :options="faceOptions"
                :labels="{
                  clockSettings: t('clockSettings'), clockStyle: t('clockStyle'), clockHint: t('clockHint'),
                  clockFormat: t('clockFormat'), clock12Hour: t('clock12Hour'), clock24Hour: t('clock24Hour'),
                }"
                @update="setFace"
                @update-format="layout = { ...layout, clock_format: $event }"
              />
              <MediaWidgetControl
                v-if="selectedIds.length === 1 && selectedPlacement && selectedHomeItem && placementKind(selectedPlacement, selectedHomeItem.widget) === 'media'"
                :asset="selectedMediaAsset"
                :fit="selectedPlacement.media_fit ?? 'contain'"
                :speed="selectedPlacement.media_speed ?? 1"
                :loop="selectedPlacement.media_loop !== false"
                :labels="{
                  materialChoose: t('materialChoose'), mediaSource: t('mediaSource'), mediaHint: t('mediaHint'), mediaEmpty: t('mediaEmpty'),
                  mediaUpload: t('mediaUpload'), mediaReplace: t('mediaReplace'), mediaRemove: t('mediaRemove'),
                  mediaProcessing: t('mediaProcessing'), mediaFrames: t('mediaFrames'), mediaInvalid: t('mediaInvalid'),
                  mediaTooLarge: t('mediaTooLarge'), mediaUnsupported: t('mediaUnsupported'),
                  mediaImage: t('mediaImage'), mediaSettings: t('mediaSettings'), mediaFit: t('mediaFit'),
                  mediaFitContain: t('mediaFitContain'), mediaFitCover: t('mediaFitCover'),
                  mediaFitFill: t('mediaFitFill'), mediaSpeed: t('mediaSpeed'), mediaLoop: t('mediaLoop'),
                }"
                @choose="mediaPickerOpen = true"
                @clear="selectMediaAsset(undefined)"
                @configure="updatePlacement"
                @error="pageError = $event"
              />
              <template v-if="selectedIds.length === 1 && selectedPlacement && selectedHomeItem && placementKind(selectedPlacement, selectedHomeItem.widget) === 'status' && homeStatusStyle(selectedPlacement) === 'image'">
                <AssetSelector :value="selectedPlacement.status_active_image" :library="mediaAssets" :used-ids="usedAssetIds" :title="t('statusActiveImage')" :labels="assetLabels" images-only @select="updatePlacement({ status_active_image: $event })" @update="mediaAssets = $event" />
                <AssetSelector :value="selectedPlacement.status_inactive_image" :library="mediaAssets" :used-ids="usedAssetIds" :title="t('statusInactiveImage')" :labels="assetLabels" images-only @select="updatePlacement({ status_inactive_image: $event })" @update="mediaAssets = $event" />
              </template>
              <HomeWidgetInspector
                v-if="selectedIds.length === 1 && selectedHomeItem && selectedPlacement"
                :placement="selectedPlacement"
                :kind="placementKind(selectedPlacement, selectedHomeItem.widget)"
                :max-width="Math.min(240, panel.width)"
                :max-height="Math.min(120, panel.height)"
                :labels="{
                  componentSettings: t('componentSettings'), componentContent: t('componentContent'),
                  variableHint: t('variableHint'), statusHint: t('statusHint'), statusSource: t('statusSource'),
                  statusHdmi: t('statusHdmi'), statusEth: t('statusEth'), statusHid: t('statusHid'),
                  statusWifi: t('statusWifi'), statusLive: t('statusLive'), foregroundColor: t('foregroundColor'),
                  statusStyle: t('statusStyle'), statusStyleText: t('statusStyleText'), statusStyleIcon: t('statusStyleIcon'), statusStyleImage: t('statusStyleImage'), showBorder: t('showBorder'),
                  activeColor: t('activeColor'), inactiveColor: t('inactiveColor'), lineColor: t('lineColor'),
                  showBackground: t('showBackground'), componentBackground: t('componentBackground'),
                  fillWhenActive: t('fillWhenActive'), filled: t('filled'), width: t('width'),
                  height: t('height'), thickness: t('thickness'), externalContentPlaceholder: t('externalContentPlaceholder'),
                  fontSize: t('fontSize'), textAlign: t('textAlign'), alignLeft: t('alignLeft'), alignCenter: t('alignCenter'), alignRight: t('alignRight'),
                  metric: t('metric'), metricCpu: t('metricCpu'), metricMemory: t('metricMemory'), metricStorage: t('metricStorage'),
                }"
                @update="updatePlacement"
              />
              <div v-if="selectedIds.length === 1 && selectedPlacement && layout.mode === 'grid'" class="widget-inspector">
                <div class="placement-controls">
                  <template v-if="layout.mode === 'grid'">
                    <label><span>{{ t('column') }}</span><NSlider :value="selectedPlacement.column ?? 0" :min="0" :max="selectedFace.columns - 1" :step="1" @update:value="updatePlacement({ column: $event })" /></label>
                    <label><span>{{ t('row') }}</span><NSlider :value="selectedPlacement.row ?? 0" :min="0" :max="selectedFace.rows - 1" :step="1" @update:value="updatePlacement({ row: $event })" /></label>
                  </template>
                </div>
              </div>
            </div>
            <aside class="canvas-layers">
              <header class="panel-head">
                <div>
                  <h2>{{ t(mode === 'home' ? 'layers' : 'appsHeading') }}</h2>
                  <p>{{ t('widgetsOnPage', { count: visibleOnPage }) }}</p>
                </div>
                <div class="add-widget-host">
                  <NButton size="small" quaternary @click="runCanvasAction('restore')">
                    {{ t('restoreDefault') }}
                  </NButton>
                  <NDropdown
                    trigger="click"
                    placement="bottom-end"
                    :options="addWidgetOptions"
                    :disabled="!addWidgetOptions.length"
                    @select="addWidget"
                  >
                    <NButton size="small" secondary :disabled="!addWidgetOptions.length">
                      {{ t(mode === 'home' ? 'addWidget' : 'addApp') }}
                    </NButton>
                  </NDropdown>
                </div>
              </header>
              <p v-if="mode === 'home' && !homeWidgetCatalog.length" class="widget-list-empty">{{ t('noHomeWidgets') }}</p>
              <p v-else-if="mode !== 'home'" class="widget-list-empty">{{ t('appPageHint') }}</p>
              <WidgetList
                :items="pageItems"
                :labels="{
                  empty: t('selectHint'), selectWidget: t('selectWidget'),
                  showWidget: t('showWidget'),
                  hideWidget: t('hideWidget'),
                  clockType: t('clockType'),
                  complicationType: t('complicationType'),
                  appType: t('appType'),
                }"
                @select="selectWidget"
                @toggle="toggleWidget"
                @reorder="reorderWidget"
              />
            </aside>
          </div>
        </section>
      </NTabPane>

      <NTabPane name="materials" :tab="t('materialLibrary')" display-directive="show">
        <MediaLibrary :library="mediaAssets" :used-ids="usedAssetIds" :labels="assetLabels" @update="mediaAssets = $event" />
      </NTabPane>

      <NTabPane name="variables" :tab="t('variablesTab')" display-directive="show">
        <DisplayVariables :status="screenStatus" :locale="locale" />
      </NTabPane>

      <NTabPane name="developer" :tab="t('devTitle')" display-directive="show">
        <ScreenDevtools v-if="activeTab === 'developer'" :host="host" :locale="locale" />
      </NTabPane>

      <NTabPane name="settings" :tab="t('settingsTab')" display-directive="show">
        <section class="settings-card">
          <label v-if="showEnable" class="toggle">
            <span>{{ t('enable') }}</span>
            <NSwitch v-model:value="enabled" />
          </label>
          <label v-if="showBrightness" class="field">
            <span>{{ t('brightness') }} · {{ brightness }}%</span>
            <NSlider v-model:value="brightness" :min="5" :max="100" :step="5" />
          </label>
          <label v-if="showRotate" class="field">
            <span>{{ t('direction') }}</span>
            <NSelect :value="rotate" :options="rotationOptions" @update:value="rotate = normalizeRotate($event)" />
          </label>
          <label v-if="showTransition" class="field">
            <span>{{ t('transition') }}</span>
            <NSelect v-model:value="transition" :options="transitionOptions" />
          </label>
        </section>
      </NTabPane>
    </NTabs>
    <NModal v-model:show="backgroundOpen" preset="card" :title="t('backgroundSettings')" style="width: min(620px, calc(100vw - 32px))">
      <label class="home-widget-field"><span>{{ t('backgroundColor') }}</span><NColorPicker :value="layout.background" :modes="['hex']" :show-alpha="true" :swatches="['#00000000', '#000000', '#111920cc']" @update:value="updateBackgroundColor" /></label>
      <AssetSelector :value="layout.background_asset" :library="mediaAssets" :used-ids="usedAssetIds" :title="t('backgroundImage')" :labels="assetLabels" images-only @select="selectBackgroundAsset" @update="mediaAssets = $event" />
      <BackgroundRegionEditor v-if="backgroundSource" :source="backgroundSource" :asset="backgroundAsset" :background="backgroundColor" :width="panel.width" :height="panel.height" :value="layout.background_crop" :labels="{ title: t('backgroundRegion'), reset: t('backgroundRegionReset'), zoom: t('backgroundZoom'), hint: t('backgroundRegionHint') }" @update="updateBackgroundCrop" @edit-start="history.pointerDown" @edit-end="history.pointerUp" />
      <p v-if="backgroundPending">{{ t('mediaProcessing') }}</p>
      <NAlert v-if="backgroundRenderError" type="error" :show-icon="false">{{ t('mediaInvalid') }}</NAlert>
      <div v-if="backgroundPreviewUrl && !layout.background_asset" class="background-image-control"><img :src="backgroundPreviewUrl" :alt="t('backgroundImage')" style="width: 96px"><NButton @click="selectBackgroundAsset(undefined)">{{ t('backgroundRemove') }}</NButton></div>
    </NModal>
    <NModal v-model:show="mediaPickerOpen" preset="card" :title="t('materialLibrary')" style="width: min(760px, calc(100vw - 32px))">
      <MediaLibrary :library="mediaAssets" :used-ids="usedAssetIds" :labels="assetLabels" selectable @select="selectMediaAsset" @update="mediaAssets = $event" />
    </NModal>
  </div>
</template>
