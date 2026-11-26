<script setup lang="ts">
import { NButton, NInputNumber, NTag, NText, NTooltip } from 'naive-ui'
import { AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, ArrowDown, ArrowUp, Trash2 } from '@lucide/vue'

export interface ScreenToolbarState {
  count: number
  name: string
  type: string
  x: number
  y: number
  scale: number
  maxScale: number
  showGeometry: boolean
  canPosition: boolean
  canScale: boolean
  canRemove: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}

defineProps<{ state: ScreenToolbarState; labels: Record<string, string> }>()
const emit = defineEmits<{
  update: [field: 'x' | 'y' | 'scale', value: number]
  action: [action: 'center-x' | 'center-y' | 'move-up' | 'move-down' | 'remove']
}>()

function update(field: 'x' | 'y' | 'scale', value: number | null) {
  if (value !== null) emit('update', field, value)
}
</script>

<template>
  <div class="screen-layer-toolbar">
    <NText v-if="!state.name" depth="3">{{ state.count ? labels.select : labels.empty }}</NText>
    <template v-else>
      <NTag size="small">{{ state.type }}</NTag>
      <strong class="screen-layer-toolbar-name" :title="state.name">{{ state.name }}</strong>
      <div v-if="state.showGeometry" class="screen-layer-toolbar-coordinates">
        <span>X</span>
        <NInputNumber size="small" :value="state.x" :min="0" :max="100" :show-button="false" :disabled="!state.canPosition" :input-props="{ 'aria-label': 'X' }" @update:value="update('x', $event)" />
        <span>Y</span>
        <NInputNumber size="small" :value="state.y" :min="0" :max="100" :show-button="false" :disabled="!state.canPosition" :input-props="{ 'aria-label': 'Y' }" @update:value="update('y', $event)" />
        <span>{{ labels.size }}</span>
        <NInputNumber size="small" :value="state.scale" :min="50" :max="state.maxScale" :step="5" :show-button="false" :disabled="!state.canScale" :input-props="{ 'aria-label': labels.size }" @update:value="update('scale', $event)" />
        <span>%</span>
      </div>
      <div class="screen-layer-toolbar-actions">
        <NTooltip v-if="state.showGeometry" trigger="hover"><template #trigger><NButton circle quaternary size="small" :disabled="!state.canPosition" :aria-label="labels.centerX" @click="emit('action', 'center-x')"><template #icon><AlignHorizontalJustifyCenter :size="16" /></template></NButton></template>{{ labels.centerX }}</NTooltip>
        <NTooltip v-if="state.showGeometry" trigger="hover"><template #trigger><NButton circle quaternary size="small" :disabled="!state.canPosition" :aria-label="labels.centerY" @click="emit('action', 'center-y')"><template #icon><AlignVerticalJustifyCenter :size="16" /></template></NButton></template>{{ labels.centerY }}</NTooltip>
        <NTooltip trigger="hover"><template #trigger><NButton circle quaternary size="small" :disabled="!state.canMoveDown" :aria-label="labels.moveDown" @click="emit('action', 'move-down')"><template #icon><ArrowDown :size="16" /></template></NButton></template>{{ labels.moveDown }}</NTooltip>
        <NTooltip trigger="hover"><template #trigger><NButton circle quaternary size="small" :disabled="!state.canMoveUp" :aria-label="labels.moveUp" @click="emit('action', 'move-up')"><template #icon><ArrowUp :size="16" /></template></NButton></template>{{ labels.moveUp }}</NTooltip>
        <NTooltip trigger="hover"><template #trigger><NButton circle quaternary size="small" type="error" :disabled="!state.canRemove" :aria-label="labels.remove" @click="emit('action', 'remove')"><template #icon><Trash2 :size="16" /></template></NButton></template>{{ labels.remove }}</NTooltip>
      </div>
    </template>
  </div>
</template>
