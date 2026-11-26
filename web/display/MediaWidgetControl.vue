<script setup lang="ts">
import { computed } from 'vue'
import { Film } from '@lucide/vue'
import { NButton, NSelect, NSwitch } from 'naive-ui'

import MediaWidgetPreview from './MediaWidgetPreview.vue'
import { isCompressedVideo, mediaAssetDurationMs, type MediaAsset } from './media-asset'
import type { HomeWidgetPlacement, MediaFit } from './types'

const props = defineProps<{
  asset?: MediaAsset
  fit: MediaFit
  speed: number
  loop: boolean
  labels: Record<string, string>
}>()

const emit = defineEmits<{
  choose: []
  clear: []
  configure: [patch: Partial<Pick<HomeWidgetPlacement, 'media_fit' | 'media_speed' | 'media_loop'>>]
}>()

const summary = computed(() => {
  if (!props.asset) return ''
  const format = props.asset.format === 'image' ? props.labels.mediaImage : props.asset.format.toUpperCase()
  const frames = props.asset.frames.length > 1 ? ` · ${props.asset.frames.length} ${props.labels.mediaFrames}` : ''
  const duration = isCompressedVideo(props.asset) ? ` · ${(mediaAssetDurationMs(props.asset) / 1000).toFixed(1)} s` : ''
  return `${props.asset.width}×${props.asset.height} · ${format}${frames}${duration}`
})
const animated = computed(() => Boolean(props.asset && (props.asset.format === 'h264' || props.asset.frames.length > 1)))
const fitOptions = computed(() => [
  { label: props.labels.mediaFitContain, value: 'contain' },
  { label: props.labels.mediaFitCover, value: 'cover' },
  { label: props.labels.mediaFitFill, value: 'fill' },
])
const speedOptions = [0.5, 0.75, 1, 1.5, 2].map((value) => ({ label: `${value}×`, value }))

</script>

<template>
  <section class="media-widget-control" :aria-label="labels.mediaSource">
    <div class="media-widget-thumbnail" :class="{ empty: !asset }">
      <MediaWidgetPreview v-if="asset" :asset="asset" :fit="fit" :speed="speed" :loop="loop" />
      <div v-else class="media-widget-empty">
        <Film :size="24" aria-hidden="true" />
        <span>{{ labels.mediaEmpty }}</span>
      </div>
    </div>
    <div class="media-widget-copy">
      <div>
        <strong>{{ labels.mediaSource }}</strong>
        <p>{{ labels.mediaHint }}</p>
        <small v-if="asset">{{ asset.name }} · {{ summary }}</small>
      </div>
      <div class="media-widget-actions">
        <NButton size="small" secondary @click="emit('choose')">{{ labels.materialChoose }}</NButton>
        <NButton v-if="asset" size="small" quaternary @click="emit('clear')">{{ labels.mediaRemove }}</NButton>
      </div>
    </div>
    <div class="media-widget-settings" :aria-label="labels.mediaSettings">
      <strong>{{ labels.mediaSettings }}</strong>
      <div class="home-widget-fields">
        <label class="home-widget-field">
          <span>{{ labels.mediaFit }}</span>
          <NSelect
            size="small"
            :value="fit"
            :options="fitOptions"
            @update:value="emit('configure', { media_fit: $event as MediaFit })"
          />
        </label>
        <label v-if="animated" class="home-widget-field">
          <span>{{ labels.mediaSpeed }}</span>
          <NSelect
            size="small"
            :value="speed"
            :options="speedOptions"
            @update:value="emit('configure', { media_speed: Number($event) })"
          />
        </label>
        <label v-if="animated" class="home-widget-field home-widget-switch-field">
          <span>{{ labels.mediaLoop }}</span>
          <NSwitch size="small" :value="loop" @update:value="emit('configure', { media_loop: $event })" />
        </label>
      </div>
    </div>
  </section>
</template>
