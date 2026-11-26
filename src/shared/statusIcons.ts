import type { HomeStatusSource } from './homeWidgets'
import { STATUS_ICON_SIZE, statusIconMasks } from './statusIconMasks'

// Only the Web preview needs rectangles. Do not expand masks merely to import
// the badge geometry into the native Shell, which renders shared textures.
const runs: Partial<Record<HomeStatusSource, { x: number; y: number; width: number; opacity: number }[]>> = {}

/** Contain in a centered square, even when a saved component is wide or tall. */
export function statusIconRects(source: HomeStatusSource, width: number, height: number) {
  const iconRuns = runs[source] ??= statusIconMasks[source].flatMap((row, y) =>
    [...row.matchAll(/([1-9a-f])\1*/g)].map(run => ({
      x: run.index!, y, width: run[0].length, opacity: parseInt(run[1], 16) / 15,
    })))
  const unit = Math.min(width, height) / STATUS_ICON_SIZE
  const left = (width - STATUS_ICON_SIZE * unit) / 2
  const top = (height - STATUS_ICON_SIZE * unit) / 2
  return iconRuns.map(run => ({
    x: left + run.x * unit, y: top + run.y * unit,
    width: run.width * unit, height: unit, opacity: run.opacity,
  }))
}

/** The live icon carries a count only while there are active video sessions. */
export function statusIconBadge(source: HomeStatusSource, width: number, height: number, sessionCount: number) {
  if (source !== 'live' || !Number.isFinite(sessionCount) || sessionCount < 1) return null
  const count = Math.floor(sessionCount)
  const text = count > 99 ? '99+' : String(count)
  const badgeHeight = Math.min(16, height)
  const badgeWidth = Math.min(width, Math.max(badgeHeight, text.length * 7 + 4))
  const iconRight = (width + Math.min(width, height)) / 2
  return {
    text, x: Math.max(0, Math.min(width - badgeWidth, iconRight - 6)), y: 0,
    width: badgeWidth, height: badgeHeight, radius: badgeHeight / 2,
  }
}
