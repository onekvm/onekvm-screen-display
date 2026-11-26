<script setup lang="ts">
import { nextTick, ref, shallowRef, watch } from 'vue'
import { NButton, NInput } from 'naive-ui'
import type { ConsoleLine } from './useScreenDevtools'
const props = defineProps<{ lines: ConsoleLine[]; disabled: boolean; label: string; placeholder: string; run: string }>()
const emit = defineEmits<{ evaluate: [code: string] }>()
const code = shallowRef('')
const output = ref<HTMLElement | null>(null)
watch(() => props.lines, async () => { await nextTick(); output.value?.scrollTo(0, output.value.scrollHeight) })
function submit() { if (!props.disabled && code.value.trim()) { emit('evaluate', code.value); code.value = '' } }
</script>
<template>
  <div class="debug-console">
    <div ref="output" class="debug-output" role="log" :aria-label="label"><div v-for="line in lines" :key="line.key" class="debug-line" :class="{ 'debug-error': line.level === 'error', 'debug-input': line.level === 'input' }">{{ line.text }}</div></div>
    <form class="debug-repl" @submit.prevent="submit"><NInput v-model:value="code" :maxlength="4096" :disabled="disabled" :placeholder="placeholder" :aria-label="placeholder" /><NButton attr-type="submit" :disabled="disabled || !code.trim()">{{ run }}</NButton></form>
  </div>
</template>
