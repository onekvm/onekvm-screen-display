<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NSlider } from 'naive-ui'
import { backgroundImageDataUrl, parseBackgroundImage } from './background-image'
import { backgroundFill, cropGeometry, DEFAULT_BACKGROUND_CROP, MAX_BACKGROUND_ZOOM, MIN_BACKGROUND_ZOOM, normalizeBackgroundCrop, type BackgroundCrop } from './background-crop'
import { mediaImageUrl, type MediaAsset } from './media-asset'
const props = defineProps<{ source: string; asset?: MediaAsset; width: number; height: number; value?: BackgroundCrop; background?: string; labels: Record<string, string> }>()
const emit = defineEmits<{ update: [crop: BackgroundCrop]; editStart: []; editEnd: [] }>()
const image = computed(() => props.asset?.original ?? parseBackgroundImage(props.source))
const imageUrl = computed(() => mediaImageUrl(props.asset) || backgroundImageDataUrl(props.source))
const crop = computed(() => normalizeBackgroundCrop(props.value))
const geometry = computed(() => image.value ? cropGeometry(image.value, props, crop.value) : null)
const imageStyle = computed(() => {
  const region = geometry.value, source = image.value
  if (!region || !source) return {}
  return { width: `${source.width * region.scale / props.width * 100}%`, height: `${source.height * region.scale / props.height * 100}%`,
    left: `${-region.x * region.scale / props.width * 100}%`, top: `${-region.y * region.scale / props.height * 100}%` }
})
let drag: { id: number; x: number; y: number; crop: BackgroundCrop; overflowX: number; overflowY: number } | null = null
function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || !geometry.value || !image.value) return
  const surface = event.currentTarget as HTMLElement, rect = surface.getBoundingClientRect()
  const scale = rect.width / props.width
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, crop: { ...crop.value },
    overflowX: (image.value.width * geometry.value.scale - props.width) * scale,
    overflowY: (image.value.height * geometry.value.scale - props.height) * scale }
  surface.setPointerCapture(event.pointerId)
  surface.focus()
}
function pointerMove(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  emit('update', normalizeBackgroundCrop({ ...drag.crop,
    x: drag.crop.x - (Math.abs(drag.overflowX) > 0.01 ? (event.clientX - drag.x) / drag.overflowX * 100 : 0),
    y: drag.crop.y - (Math.abs(drag.overflowY) > 0.01 ? (event.clientY - drag.y) / drag.overflowY * 100 : 0) }))
}
function pointerUp(event: PointerEvent) {
  if (drag?.id !== event.pointerId) return
  pointerMove(event)
  drag = null
}
function keydown(event: KeyboardEvent) {
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }
  const delta = arrows[event.key]
  if (!delta) return
  event.preventDefault()
  emit('update', normalizeBackgroundCrop({ ...crop.value, x: crop.value.x + delta[0], y: crop.value.y + delta[1] }))
}
</script>
<template>
  <section v-if="image" class="background-region-editor" :aria-label="labels.title" @pointerdown.capture="emit('editStart')" @pointerup.capture="emit('editEnd')" @pointercancel.capture="emit('editEnd')">
    <header><strong>{{ labels.title }}</strong><NButton size="small" secondary @click="emit('update', { ...DEFAULT_BACKGROUND_CROP })">{{ labels.reset }}</NButton></header>
    <div class="background-region-surface" :style="{ background: backgroundFill(background), aspectRatio: `${width} / ${height}`, maxWidth: `${360 * width / height}px` }" tabindex="0" role="group" :aria-label="labels.hint"
      @pointerdown.prevent="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="drag = null" @lostpointercapture="drag = null" @keydown="keydown">
      <img :src="imageUrl" :style="imageStyle" alt="" draggable="false" />
      <i class="background-region-grid" aria-hidden="true" />
    </div>
    <label class="home-widget-field"><span>{{ labels.zoom }} · {{ Math.round(crop.zoom * 100) }}%</span><NSlider :value="crop.zoom" :min="MIN_BACKGROUND_ZOOM" :max="MAX_BACKGROUND_ZOOM" :step="0.01" :tooltip="false" @update:value="emit('update', { ...crop, zoom: $event })" /></label>
    <p>{{ labels.hint }}</p>
  </section>
</template>
