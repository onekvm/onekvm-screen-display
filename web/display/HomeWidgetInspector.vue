<script setup lang="ts">
import { computed } from 'vue'
import { NColorPicker, NInput, NInputNumber, NSelect, NSwitch } from 'naive-ui'

import { homeStatusStyle, homeWidgetSize, type HomeStatusSource, type HomeWidgetKind } from '../../src/shared/homeWidgets'
import type { HomeWidgetPlacement } from './types'

const props = defineProps<{
  placement: HomeWidgetPlacement
  kind: HomeWidgetKind
  labels: Record<string, string>
  maxWidth: number
  maxHeight: number
}>()

const emit = defineEmits<{
  update: [patch: Partial<HomeWidgetPlacement>]
}>()

const palette = ['#22c55e', '#f4f0e6', '#ffb000', '#6ee7ff', '#c4b5fd', '#34d399', '#fb7185', '#111821', '#000000']
const size = computed(() => homeWidgetSize(props.kind, props.placement))
const statusOptions = computed(() => [
  { label: props.labels.statusHdmi, value: 'hdmi' },
  { label: props.labels.statusEth, value: 'eth' },
  { label: props.labels.statusHid, value: 'hid' },
  { label: props.labels.statusWifi, value: 'wifi' },
  { label: props.labels.statusLive, value: 'live' },
])
const statusStyle = computed(() => homeStatusStyle(props.placement))
const styleOptions = computed(() => ['text', 'icon', 'image'].map(value => ({ value, label: props.labels[`statusStyle${value[0].toUpperCase()}${value.slice(1)}`] })))
const showsText = computed(() => (props.kind !== 'status' || statusStyle.value === 'text') && props.kind !== 'line' && props.kind !== 'media' && props.kind !== 'progress')
const showsBackground = computed(() => ['text', 'status', 'external'].includes(props.kind))
const fontOptions = [12, 14, 16, 24].map(value => ({ label: `${value} px`, value }))
const alignOptions = computed(() => ['left', 'center', 'right'].map(value => ({ label: props.labels[value === 'left' ? 'alignLeft' : value === 'right' ? 'alignRight' : 'alignCenter'], value })))
const metricOptions = computed(() => [
  { label: props.labels.metricCpu, value: 'cpu' }, { label: props.labels.metricMemory, value: 'memory' }, { label: props.labels.metricStorage, value: 'storage' },
])
const accentLabel = computed(() => {
  if (props.kind === 'line') return props.labels.lineColor
  if (props.kind === 'status') return props.labels.activeColor
  return props.labels.foregroundColor
})

function updateNumber(field: 'width' | 'height', value: number | null) {
  if (value !== null) emit('update', { [field]: value })
}

function updateStatus(value: string | number | null) {
  if (value === null) return
  const status = String(value) as HomeStatusSource
  const labels: Record<HomeStatusSource, string> = {
    eth: 'ETH', hdmi: 'HDMI', hid: 'HID', wifi: 'WI-FI', live: 'LIVE',
  }
  const defaults = new Set(Object.values(labels))
  emit('update', {
    status,
    ...(defaults.has(props.placement.text || '') ? { text: labels[status] } : {}),
  })
}
</script>

<template>
  <section class="home-widget-inspector" :aria-label="labels.componentSettings">
    <header>
      <h3>{{ labels.componentSettings }}</h3>
      <p v-if="kind === 'text' || kind === 'rect'">{{ labels.variableHint }}</p>
      <p v-else-if="kind === 'status'">{{ labels.statusHint }}</p>
    </header>

    <div class="home-widget-fields">
      <label v-if="kind === 'status'" class="home-widget-field">
        <span>{{ labels.statusSource }}</span>
        <NSelect :value="placement.status || 'hdmi'" :options="statusOptions" @update:value="updateStatus" />
      </label>

      <label v-if="kind === 'status'" class="home-widget-field">
        <span>{{ labels.statusStyle }}</span>
        <NSelect :value="statusStyle" :options="styleOptions" @update:value="emit('update', { status_style: $event })" />
      </label>

      <label v-if="showsText" class="home-widget-field home-widget-field-wide">
        <span>{{ labels.componentContent }}</span>
        <NInput
          :value="placement.text || ''"
          :maxlength="64"
          :placeholder="kind === 'external' ? labels.externalContentPlaceholder : undefined"
          @update:value="emit('update', { text: $event })"
        />
      </label>

      <template v-if="showsText">
        <label class="home-widget-field"><span>{{ labels.fontSize }}</span><NSelect :value="placement.font_size ?? 12" :options="fontOptions" @update:value="emit('update', { font_size: $event })" /></label>
        <label class="home-widget-field"><span>{{ labels.textAlign }}</span><NSelect :value="placement.text_align ?? 'center'" :options="alignOptions" @update:value="emit('update', { text_align: $event })" /></label>
      </template>
      <label v-if="kind === 'progress'" class="home-widget-field"><span>{{ labels.metric }}</span><NSelect :value="placement.metric ?? 'cpu'" :options="metricOptions" @update:value="emit('update', { metric: $event })" /></label>

      <label v-if="kind !== 'media'" class="home-widget-field">
        <span>{{ accentLabel }}</span>
        <NColorPicker
          :value="placement.accent || '#f4f0e6'"
          :modes="['hex']"
          :show-alpha="false"
          :swatches="palette"
          @update:value="emit('update', { accent: $event })"
        />
      </label>

      <label v-if="kind === 'status'" class="home-widget-field">
        <span>{{ labels.inactiveColor }}</span>
        <NColorPicker
          :value="placement.inactive || '#667085'"
          :modes="['hex']"
          :show-alpha="false"
          :swatches="palette"
          @update:value="emit('update', { inactive: $event })"
        />
      </label>

      <label v-if="kind === 'status' && statusStyle !== 'image'" class="home-widget-field home-widget-switch-field">
        <span>{{ labels.showBorder }}</span>
        <NSwitch :value="placement.show_border !== false" @update:value="emit('update', { show_border: $event })" />
      </label>

      <label v-if="showsBackground && (kind !== 'status' || statusStyle !== 'image')" class="home-widget-field home-widget-switch-field">
        <span>{{ labels.showBackground }}</span>
        <NSwitch
          :value="placement.show_background !== false"
          @update:value="emit('update', { show_background: $event })"
        />
      </label>

      <label v-if="showsBackground && placement.show_background !== false && (kind !== 'status' || statusStyle !== 'image')" class="home-widget-field">
        <span>{{ labels.componentBackground }}</span>
        <NColorPicker
          :value="placement.background || '#111821'"
          :modes="['hex']"
          :show-alpha="true"
          :swatches="['#00000000', ...palette]"
          @update:value="emit('update', { background: $event })"
        />
      </label>

      <label v-if="kind === 'rect' || kind === 'progress'" class="home-widget-field">
        <span>{{ labels.componentBackground }}</span>
        <NColorPicker
          :value="placement.background || '#1f2937'"
          :modes="['hex']"
          :show-alpha="true"
          :swatches="['#00000000', ...palette]"
          @update:value="emit('update', { background: $event })"
        />
      </label>

      <label v-if="(kind === 'status' && statusStyle !== 'image') || kind === 'rect'" class="home-widget-field home-widget-switch-field">
        <span>{{ kind === 'status' ? labels.fillWhenActive : labels.filled }}</span>
        <NSwitch :value="placement.filled === true" @update:value="emit('update', { filled: $event })" />
      </label>

      <label class="home-widget-field">
        <span>{{ labels.width }}</span>
        <NInputNumber
          :value="size.width"
          :min="2"
          :max="Math.max(2, maxWidth)"
          :show-button="false"
          @update:value="updateNumber('width', $event)"
        />
      </label>

      <label class="home-widget-field">
        <span>{{ kind === 'line' ? labels.thickness : labels.height }}</span>
        <NInputNumber
          :value="size.height"
          :min="1"
          :max="Math.max(1, maxHeight)"
          :show-button="false"
          @update:value="updateNumber('height', $event)"
        />
      </label>
    </div>
  </section>
</template>
