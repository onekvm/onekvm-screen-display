<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { Eye, EyeOff, GripVertical } from '@lucide/vue'
import { moveLayerGroup, type SelectionGesture } from './designer-arrange'
import AppIcon from './AppIcon.vue'
import { useListReorderMotion } from './useListReorderMotion'

export interface WidgetListItem {
  id: string
  name: string
  type: string
  icon: string
  accent: string
  hidden: boolean
  pinned: boolean
  selected: boolean
  preview?: string
}

const props = defineProps<{ items: WidgetListItem[]; labels: Record<string, string> }>()
const emit = defineEmits<{
  select: [id: string, gesture?: SelectionGesture]
  toggle: [id: string]
  reorder: [source: string, target: string, before: boolean]
}>()

const dragging = shallowRef('')
const dropTarget = shallowRef<{ id: string; before: boolean } | null>(null)
let slots: { id: string; center: number; pinned: boolean }[] = []
let listElement: HTMLElement | null = null

const previewItems = computed(() => {
  const target = dropTarget.value
  if (!dragging.value || !target) return props.items
  const selected = props.items.find(item => item.id === dragging.value)?.selected
    ? props.items.filter(item => item.selected).map(item => item.id) : [dragging.value]
  const byId = new Map(props.items.map(item => [item.id, item]))
  return moveLayerGroup(props.items.map(item => item.id), selected, target.id, target.before).map(id => byId.get(id)!)
})
useListReorderMotion(previewItems, () => listElement, '[data-widget-id]')

function dragEnd() {
  dragging.value = ''
  dropTarget.value = null
  slots = []
}

function dragStart(item: WidgetListItem, event: DragEvent) {
  if (item.pinned)
    return
  const row = event.currentTarget as HTMLElement
  const list = row.parentElement!
  listElement = list
  // Hit-test the original slots so animated rows cannot move the drop target.
  slots = Array.from(list.querySelectorAll<HTMLElement>('[data-widget-id]')).map(row => ({
    id: row.dataset.widgetId!,
    center: row.offsetTop + row.offsetHeight / 2 + list.clientTop - list.scrollTop,
    pinned: row.classList.contains('pinned'),
  }))
  emit('select', item.id, { preserve: true })
  dragging.value = item.id
  dropTarget.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }
}

function dragOver(event: DragEvent) {
  if (!dragging.value || !slots.length)
    return
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move'
  const y = event.clientY - (event.currentTarget as HTMLElement).getBoundingClientRect().top
  const slot = slots.reduce((best, slot) => Math.abs(slot.center - y) < Math.abs(best.center - y) ? slot : best)
  dropTarget.value = slot.pinned ? null : { id: slot.id, before: y < slot.center }
}

function drop(event: DragEvent) {
  dragOver(event)
  const target = dropTarget.value
  if (dragging.value && target && dragging.value !== target.id)
    emit('reorder', dragging.value, target.id, target.before)
  dragEnd()
}
</script>

<template>
  <ul v-if="props.items.length" class="widget-list" @dragover="dragOver" @drop="drop">
    <li
      v-for="item in previewItems"
      :key="item.id"
      class="widget-list-row"
      :class="{ selected: item.selected, pinned: item.pinned, hidden: item.hidden, 'is-dragging': dragging === item.id }"
      :data-widget-id="item.id"
      :draggable="!item.pinned"
      @dragstart="dragStart(item, $event)"
      @dragend="dragEnd"
    >
      <input class="widget-list-check" type="checkbox" :checked="item.selected" :aria-label="`${labels.selectWidget}: ${item.name}`" @click.stop @change="emit('select', item.id, { toggle: true })" />
      <button
        type="button"
        class="widget-list-eye"
        :disabled="item.pinned"
        :aria-label="item.hidden ? labels.showWidget : labels.hideWidget"
        @click.stop="emit('toggle', item.id)"
      >
        <EyeOff v-if="item.hidden" :size="17" aria-hidden="true" />
        <Eye v-else :size="17" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="widget-list-content"
        :aria-pressed="item.selected"
        @click="emit('select', item.id, { toggle: $event.ctrlKey || $event.metaKey, range: $event.shiftKey })"
      >
        <span class="widget-list-thumbnail" :class="{ 'is-clock': item.pinned }" :style="{ '--thumbnail-accent': item.accent }" aria-hidden="true">
          <span v-if="item.pinned" class="widget-list-clock"><i /><b>12</b></span>
          <span v-else-if="item.preview" class="widget-list-preview">{{ item.preview }}</span>
          <AppIcon v-else :name="item.icon || item.id" :accent="item.accent" />
        </span>
        <div class="widget-list-info">
          <strong>{{ item.name }}</strong>
          <small>{{ labels[item.type] || item.type }}</small>
        </div>
      </button>
      <GripVertical v-if="!item.pinned" class="widget-list-grip" :size="16" aria-hidden="true" />
    </li>
  </ul>
  <p v-else class="widget-list-empty">{{ labels.empty }}</p>
</template>
