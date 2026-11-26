<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import type { SelectionGesture } from './designer-arrange'
import AppIcon from './AppIcon.vue'
import { statusIconBadge, statusIconRects } from '../../src/shared/statusIcons'
import { DASHBOARD_CLOCK } from '../../src/shared/dashboard'
import { formatClockTime, type ClockFormat } from '../../src/shared/clockFormat'
import ClockWidget from './ClockWidget.vue'
import MediaWidgetPreview from './MediaWidgetPreview.vue'
import type { MediaAsset } from './media-asset'
import {
  expandHomeWidgetTemplate,
  homeStatusActive,
  homeStatusStyle,
  homeMetricPercent,
  homeWidgetSize,
  type HomeWidgetStatus,
} from '../../src/shared/homeWidgets'
import type { AppView, DisplayFace, DisplayWidget, HomeWidgetItem, HomeWidgetPlacement, LauncherLayout, PanelInfo, PlacementMode, PreviewMode } from './types'
import { DEFAULT_LAUNCHER, accentColor, placementKind } from './types'
import { resizeHomeWidget, type WidgetResizeStart } from './widget-resize'
import { CLOCK_WIDGET_ID, homeLayerOrder } from '../../src/shared/homeLayers'

const props = defineProps<{
  selectedId: string
  selectedIds: string[]
  resizeLabel: string
  panel: PanelInfo
  mode: PreviewMode
  hdmiOn: boolean
  usbOn: boolean
  ip: string
  brightness: number
  rotate: number
  appView: AppView
  homeItems: HomeWidgetItem[]
  layerOrder: readonly string[]
  mediaAssets: Record<string, MediaAsset>
  status: HomeWidgetStatus
  background: string
  backgroundImage: string
  face: DisplayFace
  placementMode: PlacementMode
  clockPosition: { x: number; y: number; scale: number }
  clockVisible: boolean
  clockFormat: ClockFormat
  apps: DisplayWidget[]
  launcher?: LauncherLayout
  detailId: string
}>()

const emit = defineEmits<{
  'update:mode': [value: PreviewMode]
  'update:detailId': [value: string]
  'update:appView': [value: AppView]
  moveWidget: [id: string, patch: Partial<HomeWidgetPlacement>]
  moveClock: [point: Partial<{ x: number; y: number; scale: number }>]
  selectWidget: [id: string, gesture?: SelectionGesture]
  moveGroup: [positions: { id: string; x: number; y: number }[]]
}>()

const appPage = ref(0)
const dragX = ref(0)
const launcher = computed(() => props.launcher || DEFAULT_LAUNCHER)
const pageSize = computed(() => props.appView === 'list'
  ? Math.max(1, launcher.value.listRows)
  : Math.max(1, launcher.value.iconColumns * launcher.value.iconRows))
const appPageCount = computed(() => Math.max(1, Math.ceil(props.apps.length / pageSize.value)))
const pagedApps = computed(() => {
  const start = appPage.value * pageSize.value
  return props.apps.slice(start, start + pageSize.value)
})
const iconGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${launcher.value.iconColumns}, ${launcher.value.iconSize}px)`,
  gap: '10px',
}))
const iconOrbStyle = computed(() => ({
  width: `${launcher.value.iconSize}px`,
  height: `${launcher.value.iconSize}px`,
}))
const now = ref(new Date())
let clockTimer: number | null = null
const clockParts = computed(() => formatClockTime(now.value.getHours(), now.value.getMinutes(), props.clockFormat))
const clock = computed(() => `${clockParts.value.hh}:${clockParts.value.mm}`)
const date = computed(() => now.value.toLocaleDateString('en-GB', {
  weekday: 'short',
  day: 'numeric',
}).toUpperCase())
// panel_json already uses logical post-rotation dimensions from the host.
const orientedWidth = computed(() => props.panel.width)
const orientedHeight = computed(() => props.panel.height)
const previewStyle = computed(() => ({
  width: `${orientedWidth.value}px`,
  height: `${orientedHeight.value}px`,
  borderRadius: props.panel.shape === 'round' ? '50%' : '18px',
  opacity: String(0.45 + (Math.min(100, Math.max(5, props.brightness)) / 100) * 0.55),
  backgroundColor: props.mode === 'home' ? props.background : '#000000',
  backgroundImage: props.mode === 'home' && props.backgroundImage ? `url("${props.backgroundImage}")` : 'none',
  backgroundPosition: 'center',
  backgroundSize: 'cover',
}))
const dragVisual = shallowRef<{ id: string; x: number; y: number } | null>(null)
const detail = computed(() => props.apps.find((item) => item.id === props.detailId))
const layerDepth = computed(() => new Map(homeLayerOrder(props.homeItems.map(item => item.placement.id), props.layerOrder).map((id, index) => [id, index + 1])))
const placedWidgets = computed(() => props.homeItems.filter(({ placement }) => placement.hidden !== true).map(({ placement, widget }, index) => {
  const slot = props.face.slots.find((item) => item.id === placement?.slot) || props.face.slots[index % Math.max(1, props.face.slots.length)]
  let x = slot?.x ?? 50
  let y = slot?.y ?? 78
  if (props.placementMode === 'grid') {
    x = ((Math.min(props.face.columns - 1, placement?.column ?? index % props.face.columns) + 0.5) / props.face.columns) * 100
    y = ((Math.min(props.face.rows - 1, placement?.row ?? Math.floor(index / props.face.columns)) + 0.5) / props.face.rows) * 100
  } else {
    x = placement?.x ?? 50
    y = placement?.y ?? 78
  }
  if (dragVisual.value?.id === placement.id) {
    x = dragVisual.value.x
    y = dragVisual.value.y
  }
  const kind = placementKind(placement, widget)
  const text = kind === 'line' || kind === 'media' || kind === 'progress' ? '' : expandHomeWidgetTemplate(
    placement.text ?? widget.preview ?? widget.glyph ?? '',
    props.status, now.value,
  )
  const active = kind === 'status' ? homeStatusActive(placement.status || 'hdmi', props.status) : true
  const accent = accentColor(placement.accent || widget.accent)
  const inactive = accentColor(placement.inactive || '#667085')
  const background = accentColor(placement.background || '#111821')
  const showBackground = placement.show_background ?? (kind === 'status' || kind === 'external')
  const filled = placement.filled === true
  const { width, height } = homeWidgetSize(kind, placement)
  let color = accent
  let backgroundColor = 'transparent'
  let borderColor = 'transparent'
  let borderWidth = '0'
  if (kind === 'status') {
    color = active ? accent : inactive
    if (active && filled) {
      color = '#071018'
      backgroundColor = accent
    } else if (showBackground) {
      backgroundColor = background
    }
    if (placement.show_border !== false && active && !filled) {
      borderColor = accent
      borderWidth = '2px'
    }
  } else if (kind === 'rect') {
    if (filled) backgroundColor = background
    else {
      borderColor = accent
      borderWidth = '2px'
    }
  } else if (kind !== 'line' && showBackground) {
    backgroundColor = background
  }
  if (kind === 'line') backgroundColor = accent
  if (kind === 'progress') backgroundColor = background
  return {
    id: placement.id,
    widget,
    kind,
    text,
    active,
    icon: kind === 'status' && homeStatusStyle(placement) === 'icon' ? statusIconRects(placement.status || 'hdmi', width, height) : null,
    badge: kind === 'status' && homeStatusStyle(placement) === 'icon' ? statusIconBadge(placement.status || 'hdmi', width, height, props.status.sessionCount) : null,
    badgeTextColor: active && filled ? accent : '#000000',
    iconLabel: placement.status === 'live' ? `${widget.title}: ${props.status.sessionCount}` : undefined,
    progress: homeMetricPercent(placement.metric, props.status),
    asset: kind === 'media' ? props.mediaAssets[placement.media_asset ?? placement.id] : kind === 'status' && homeStatusStyle(placement) === 'image' ? props.mediaAssets[(active ? placement.status_active_image : placement.status_inactive_image) || ''] : undefined,
    mediaFit: placement.media_fit ?? 'contain',
    mediaSpeed: placement.media_speed ?? 1,
    mediaLoop: placement.media_loop !== false,
    x,
    y,
    scale: placement.scale ?? 1,
    width,
    height,
    style: { color, backgroundColor, borderColor, borderWidth, zIndex: layerDepth.value.get(placement.id), fontSize: `${placement.font_size ?? 12}px`, justifyItems: placement.text_align === 'left' ? 'start' : placement.text_align === 'right' ? 'end' : 'center', ...(placement.radius === undefined ? {} : { borderRadius: `${placement.radius}px` }) },
  }
}))
const selectedWidget = computed(() => placedWidgets.value.find(item => item.id === props.selectedId))
const selections = computed(() => {
  const dashboard = props.face.id === 'screen-display/dashboard'
  const size = Math.min(props.panel.width, props.panel.height) * (props.face.id === 'screen-display/digital' ? 1.15 : 1)
  return props.selectedIds.flatMap(id => {
    const bounds = placedWidgets.value.find(item => item.id === id) || (id === CLOCK_WIDGET_ID && props.clockVisible
      ? { ...props.clockPosition, width: dashboard ? DASHBOARD_CLOCK.width : size, height: dashboard ? DASHBOARD_CLOCK.height : size }
      : undefined)
    return bounds ? [{ id, style: {
      left: `${bounds.x}%`, top: `${bounds.y}%`, width: `${bounds.width}px`, height: `${bounds.height}px`,
      transform: `translate(-50%, -50%) scale(${bounds.scale})`, zIndex: layerDepth.value.size + 1,
    } }] : []
  })
})

type DragTarget = { id: string | null; pointerId: number; startX: number; startY: number; x: number; y: number }
let dragTarget: DragTarget | null = null
let dragMoved = false
let groupStart: { id: string; x: number; y: number }[] = []
type ResizeTarget = { id: string; pointerId: number; startX: number; startY: number; widget: WidgetResizeStart; viewport: { width: number; height: number }; mode: PlacementMode }
let resizeTarget: ResizeTarget | null = null

function accent(widget: DisplayWidget) {
  return accentColor(widget.accent)
}

function onPointerDown(event: PointerEvent) {
  dragX.value = event.clientX
}

function onPointerUp(event: PointerEvent) {
  const dx = event.clientX - dragX.value
  if (dx > 36 && props.mode === 'home') {
    appPage.value = 0
    emit('update:mode', 'apps')
  } else if (dx < -36 && props.mode === 'detail') {
    emit('update:mode', 'apps')
  } else if (dx < -36 && props.mode === 'apps') {
    if (appPage.value + 1 < appPageCount.value)
      appPage.value += 1
  } else if (dx > 36 && props.mode === 'apps') {
    if (appPage.value > 0)
      appPage.value -= 1
    else
      emit('update:mode', 'home')
  }
}

function openApp(id: string) {
  emit('update:detailId', id)
  emit('update:mode', 'detail')
}

function setAppView(value: AppView) {
  emit('update:appView', value)
}

function moveWidget(id: string, event: PointerEvent, drag: DragTarget) {
  const preview = (event.currentTarget as HTMLElement).closest('.display-preview') as HTMLElement | null
  if (!preview) return
  const rect = preview.getBoundingClientRect()
  const x = Math.max(0, Math.min(100, drag.x + (event.clientX - drag.startX) / rect.width * 100))
  const y = Math.max(0, Math.min(100, drag.y + (event.clientY - drag.startY) / rect.height * 100))
  if (props.placementMode === 'free') emit('moveWidget', id, { x: Math.round(x), y: Math.round(y) })
  if (props.placementMode !== 'free') dragVisual.value = { id, x, y }
}

function moveClock(event: PointerEvent, drag: DragTarget) {
  const preview = (event.currentTarget as HTMLElement).closest('.display-preview') as HTMLElement | null
  if (!preview) return
  const rect = preview.getBoundingClientRect()
  emit('moveClock', {
    x: Math.round(Math.max(0, Math.min(100, drag.x + (event.clientX - drag.startX) / rect.width * 100))),
    y: Math.round(Math.max(0, Math.min(100, drag.y + (event.clientY - drag.startY) / rect.height * 100))),
  })
}

function selectForDrag(id: string, event: PointerEvent): boolean {
  const toggle = event.ctrlKey || event.metaKey, range = event.shiftKey
  emit('selectWidget', id, { toggle, range, preserve: true })
  if (toggle || range) return false
  dragMoved = false
  const ids = props.selectedIds.includes(id) ? props.selectedIds : [id]
  groupStart = ids.flatMap(selected => {
    if (selected === CLOCK_WIDGET_ID) return [{ id: selected, ...props.clockPosition }]
    const item = placedWidgets.value.find(item => item.id === selected)
    return item ? [{ id: selected, x: item.x, y: item.y }] : []
  })
  return props.placementMode === 'free' || ids.length === 1
}

function captureWidget(id: string, x: number, y: number, event: PointerEvent) {
  if (event.button !== 0) return
  if (!selectForDrag(id, event)) return
  dragTarget = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x, y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function captureClock(event: PointerEvent) {
  if (event.button !== 0) return
  if (!selectForDrag(CLOCK_WIDGET_ID, event)) return
  dragTarget = { id: null, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: props.clockPosition.x, y: props.clockPosition.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function dragMove(event: PointerEvent) {
  const drag = dragTarget
  if (!drag || event.pointerId !== drag.pointerId) return
  if (!dragMoved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 2) return
  dragMoved = true
  if (props.placementMode === 'free') {
    const rect = (event.currentTarget as HTMLElement).closest('.display-preview')!.getBoundingClientRect()
    const dx = Math.max(-Math.min(...groupStart.map(p => p.x)), Math.min(100 - Math.max(...groupStart.map(p => p.x)), (event.clientX - drag.startX) / rect.width * 100))
    const dy = Math.max(-Math.min(...groupStart.map(p => p.y)), Math.min(100 - Math.max(...groupStart.map(p => p.y)), (event.clientY - drag.startY) / rect.height * 100))
    emit('moveGroup', groupStart.map(p => ({ id: p.id, x: Math.round((p.x + dx) * 100) / 100, y: Math.round((p.y + dy) * 100) / 100 })))
  } else if (drag.id === null) moveClock(event, drag)
  else moveWidget(drag.id, event, drag)
}

function endDrag(event: PointerEvent) {
  if (dragTarget?.pointerId !== event.pointerId) return
  dragMove(event)
  if (dragTarget.id && props.placementMode === 'grid' && dragVisual.value) {
    const { x, y } = dragVisual.value
    emit('moveWidget', dragTarget.id, {
      column: Math.min(props.face.columns - 1, Math.floor(x / 100 * props.face.columns)),
      row: Math.min(props.face.rows - 1, Math.floor(y / 100 * props.face.rows)),
    })
  }
  dragVisual.value = null
  dragTarget = null
}

function cancelDrag() {
  dragTarget = null
  dragVisual.value = null
}

function captureResize(item: WidgetResizeStart & { id: string }, event: PointerEvent) {
  if (event.button !== 0) return
  const handle = event.currentTarget as HTMLElement
  const viewport = handle.closest('.display-preview')?.getBoundingClientRect()
  if (!viewport) return
  dragTarget = null
  resizeTarget = { id: item.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, widget: { x: item.x, y: item.y, width: item.width, height: item.height, scale: item.scale }, viewport: { width: viewport.width, height: viewport.height }, mode: props.placementMode }
  handle.setPointerCapture(event.pointerId)
}

function resizeMove(event: PointerEvent) {
  const resize = resizeTarget
  if (!resize || resize.pointerId !== event.pointerId) return
  emit('moveWidget', resize.id, resizeHomeWidget(resize.widget, { x: event.clientX - resize.startX, y: event.clientY - resize.startY }, props.panel, resize.viewport, resize.mode))
}

function endResize(event: PointerEvent) {
  if (resizeTarget?.pointerId !== event.pointerId) return
  resizeMove(event)
  resizeTarget = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
}

function cancelResize() {
  resizeTarget = null
}

watch(appPageCount, (count) => {
  if (appPage.value >= count)
    appPage.value = Math.max(0, count - 1)
})

onMounted(() => {
  clockTimer = window.setInterval(() => { now.value = new Date() }, 1000)
})

onBeforeUnmount(() => {
  if (clockTimer !== null)
    window.clearInterval(clockTimer)
})
</script>

<template>
  <div
    class="display-preview"
    :class="{ lock: props.hdmiOn, round: props.panel.shape === 'round' }"
    :style="previewStyle"
    role="group"
    :aria-label="`${props.panel.width}x${props.panel.height}`"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
  >
    <div v-if="props.mode === 'home'" class="preview-home">
      <ClockWidget
        v-if="props.clockVisible"
        :face-id="props.face.id"
        :status="props.status"
        :time="clock"
        :period="clockParts.period"
        :seconds="now.getSeconds()"
        :date="date"
        :dial="props.face.dial"
        :panel-width="orientedWidth"
        :panel-height="orientedHeight"
        :x="props.clockPosition.x"
        :y="props.clockPosition.y"
        :scale="props.clockPosition.scale"
        :layer="layerDepth.get(CLOCK_WIDGET_ID) || 1"
        :selected="props.selectedIds.includes('clock')"
        @pointerdown.stop="captureClock"
        @pointermove.stop="dragMove"
        @pointerup.stop="endDrag"
        @pointercancel.stop="cancelDrag"
          @lostpointercapture="cancelDrag"
      />
      <div v-if="placedWidgets.length" class="home-widgets">
        <span
          v-for="item in placedWidgets"
          :key="item.id"
          class="home-widget"
          :class="[`is-${item.kind}`, { active: item.active, selected: props.selectedIds.includes(item.id), 'has-status-image': item.kind === 'status' && item.asset }]"
          :style="{
            ...item.style,
            left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}px`, height: `${item.height}px`,
            transform: `translate(-50%, -50%) scale(${item.scale})`,
          }"
          @pointerdown.stop="captureWidget(item.id, item.x, item.y, $event)"
          @pointermove.stop="dragMove"
          @pointerup.stop="endDrag"
          @pointercancel.stop="cancelDrag"
          @lostpointercapture="cancelDrag"
        >
          <MediaWidgetPreview
            v-if="item.kind === 'media' || item.asset"
            :asset="item.asset"
            :fit="item.mediaFit"
            :speed="item.mediaSpeed"
            :loop="item.mediaLoop"
          />
          <svg v-else-if="item.icon" :viewBox="`0 0 ${item.width} ${item.height}`" class="home-status-icon" :aria-hidden="item.iconLabel ? undefined : true" :role="item.iconLabel ? 'img' : undefined" :aria-label="item.iconLabel">
            <rect v-for="(rect, index) in item.icon" :key="index" :x="rect.x" :y="rect.y" :width="rect.width" :height="rect.height" :fill-opacity="rect.opacity" fill="currentColor" />
            <g v-if="item.badge" class="home-status-badge">
              <rect :x="item.badge.x" :y="item.badge.y" :width="item.badge.width" :height="item.badge.height" :rx="item.badge.radius" fill="currentColor" />
              <text :x="item.badge.x + item.badge.width / 2" :y="item.badge.y + item.badge.height / 2" dy="0.35em" text-anchor="middle" font-size="12" font-weight="700" :fill="item.badgeTextColor">{{ item.badge.text }}</text>
            </g>
          </svg>
          <i v-else-if="item.kind === 'progress'" class="home-progress-fill" :style="{ width: `${item.progress}%`, backgroundColor: item.style.color }" />
          <AppIcon v-else-if="item.kind === 'external' && item.widget.icon" :name="item.widget.icon" :accent="String(item.style.color)" />
          <span v-else-if="item.kind !== 'line'" class="home-widget-label">{{ item.text }}</span>
        </span>
      </div>
      <div v-for="selection in selections" :key="selection.id" class="home-selection" :style="selection.style">
        <button
          v-if="props.selectedIds.length === 1 && selectedWidget"
          type="button"
          class="home-widget-resize"
          :aria-label="props.resizeLabel"
          :title="props.resizeLabel"
          @pointerdown.stop.prevent="captureResize(selectedWidget, $event)"
          @pointermove.stop.prevent="resizeMove"
          @pointerup.stop.prevent="endResize"
          @pointercancel.stop="cancelResize"
          @lostpointercapture="cancelResize"
          @click.stop
        />
      </div>
    </div>
    <div
      v-else-if="props.mode === 'apps'"
      class="preview-apps"
      :class="props.appView"
      :style="props.appView === 'icons' ? iconGridStyle : undefined"
    >
      <button
        v-for="widget in pagedApps"
        :key="widget.id"
        type="button"
        class="app"
        :class="props.appView"
        :aria-label="widget.title"
        @click.stop="openApp(widget.id)"
      >
        <span class="orb" :style="props.appView === 'icons' ? iconOrbStyle : undefined">
          <AppIcon :name="widget.icon || widget.id" :accent="accent(widget)" />
        </span>
        <span v-if="props.appView === 'list'" class="label">{{ widget.title }}</span>
      </button>
    </div>
    <div v-else class="preview-detail">
      <span class="orb">
        <AppIcon v-if="detail" :name="detail.icon || detail.id" :accent="accent(detail)" />
      </span>
      <strong>{{ detail?.title || props.detailId }}</strong>
      <template v-if="props.detailId === 'settings'">
        <span>{{ props.brightness }}%</span>
        <div class="view-pills">
          <button type="button" :class="{ on: props.appView === 'icons' }" @click="setAppView('icons')">图标</button>
          <button type="button" :class="{ on: props.appView === 'list' }" @click="setAppView('list')">列表</button>
        </div>
      </template>
    </div>
  </div>
</template>
