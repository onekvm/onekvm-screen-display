<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { NButton, NInput } from 'naive-ui'
import { expandHomeWidgetTemplate, type HomeWidgetStatus } from '../../src/shared/homeWidgets'
import { translate, type MessageKey } from './i18n'

const props = defineProps<{ status: HomeWidgetStatus; locale: string }>()
const search = shallowRef('')
const feedback = shallowRef('')
const t = (key: MessageKey) => translate(props.locale, key)
const variables = [
  ['session_count', 'variableSessions'], ['ip', 'variableIp'], ['primary_ip', 'variablePrimaryIp'], ['hostname', 'variableHostname'],
  ['stream', 'variableStream'], ['video', 'variableVideo'], ['codec', 'variableCodec'],
  ['fps', 'variableFps'], ['resolution', 'variableResolution'], ['uptime', 'variableUptime'],
  ['machine', 'variableMachine'], ['version', 'variableVersion'], ['processor', 'variableProcessor'],
  ['kernel', 'variableKernel'], ['date', 'variableDate'],
  ['cpu_used', 'variableCpuUsed'], ['cpu_percent', 'variableCpuUsed'], ['cpu_value', 'variableCpuValue'],
  ['cpu_free', 'variableCpuFree'], ['cpu_available', 'variableCpuFree'],
  ['mem_used', 'variableMemUsed'], ['mem_free', 'variableMemFree'], ['mem_available', 'variableMemFree'], ['mem_percent', 'variableMemPercent'],
  ['disk_used', 'variableDiskUsed'], ['disk_free', 'variableDiskFree'], ['disk_available', 'variableDiskFree'], ['disk_percent', 'variableDiskPercent'],
] as const
const rows = computed(() => variables.map(([name, key]) => ({
  token: `{${name}}`, description: t(key), value: expandHomeWidgetTemplate(`{${name}}`, props.status),
})).filter(row => `${row.token} ${row.description}`.toLowerCase().includes(search.value.trim().toLowerCase())))
async function copy(token: string) {
  try {
    await navigator.clipboard.writeText(token)
    feedback.value = `${t('variableCopied')} ${token}`
  } catch { feedback.value = t('variableCopyFailed') }
}
</script>

<template>
  <section class="display-variables">
    <h2>{{ t('variablesTab') }}</h2>
    <p>{{ t('variablesHint') }}</p>
    <NInput v-model:value="search" :placeholder="t('variableSearch')" :aria-label="t('variableSearch')" clearable />
    <p class="variable-feedback" role="status" aria-live="polite">{{ feedback }}</p>
    <div class="variables-scroll">
      <table>
        <thead><tr><th scope="col">{{ t('variableName') }}</th><th scope="col">{{ t('variableMeaning') }}</th><th scope="col">{{ t('variableValue') }}</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.token">
            <td><NButton size="small" text :title="t('variableCopy')" @click="copy(row.token)"><code>{{ row.token }}</code></NButton></td>
            <td>{{ row.description }}</td><td class="variable-value">{{ row.value }}</td>
          </tr>
          <tr v-if="!rows.length"><td colspan="3">{{ t('variableEmpty') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
