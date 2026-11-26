import { MAX_HOME_WIDGET_HEIGHT, MAX_HOME_WIDGET_WIDTH } from '../../src/shared/homeWidgets'
import type { HomeWidgetPlacement, PlacementMode } from './types'

export interface WidgetResizeStart {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

export interface ResizeViewport {
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Resize from the lower right; free layouts retain the upper-left corner. */
export function resizeHomeWidget(
  start: WidgetResizeStart,
  delta: { x: number; y: number },
  panel: ResizeViewport,
  viewport: ResizeViewport,
  mode: PlacementMode,
): Partial<HomeWidgetPlacement> {
  if (viewport.width <= 0 || viewport.height <= 0 || panel.width <= 0 || panel.height <= 0 || start.scale <= 0)
    return {}
  const factor = mode === 'grid' ? 2 : 1
  const width = clamp(Math.round(start.width + delta.x * panel.width / viewport.width / start.scale * factor), 2, Math.min(MAX_HOME_WIDGET_WIDTH, panel.width))
  const height = clamp(Math.round(start.height + delta.y * panel.height / viewport.height / start.scale * factor), 1, Math.min(MAX_HOME_WIDGET_HEIGHT, panel.height))
  if (mode === 'grid') return { width, height }
  return {
    width,
    height,
    x: clamp(start.x + (width - start.width) * start.scale / panel.width * 50, 0, 100),
    y: clamp(start.y + (height - start.height) * start.scale / panel.height * 50, 0, 100),
  }
}
