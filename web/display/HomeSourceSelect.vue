<script setup lang="ts">
import { computed } from 'vue'
import { NSelect } from 'naive-ui'
import type { DisplayWidget } from './types'

const props = defineProps<{
  value: string
  homes: DisplayWidget[]
  labels: { title: string; designer: string; unavailable: string }
}>()
const emit = defineEmits<{ update: [value: string] }>()
const options = computed(() => [
  { label: props.labels.designer, value: '' },
  ...props.homes.map(home => ({ label: home.title, value: home.id })),
  ...(props.value && !props.homes.some(home => home.id === props.value)
    ? [{ label: `${props.labels.unavailable} (${props.value})`, value: props.value, disabled: true }]
    : []),
])
</script>

<template>
  <label>
    <span>{{ labels.title }}</span>
    <NSelect :value="value" :options="options" :aria-label="labels.title" @update:value="emit('update', $event)" />
  </label>
</template>
