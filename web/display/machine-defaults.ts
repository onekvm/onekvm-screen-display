import { parseBackgroundImage } from './background-image'
import { parseMediaAssets, type MediaAssetLibrary } from './media-asset'
import { parseLayout, type ScreenLayout } from './types'

export interface MachineDefaults {
  layout: ScreenLayout
  backgroundImage: string
  mediaAssets: MediaAssetLibrary
}

export function parseMachineDefaults(raw: unknown): MachineDefaults | null {
  try {
    if (typeof raw !== 'string') return null
    const value = JSON.parse(raw)
    if (!value || typeof value.layout_json !== 'string' || !parseBackgroundImage(value.background_image)) return null
    return { layout: parseLayout(value.layout_json), backgroundImage: value.background_image, mediaAssets: parseMediaAssets(value.media_assets) }
  } catch { return null }
}

export function restoreMachineDefaults(defaults: MachineDefaults, library: MediaAssetLibrary) {
  return {
    layout: parseLayout(JSON.stringify(defaults.layout)),
    backgroundImage: defaults.backgroundImage,
    mediaAssets: { ...library, assets: { ...library.assets, ...defaults.mediaAssets.assets } },
  }
}
