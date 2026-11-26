<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NSpin } from 'naive-ui'
import { ArrowLeft, ArrowRight, Circle, MousePointer2 } from '@lucide/vue'
import { translate, type MessageKey } from './i18n'
import type { PageHost } from './types'
import { remotePoint, type GesturePoint } from './remote-display'
import { useRemoteDisplay } from './useRemoteDisplay'

const props = defineProps<{ host: PageHost; locale: string }>()
// The extension UI v1 bridge exposes ref, but not Vue's newer useTemplateRef.
const canvas = ref<HTMLCanvasElement | null>(null)
const t = (key: MessageKey) => translate(props.locale, key)
const { frame, ready, busy, error, requested, send, connect, disconnect, retry } = useRemoteDisplay(props.host, (decoded) => {
  const surface = canvas.value
  if (!surface) return
  if (surface.width !== decoded.displayWidth) surface.width = decoded.displayWidth
  if (surface.height !== decoded.displayHeight) surface.height = decoded.displayHeight
  surface.getContext('2d')?.drawImage(decoded, 0, 0)
}, () => t('remoteUnsupported'))
const canTouch = computed(() => ready.value && frame.value?.controls.includes('touch'))
const canRotate = computed(() => ready.value && frame.value?.controls.includes('rotary'))
const canvasStyle = computed(() => ({ aspectRatio: `${frame.value?.width || 320} / ${frame.value?.height || 172}` }))
let gesture: { id: number; started: number; points: GesturePoint[] } | null = null

function cancelGesture() {
  gesture = null
}

function point(event: PointerEvent, time: number) {
  const rect = canvas.value!.getBoundingClientRect()
  return { ...remotePoint(event.clientX, event.clientY, rect, frame.value!.width, frame.value!.height), t: time }
}
function pointerDown(event: PointerEvent) {
  if (!canTouch.value || busy.value || gesture || event.button !== 0) return
  canvas.value!.setPointerCapture(event.pointerId)
  canvas.value!.focus()
  gesture = { id: event.pointerId, started: performance.now(), points: [point(event, 0)] }
}
function pointerMove(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId || gesture.points.length >= 62) return
  const time = Math.min(2900, Math.round(performance.now() - gesture.started))
  if (time - gesture.points[gesture.points.length - 1]!.t >= 16) gesture.points.push(point(event, time))
}
function pointerUp(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId) return
  const current = gesture
  gesture = null
  const duration = Math.max(64, Math.min(3000, Math.round(performance.now() - current.started)))
  current.points.push(point(event, Math.min(duration, 2900)))
  void send({ action: 'gesture', points: current.points, duration_ms: duration })
}
function keydown(event: KeyboardEvent) {
  if (event.repeat || !canRotate.value) return
  if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Enter', ' '].includes(event.key)) event.preventDefault()
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') void send({ action: 'rotate', steps: -1 })
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') void send({ action: 'rotate', steps: 1 })
  if (event.key === 'Enter' || event.key === ' ') void send({ action: 'press' })
}
</script>

<template>
  <section class="screen-remote" :aria-label="t('remoteTab')">
    <header class="section-head">
      <div><h1>{{ t('remoteTitle') }}</h1><p>{{ t('remoteHint') }}</p></div>
      <div class="remote-header-actions"><span class="remote-connection" :class="{ connected: ready }"><i />{{ t(!requested ? 'remoteDisconnected' : ready ? 'remoteLive' : 'remoteConnecting') }}</span><NButton v-if="requested" size="small" secondary @click="cancelGesture(); disconnect()">{{ t('remoteDisconnect') }}</NButton></div>
    </header>
    <NAlert v-if="error" type="error" :show-icon="false">
      <div class="remote-error"><span>{{ error }}</span><NButton size="small" @click="retry">{{ t('retry') }}</NButton></div>
    </NAlert>
    <div class="remote-workspace">
      <div class="remote-surface">
        <canvas ref="canvas" class="remote-canvas" :class="{ interactive: canTouch && !busy }" :style="canvasStyle" tabindex="0" :aria-label="t('remoteCanvas')" :aria-busy="busy"
          @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelGesture" @lostpointercapture="cancelGesture" @keydown="keydown" @contextmenu.prevent />
        <div v-if="!requested" class="remote-loading remote-idle"><p>{{ t('remoteManualHint') }}</p><NButton type="primary" @click="connect">{{ t('remoteConnect') }}</NButton></div>
        <div v-else-if="!ready && !error" class="remote-loading"><NSpin size="small" /><span>{{ t('remoteConnecting') }}</span></div>
      </div>
      <aside class="remote-controls">
        <div class="remote-control-heading"><MousePointer2 :size="18" /><strong>{{ t('remoteTouch') }}</strong></div>
        <p>{{ t('remoteTouchHint') }}</p>
        <template v-if="canRotate">
          <div class="remote-control-heading"><Circle :size="18" /><strong>{{ t('remoteRotary') }}</strong></div>
          <div class="remote-rotary-buttons">
            <NButton secondary :disabled="!ready || busy" :aria-label="t('remoteLeft')" @click="send({ action: 'rotate', steps: -1 })"><ArrowLeft :size="18" />{{ t('remoteLeft') }}</NButton>
            <NButton secondary :disabled="!ready || busy" :aria-label="t('remoteRight')" @click="send({ action: 'rotate', steps: 1 })"><ArrowRight :size="18" />{{ t('remoteRight') }}</NButton>
            <NButton secondary :disabled="!ready || busy" @click="send({ action: 'press' })">{{ t('remotePress') }}</NButton>
            <NButton secondary :disabled="!ready || busy" @click="send({ action: 'hold' })">{{ t('remoteHold') }}</NButton>
          </div>
          <p>{{ t('remoteKeys') }}</p>
        </template>
        <p v-if="frame?.width" class="remote-dimensions">{{ frame.width }} × {{ frame.height }}</p>
      </aside>
    </div>
  </section>
</template>
