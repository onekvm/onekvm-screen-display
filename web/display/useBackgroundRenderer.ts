import { onBeforeUnmount, ref } from 'vue'
import { backgroundFill, cropBackgroundImage, cropGeometry, type BackgroundCrop } from './background-crop'
import { rgbaToRgb565, serializeBackgroundImage } from './background-image'
import { mediaImageUrl, type MediaAsset } from './media-asset'

/** Keep at most the selected original decoded, and discard stale async crops. */
export function useBackgroundRenderer(commit: (raw: string) => void) {
  const pending = ref(false)
  const error = ref(false)
  let generation = 0
  let cached: { url: string; image: Promise<HTMLImageElement> } | undefined

  function cancel() {
    generation++
    pending.value = false
    error.value = false
  }

  async function render(raw: string, asset: MediaAsset | undefined, width: number, height: number, crop: BackgroundCrop, background = '#000000') {
    const current = ++generation
    pending.value = true
    error.value = false
    try {
      const url = mediaImageUrl(asset)
      let output = ''
      if (url) {
        if (cached?.url !== url) {
          cached = { url, image: new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.onerror = () => reject(new Error('Unable to load original image'))
            image.src = url
          }) }
        }
        const image = await cached.image
        if (current !== generation) return
        const region = cropGeometry({ width: image.naturalWidth, height: image.naturalHeight }, { width, height }, crop)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Unable to create image surface')
        context.fillStyle = backgroundFill(background)
        context.fillRect(0, 0, width, height)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, width, height)
        output = serializeBackgroundImage(width, height, rgbaToRgb565(context.getImageData(0, 0, width, height)))
      } else {
        cached = undefined
        output = raw ? cropBackgroundImage(raw, width, height, crop, background) : ''
      }
      if (current === generation) commit(output)
    } catch {
      if (current === generation) { error.value = true; cached = undefined }
    } finally {
      if (current === generation) pending.value = false
    }
  }

  onBeforeUnmount(() => { cancel(); cached = undefined })
  return { render, cancel, pending, error }
}
