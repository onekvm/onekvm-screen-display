<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { NAlert, NButton, NInput, NPopconfirm } from 'naive-ui'
import { Upload } from '@lucide/vue'
import MediaWidgetPreview from './MediaWidgetPreview.vue'
import { importMediaFile, isCompressedVideo, mediaAssetDimensions, mediaAssetDurationMs, mediaAssetStorageBytes, MediaAssetError, type MediaAssetLibrary } from './media-asset'

const props = withDefaults(defineProps<{
  library: MediaAssetLibrary
  usedIds: string[]
  labels: Record<string, string>
  selectable?: boolean
  imagesOnly?: boolean
}>(), { selectable: false, imagesOnly: false })
const emit = defineEmits<{ update: [library: MediaAssetLibrary]; select: [id: string] }>()
const input = shallowRef<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref('')
const search = ref('')
let controller: AbortController | undefined
onBeforeUnmount(() => controller?.abort())
const items = computed(() => Object.entries(props.library.assets).filter(([_, asset]) =>
  (!props.imagesOnly || (!isCompressedVideo(asset) && asset.frames.length === 1)) && asset.name.toLowerCase().includes(search.value.trim().toLowerCase())))
const usedBytes = computed(() => Object.values(props.library.assets).reduce((sum, asset) => sum + mediaAssetStorageBytes(asset), 0))
async function upload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  busy.value = true
  error.value = ''
  try {
    controller = new AbortController()
    const asset = await importMediaFile(file, controller.signal)
    if (controller.signal.aborted) return
    if (props.imagesOnly && (isCompressedVideo(asset) || asset.frames.length > 1)) { error.value = props.labels.materialStillOnly; return }
    const id = `asset-${crypto.randomUUID()}`
    const next: MediaAssetLibrary = { v: 1, assets: { ...props.library.assets, [id]: asset } }
    emit('update', next)
  } catch (reason) {
    const code = reason instanceof MediaAssetError ? reason.code : 'invalid'
    error.value = props.labels[code === 'too-large' ? 'mediaTooLarge' : code === 'unsupported' ? 'mediaUnsupported' : 'mediaInvalid']
  } finally { busy.value = false }
}
function remove(id: string) {
  if (props.usedIds.includes(id)) return
  const assets = { ...props.library.assets }
  delete assets[id]
  emit('update', { v: 1, assets })
}
</script>

<template>
  <section class="screen-media-library" :aria-label="labels.materialLibrary">
    <div class="library-toolbar">
      <NInput v-model:value="search" :placeholder="labels.materialSearch" :aria-label="labels.materialSearch" clearable />
      <input ref="input" type="file" class="background-file-input" hidden :disabled="busy" :aria-label="labels.mediaUpload" :accept="imagesOnly ? 'image/png,image/jpeg,image/bmp,image/avif,image/webp,.png,.jpg,.jpeg,.bmp,.avif,.webp' : 'image/*,video/mp4,video/h264,.h264,.264,.mp4,.m4v'" @change="upload">
      <NButton secondary :loading="busy" :disabled="busy" @click="input?.click()">
        <template #icon><Upload :size="16" /></template>
        {{ busy ? labels.mediaProcessing : labels.mediaUpload }}
      </NButton>
    </div>
    <p class="library-hint">{{ labels.materialHint }}</p>
    <p class="library-hint">{{ (usedBytes / 1_000_000).toFixed(1) }} MB · {{ labels.materialSaveHint }}</p>
    <NAlert v-if="error" type="error" :show-icon="false">{{ error }}</NAlert>
    <p v-if="!items.length" class="library-empty">{{ labels.materialEmpty }}</p>
    <div v-else class="library-grid">
      <article v-for="[id, asset] in items" :key="id" class="library-asset">
        <button type="button" class="library-thumbnail" :disabled="!selectable || busy" :aria-label="asset.name" @click="emit('select', id)">
          <MediaWidgetPreview :asset="asset" :playing="false" />
        </button>
        <strong :title="asset.name">{{ asset.name }}</strong>
        <small>{{ mediaAssetDimensions(asset).width }}×{{ mediaAssetDimensions(asset).height }} · <template v-if="isCompressedVideo(asset)">{{ (mediaAssetDurationMs(asset) / 1000).toFixed(1) }} s</template><template v-else>{{ asset.frames.length }} {{ labels.mediaFrames }}<template v-if="asset.frames.length > 1"> · {{ Math.round(asset.frames.length * 1000 / asset.durations.reduce((a, b) => a + b, 0)) }} FPS</template></template></small>
        <div class="library-asset-actions">
          <NButton v-if="selectable" size="small" secondary :disabled="busy" @click="emit('select', id)">{{ labels.materialChoose }}</NButton>
          <small v-if="usedIds.includes(id)">{{ labels.materialInUse }}</small>
          <NPopconfirm v-else @positive-click="remove(id)">
            <template #trigger><NButton size="small" quaternary type="error" :disabled="busy">{{ labels.materialDelete }}</NButton></template>
            {{ labels.materialDeleteConfirm }}
          </NPopconfirm>
        </div>
      </article>
    </div>
  </section>
</template>
