import image from '../../src/shared/default-background.json'
import type { MediaAssetLibrary } from './media-asset'
export const DEFAULT_BACKGROUND_ID = 'screen-default-background'
export const DEFAULT_BACKGROUND_IMAGE = JSON.stringify(image)
export function withDefaultBackground(library: MediaAssetLibrary): MediaAssetLibrary {
  return { ...library, assets: { [DEFAULT_BACKGROUND_ID]: { v: 1, width: image.width, height: image.height,
    frames: [image.pixels], durations: [100], format: 'image', name: 'Apurv Das · Unsplash' }, ...library.assets } }
}
