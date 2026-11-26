<script setup lang="ts">
import { computed } from 'vue'
import type { DebugNode } from './useScreenDevtools'
import { debugTreeRows } from './debug-tree'

const props = defineProps<{ root: DebugNode | null; label: string; empty: string; disabled: boolean }>()
const emit = defineEmits<{ inspect: [id: number] }>()
const rows = computed(() => debugTreeRows(props.root))
</script>

<template>
  <div class="debug-tree" :aria-label="label">
    <p v-if="!rows.length" class="debug-empty">{{ empty }}</p>
    <button v-for="row in rows" :key="row.key" class="debug-node" :style="{ paddingLeft: `${12 + Math.min(row.depth, 16) * 12}px` }" :disabled="disabled || !row.inspectId" @click="emit('inspect', row.inspectId)">
      <span class="debug-node-type">{{ row.node.n || row.node.t }}</span><span class="debug-node-id">#{{ row.node.i }}</span><span class="debug-node-text">{{ row.node.x || row.node.c }}</span>
    </button>
  </div>
</template>
