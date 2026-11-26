<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { ImagePlus, Upload } from '@lucide/vue'
import { NButton, NSpin } from 'naive-ui'

import {
  BackgroundImageError,
  encodeBackgroundImage,
  parseBackgroundImage,
} from './background-image'

interface Labels {
  title: string
  hint: string
  empty: string
  upload: string
  replace: string
  remove: string
  processing: string
  target: string
  invalid: string
  tooLarge: string
}

const props = defineProps<{
  value: string
  previewUrl: string
  targetWidth: number
  targetHeight: number
  labels: Labels
}>()

const emit = defineEmits<{
  'update:value': [value: string]
  error: [message: string]
}>()

const fileInput = shallowRef<HTMLInputElement | null>(null)
const processing = shallowRef(false)
const storedImage = computed(() => parseBackgroundImage(props.value))

function chooseFile() {
  fileInput.value?.click()
}

function clearImage() {
  emit('error', '')
  emit('update:value', '')
}

async function handleFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  processing.value = true
  emit('error', '')
  try {
    const encoded = await encodeBackgroundImage(file, props.targetWidth, props.targetHeight)
    emit('update:value', encoded)
  } catch (error) {
    emit('error', error instanceof BackgroundImageError && error.code === 'too-large'
      ? props.labels.tooLarge
      : props.labels.invalid)
  } finally {
    processing.value = false
  }
}
</script>

<template>
  <section class="background-image-control" :aria-label="props.labels.title">
    <div
      class="background-image-thumbnail"
      :class="{ empty: !props.previewUrl }"
      :style="{ aspectRatio: `${props.targetWidth} / ${props.targetHeight}` }"
    >
      <img
        v-if="props.previewUrl"
        :src="props.previewUrl"
        :alt="props.labels.title"
        :width="props.targetWidth"
        :height="props.targetHeight"
      >
      <div v-else class="background-image-empty">
        <ImagePlus :size="22" aria-hidden="true" />
        <span>{{ props.labels.empty }}</span>
      </div>
      <span v-if="storedImage" class="background-image-resolution">
        {{ storedImage.width }}×{{ storedImage.height }} · RGB565
      </span>
    </div>

    <div class="background-image-copy">
      <div>
        <strong>{{ props.labels.title }}</strong>
        <p>{{ props.labels.hint }}</p>
      </div>
      <div class="background-image-actions">
        <input
          ref="fileInput"
          class="background-file-input"
          type="file"
          accept="image/*"
          :aria-label="props.labels.upload"
          :disabled="processing"
          @change="handleFile"
        >
        <NButton size="small" secondary :disabled="processing" @click="chooseFile">
          <template #icon>
            <NSpin v-if="processing" :size="14" />
            <Upload v-else :size="15" />
          </template>
          {{ processing ? props.labels.processing : (storedImage ? props.labels.replace : props.labels.upload) }}
        </NButton>
        <NButton v-if="storedImage" size="small" quaternary type="error" :disabled="processing" @click="clearImage">
          {{ props.labels.remove }}
        </NButton>
      </div>
      <small>{{ props.labels.target }} · {{ props.targetWidth }}×{{ props.targetHeight }}</small>
    </div>
  </section>
</template>
