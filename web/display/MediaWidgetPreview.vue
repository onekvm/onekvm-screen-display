<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { isCompressedVideo, mediaImageUrl, mediaVideoUrl, mediaFrameIndex, rgb565ToImageData, type MediaAsset } from './media-asset'
import type { MediaFit } from './types'

const props = withDefaults(defineProps<{
  asset?: MediaAsset
  fit?: MediaFit
  speed?: number
  loop?: boolean
  playing?: boolean
}>(), { fit: 'contain', speed: 1, loop: true, playing: true })
const canvas = shallowRef<HTMLCanvasElement | null>(null)
const video = shallowRef<HTMLVideoElement | null>(null)
let animation: number | null = null
let started = 0
let previous = -1
let images = new Map<number, ImageData>()
let generation = 0

function stop() {
  if (animation !== null) cancelAnimationFrame(animation)
  animation = null
}
function draw(timestamp: number) {
  const asset = props.asset
  const target = canvas.value
  if (!asset || !target) return
  const elapsed = props.playing ? (timestamp - started) * Math.max(0.25, Math.min(2, props.speed)) : 0
  const frame = mediaFrameIndex(asset.durations, elapsed, props.loop)
  if (frame !== previous) {
    let image = images.get(frame)
    if (!image) {
      image = rgb565ToImageData(asset.frames[frame], asset.width, asset.height) ?? undefined
      if (image) images.set(frame, image)
    }
    if (image) target.getContext('2d')?.putImageData(image, 0, 0)
    previous = frame
  }
  if (props.playing && asset.frames.length > 1 && (props.loop || elapsed < asset.durations.reduce((sum, duration) => sum + duration, 0)))
    animation = requestAnimationFrame(draw)
}
async function restart() {
  const current = ++generation
  stop()
  await nextTick()
  if (current !== generation) return
  images = new Map()
  previous = -1
  const target = canvas.value
  if (isCompressedVideo(props.asset)) {
    await nextTick()
    syncVideo()
    return
  }
  if (!target) return
  target.width = props.asset?.width ?? 1
  target.height = props.asset?.height ?? 1
  started = performance.now()
  draw(started)
}
function syncVideo() {
  const target = video.value
  if (!target || !isCompressedVideo(props.asset)) return
  target.playbackRate = Math.max(0.25, Math.min(2, props.speed))
  if (props.playing) void target.play().catch(() => {})
  else target.pause()
}
watch([() => props.asset, () => props.speed, () => props.loop, () => props.playing], () => { void restart(); syncVideo() })
onMounted(() => { void restart(); syncVideo() })
onBeforeUnmount(() => { generation++; stop(); images.clear() })
</script>

<template>
  <video
    v-if="isCompressedVideo(props.asset)"
    ref="video"
    class="media-widget-preview"
    :style="{ objectFit: props.fit }"
    :src="mediaVideoUrl(props.asset)"
    preload="metadata"
    :autoplay="props.playing"
    :loop="props.loop"
    :muted="true"
    playsinline
    aria-hidden="true"
  />
  <img v-else-if="props.asset?.original && props.asset.frames.length === 1" :src="mediaImageUrl(props.asset)" class="media-widget-preview" :style="{ objectFit: props.fit }" alt="" draggable="false">
  <canvas v-else ref="canvas" class="media-widget-preview" :style="{ objectFit: props.fit }" aria-hidden="true" />
</template>
