<script setup lang="ts">
import { h, type Component } from 'vue'
import { NButton, NTooltip } from 'naive-ui'
import { AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Space, ArrowUp, ArrowDown } from '@lucide/vue'
import type { ArrangeAction } from './designer-arrange'
defineProps<{ count: number; canArrange: boolean; labels: Record<string, string> }>()
const emit = defineEmits<{ arrange: [action: ArrangeAction]; layer: [up: boolean] }>()
// Use the host's supported h() bridge; resolveDynamicComponent is not exported.
const ActionIcon = ({ icon }: { icon: Component }) => h(icon, { size: 18 })
const actions = [
  { key: 'left', icon: AlignStartVertical }, { key: 'center', icon: AlignCenterVertical }, { key: 'right', icon: AlignEndVertical },
  { key: 'top', icon: AlignStartHorizontal }, { key: 'middle', icon: AlignCenterHorizontal }, { key: 'bottom', icon: AlignEndHorizontal },
  { key: 'space-x', icon: Space }, { key: 'space-y', icon: Space },
] as const
</script>
<template>
  <div class="screen-selection-toolbar" role="group" :aria-label="labels.selection">
    <strong>{{ labels.selection }}</strong>
    <div class="selection-arrange-actions">
      <NTooltip v-for="action in actions" :key="action.key"><template #trigger><NButton size="small" quaternary :disabled="!canArrange || (action.key.startsWith('space-') && count < 3)" :aria-label="labels[action.key]" @click="emit('arrange', action.key)"><ActionIcon :icon="action.icon" :style="action.key === 'space-y' ? { transform: 'rotate(90deg)' } : undefined" /></NButton></template>{{ labels[action.key] }}</NTooltip>
      <NButton size="small" secondary :aria-label="labels.moveUp" @click="emit('layer', true)"><ArrowUp :size="16" />{{ labels.moveUp }}</NButton>
      <NButton size="small" secondary :aria-label="labels.moveDown" @click="emit('layer', false)"><ArrowDown :size="16" />{{ labels.moveDown }}</NButton>
    </div>
    <small>{{ canArrange ? labels.hint : labels.gridHint }}</small>
  </div>
</template>
