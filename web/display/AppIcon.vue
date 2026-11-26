<script setup lang="ts">
import { computed, inject, type Component } from 'vue'

import { appIconAssetsKey } from './icon-assets'

const assets = inject(appIconAssetsKey, undefined)
const source = computed(() => assets?.value[props.name])

const props = defineProps<{
  name: string
  accent?: string
}>()

const LUCIDE_BY_WIDGET: Record<string, string> = {
  settings: 'Settings',
  hdmi: 'HdmiPort',
  usb: 'Usb',
  net: 'Network',
  stream: 'MonitorPlay',
  stick: 'Pointer',
  clock: 'Clock',
  power: 'Zap',
  services: 'Settings',
  security: 'ShieldCheck',
}

const Icon = computed<Component | undefined>(() => {
  const icons = window.OneKVMPluginUI?.v1.icons
  if (!icons)
    return undefined
  const key = LUCIDE_BY_WIDGET[props.name.replace(/\.png$/, '')] ?? 'Circle'
  return (icons[key] ?? icons.Circle) as Component | undefined
})
</script>

<template>
  <img v-if="source" class="app-icon" :src="source" width="22" height="22" alt="" aria-hidden="true">
  <Icon
    v-else-if="Icon"
    class="app-icon"
    :size="22"
    :color="accent || 'currentColor'"
    :stroke-width="1.8"
    aria-hidden="true"
  />
</template>
