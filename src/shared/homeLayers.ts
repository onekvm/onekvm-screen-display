export const CLOCK_WIDGET_ID = 'clock'

// Saved order is back to front. Keep placement order separate so changing
// depth cannot move grid cells or change a native media surface's slot.
export function homeLayerOrder(widgetIds: readonly string[], saved: unknown): string[] {
  const defaults = [...new Set([CLOCK_WIDGET_ID, ...widgetIds])]
  const available = new Set(defaults)
  const order: string[] = []
  for (const id of Array.isArray(saved) ? saved : []) {
    if (typeof id === 'string' && available.delete(id)) order.push(id)
  }
  if (available.delete(CLOCK_WIDGET_ID)) order.unshift(CLOCK_WIDGET_ID)
  return [...order, ...defaults.filter(id => available.has(id))]
}
