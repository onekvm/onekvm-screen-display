<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NModal } from 'naive-ui'
import MediaLibrary from './MediaLibrary.vue'
import MediaWidgetPreview from './MediaWidgetPreview.vue'
import type { MediaAssetLibrary } from './media-asset'
const props = withDefaults(defineProps<{
  value?: string
  library: MediaAssetLibrary
  usedIds: string[]
  title: string
  labels: Record<string, string>
  imagesOnly?: boolean
}>(), { imagesOnly: false })
const emit = defineEmits<{ select: [id: string | undefined]; update: [library: MediaAssetLibrary] }>()
const show = ref(false)
const asset = computed(() => props.value ? props.library.assets[props.value] : undefined)
function select(id: string) { emit('select', id); show.value = false }
</script>

<template>
  <section class="asset-selector" :aria-label="title">
    <div v-if="asset" class="asset-selector-preview"><MediaWidgetPreview :asset="asset" :playing="false" /></div>
    <div class="asset-selector-copy"><strong>{{ title }}</strong><small v-if="asset">{{ asset.name }}</small><small v-else>{{ labels.mediaEmpty }}</small></div>
    <NButton size="small" secondary @click="show = true">{{ labels.materialChoose }}</NButton>
    <NButton v-if="value" size="small" quaternary @click="emit('select', undefined)">{{ labels.mediaRemove }}</NButton>
    <NModal v-model:show="show" preset="card" :title="`${title} · ${labels.materialLibrary}`" style="width: min(760px, calc(100vw - 32px))">
      <MediaLibrary :library="library" :used-ids="usedIds" :labels="labels" selectable :images-only="imagesOnly" @select="select" @update="emit('update', $event)" />
    </NModal>
  </section>
</template>
