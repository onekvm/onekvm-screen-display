<script setup lang="ts">
import { NSelect } from 'naive-ui'
import type { ClockFormat } from '../../src/shared/clockFormat'

defineProps<{
  value: string
  format: ClockFormat
  options: { label: string; value: string }[]
  labels: Record<string, string>
}>()

const emit = defineEmits<{
  update: [value: string]
  updateFormat: [value: ClockFormat]
}>()
</script>

<template>
  <section class="home-widget-inspector clock-widget-inspector" :aria-label="labels.clockSettings">
    <header>
      <h3>{{ labels.clockSettings }}</h3>
      <p>{{ labels.clockHint }}</p>
    </header>
    <div class="home-widget-fields">
      <label class="home-widget-field home-widget-field-wide">
        <span>{{ labels.clockStyle }}</span>
        <NSelect :value="value" :options="options" @update:value="emit('update', String($event))" />
      </label>
      <label class="home-widget-field home-widget-field-wide">
        <span>{{ labels.clockFormat }}</span>
        <NSelect :value="format" :options="[{ label: labels.clock12Hour, value: '12h' }, { label: labels.clock24Hour, value: '24h' }]" @update:value="emit('updateFormat', $event)" />
      </label>
    </div>
  </section>
</template>
