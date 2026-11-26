<script setup lang="ts">
import { computed } from 'vue'
import { DASHBOARD_CLOCK } from '../../src/shared/dashboard'
import type { HomeWidgetStatus } from '../../src/shared/homeWidgets'
import clock0 from './assets/clock-0.png'
import clock1 from './assets/clock-1.png'
import clock2 from './assets/clock-2.png'
import clock3 from './assets/clock-3.png'
import clock4 from './assets/clock-4.png'
import clock5 from './assets/clock-5.png'
import clock6 from './assets/clock-6.png'
import clock7 from './assets/clock-7.png'
import clock8 from './assets/clock-8.png'
import clock9 from './assets/clock-9.png'
import colon from './assets/clock-colon.png'
import ticks from './assets/ticks.png'

const props = defineProps<{
  faceId: string
  status: HomeWidgetStatus
  time: string
  period: string
  seconds: number
  date: string
  dial: 'ticks' | 'plain'
  panelWidth: number
  panelHeight: number
  x: number
  y: number
  scale: number
  selected: boolean
  layer: number
}>()
const images = [clock0, clock1, clock2, clock3, clock4, clock5, clock6, clock7, clock8, clock9, colon]
const effectiveScale = computed(() => props.scale * (props.faceId === 'screen-display/digital' ? 1.15 : 1))
const size = computed(() => Math.min(props.panelWidth, props.panelHeight) * effectiveScale.value)
const pip = computed(() => {
  const pipSize = Math.max(2, 6 * effectiveScale.value)
  const angle = props.seconds * Math.PI / 30
  const radius = size.value / 2 - 4 * effectiveScale.value
  return {
    width: `${pipSize}px`, height: `${pipSize}px`,
    left: `${size.value / 2 + radius * Math.sin(angle) - pipSize / 2}px`,
    top: `${size.value / 2 - radius * Math.cos(angle) - pipSize / 2}px`,
  }
})
const digits = computed(() => {
  const chars = props.time.split('')
  const widths = chars.map((char) => (char === ':' ? 19 : 34) * effectiveScale.value)
  const total = widths.reduce((sum, width) => sum + width, 0)
  let offset = 0
  return chars.map((char, index) => {
    const left = size.value / 2 - total / 2 + offset - (char === ':' ? 22 : 15) * effectiveScale.value
    offset += widths[index]
    return { src: images[char === ':' ? 10 : Number(char)], left }
  })
})
</script>

<template>
  <div v-if="faceId === 'screen-display/dashboard'" class="preview-dashboard-clock" :class="{ selected }" :style="{ left: `${x}%`, top: `${y}%`, width: `${DASHBOARD_CLOCK.width}px`, height: `${DASHBOARD_CLOCK.height}px`, fontSize: `${DASHBOARD_CLOCK.fontSize}px`, gap: `${DASHBOARD_CLOCK.periodGap}px`, transform: `translate(-50%, -50%) scale(${scale})`, zIndex: layer }">
    <span v-if="period" class="dashboard-clock-period">{{ period }}</span>
    <span class="dashboard-clock-time">{{ time }}</span>
  </div>
  <div v-else class="preview-clock" :class="{ selected }" :style="{ left: `${x}%`, top: `${y}%`, width: `${size}px`, height: `${size}px`, zIndex: layer }">
    <img v-if="dial === 'ticks'" class="clock-dial" :src="ticks" alt="" draggable="false" />
    <span v-if="dial === 'ticks'" class="clock-pip" :style="pip" aria-hidden="true" />
    <span class="clock-date" :style="{ top: `${size / 2 - (faceId === 'screen-display/flip' ? 56 : 38) * effectiveScale}px` }">{{ date }}</span>
    <div v-if="faceId === 'screen-display/flip'" class="flip-preview" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }">
      <div v-for="(digit, index) in time.replace(':', '').split('')" :key="index" class="flip-preview-digit" :class="{ minute: index === 2 }"><img :key="digit" :src="images[Number(digit)]" alt="" /><i /></div>
    </div>
    <img v-for="(digit, index) in (faceId === 'screen-display/flip' ? [] : digits)" :key="index" class="clock-digit" :src="digit.src" alt="" draggable="false" :style="{ left: `${digit.left}px`, top: `${size / 2 - 20 * effectiveScale}px`, width: `${64 * effectiveScale}px`, height: `${64 * effectiveScale}px` }" />
    <span v-if="period" class="clock-period" :style="{ left: `${size / 2 - (faceId === 'screen-display/flip' ? 114 : 91) * effectiveScale}px`, top: `${size / 2 + (faceId === 'screen-display/flip' ? 3 : 8) * effectiveScale}px`, fontSize: `${12 * effectiveScale}px`, lineHeight: `${12 * effectiveScale}px` }">{{ period }}</span>
  </div>
</template>
