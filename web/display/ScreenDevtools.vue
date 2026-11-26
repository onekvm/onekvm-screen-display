<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NButton, NSelect, NSwitch } from 'naive-ui'
import type { PageHost } from './types'
import { translate, type MessageKey } from './i18n'
import { useScreenDevtools } from './useScreenDevtools'
import DebugTree from './DebugTree.vue'
import DebugConsole from './DebugConsole.vue'
import RemoteDisplay from './RemoteDisplay.vue'

const props = defineProps<{ host: PageHost; locale: string }>()
const t = (key: MessageKey) => translate(props.locale, key)
const { enabled, busy, error, targets, selected, target, tree, lines, paused, frame, dropped, mode, command, reload, evaluate, clear } = useScreenDevtools(props.host)
const options = computed(() => targets.value.map(item => ({ label: `${item.app} · ${item.instance}`, value: item.id })))
const disabled = computed(() => !enabled.value || !target.value)
</script>

<template>
  <section class="screen-devtools">
    <header class="section-head">
      <div><h1>{{ t('devTitle') }}</h1><p>{{ t('devHint') }}</p></div>
      <label class="dev-switch"><span>{{ t('devMode') }}</span><NSwitch :value="enabled" :loading="busy" :disabled="busy" @update:value="mode" /></label>
    </header>
    <NAlert v-if="error" type="error" :show-icon="false">{{ error }}</NAlert>
    <p class="dev-note">{{ t('devLease') }}</p>
    <template v-if="enabled">
      <div class="dev-toolbar">
        <NSelect v-model:value="selected" class="dev-target" :options="options" :placeholder="t('devSelect')" :aria-label="t('devSelect')" />
        <NButton :disabled="disabled" @click="command({ t: paused ? 'resume' : 'pause' })">{{ t(paused ? 'devResume' : 'devPause') }}</NButton>
        <NButton :disabled="disabled || !paused" @click="command({ t: 'step', n: 1 })">{{ t('devStep') }}</NButton>
        <NButton secondary @click="reload">{{ t('devReload') }}</NButton>
        <span v-if="target" class="dev-state">{{ target.role }} · {{ t(paused ? 'devPaused' : 'devRunning') }} · {{ frame }}</span>
      </div>
      <NAlert v-if="!targets.length" type="info" :show-icon="false">{{ t('devNoTargets') }}</NAlert>
      <div class="dev-panels">
        <section class="dev-panel">
          <header class="dev-panel-head"><strong>{{ t('devTree') }}</strong><div class="dev-actions"><NButton size="tiny" quaternary :disabled="disabled" @click="command({ t: 'inspect', id: 0 })">{{ t('devUnhighlight') }}</NButton><NButton size="tiny" secondary :disabled="disabled" @click="command({ t: 'getTree' })">{{ t('devRefresh') }}</NButton></div></header>
          <DebugTree :root="tree" :label="t('devTree')" :empty="t('devTreeEmpty')" :disabled="disabled" @inspect="command({ t: 'inspect', id: $event })" />
        </section>
        <section class="dev-panel">
          <header class="dev-panel-head"><strong>{{ t('devConsole') }}</strong><NButton size="tiny" quaternary @click="clear">{{ t('devClear') }}</NButton></header>
          <DebugConsole :lines="lines" :disabled="disabled" :label="t('devConsole')" :placeholder="t('devExpression')" :run="t('devRun')" @evaluate="evaluate" />
        </section>
      </div>
      <p v-if="dropped" class="dev-note">{{ t('devDropped') }} {{ dropped }}</p>
      <RemoteDisplay :host="host" :locale="locale" />
    </template>
  </section>
</template>
