<script setup lang="ts">
import { computed } from 'vue'
import type { HomeWidgetStatus } from '../../src/shared/homeWidgets'
const props = defineProps<{ time: string; date: string; status: HomeWidgetStatus; width: number; height: number }>()
const flags = computed(() => [
  { name: 'ETH', on: props.status.ethernetConnected }, { name: 'HDMI', on: props.status.hdmiConnected },
  { name: 'USB', on: props.status.hidConnected }, { name: 'LIVE', on: props.status.active },
])
const style = computed(() => ({ padding: props.width < 260 ? '35px 24px 24px' : '9px 12px 14px' }))
</script>
<template>
  <div class="dashboard-preview" :style="style">
    <div class="dashboard-heading"><strong>OneKVM</strong><b>{{ time }}</b></div>
    <div class="dashboard-flags"><span v-for="flag in flags" :key="flag.name" :class="{ on: flag.on }">{{ flag.name }}</span></div>
    <div class="dashboard-body">
      <div class="dashboard-info"><small>IP ADDRESS</small><strong>{{ status.ip || '--.--.--.--' }}</strong><span>{{ status.hostname || 'OneKVM' }}</span><b>{{ status.resolution || (status.hdmiConnected ? 'HDMI CONNECTED' : 'NO SIGNAL') }} <template v-if="status.active && status.fps">{{ status.fps }} FPS</template></b></div>
      <div class="dashboard-cpu"><small>CPU %</small><strong>{{ status.cpuPercent === null ? '--' : Math.round(status.cpuPercent) }}</strong><i><em :style="{ width: `${status.cpuPercent || 0}%` }" /></i><span>{{ date }}</span></div>
    </div>
  </div>
</template>
