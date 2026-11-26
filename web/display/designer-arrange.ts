export interface SelectionGesture { toggle?: boolean; range?: boolean; preserve?: boolean }
export interface DesignBox { id: string; x: number; y: number; width: number; height: number }
export type ArrangeAction = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'space-x' | 'space-y'

/** Positions and dimensions are in panel pixels; x/y denote the center. */
export function arrangeBoxes(boxes: readonly DesignBox[], action: ArrangeAction): DesignBox[] {
  if (boxes.length < (action.startsWith('space-') ? 3 : 2)) return [...boxes]
  const horizontal = ['left', 'center', 'right', 'space-x'].includes(action)
  const axis = horizontal ? 'x' : 'y'
  const size = horizontal ? 'width' : 'height'
  const start = Math.min(...boxes.map(b => b[axis] - b[size] / 2))
  const end = Math.max(...boxes.map(b => b[axis] + b[size] / 2))
  if (action.startsWith('space-')) {
    const sorted = [...boxes].sort((a, b) => a[axis] - b[axis])
    // Keep the two end objects fixed, even when a larger middle object overlaps them.
    const first = sorted[0]!, last = sorted[sorted.length - 1]!
    const edge = first[axis] - first[size] / 2
    const span = last[axis] + last[size] / 2 - edge
    const gap = (span - sorted.reduce((sum, b) => sum + b[size], 0)) / (sorted.length - 1)
    let cursor = edge
    const positions = new Map(sorted.map(b => {
      const position = cursor + b[size] / 2
      cursor += b[size] + gap
      return [b.id, position]
    }))
    return boxes.map(b => ({ ...b, [axis]: positions.get(b.id)! }))
  }
  return boxes.map(b => ({ ...b, [axis]: action === 'left' || action === 'top' ? start + b[size] / 2
    : action === 'right' || action === 'bottom' ? end - b[size] / 2 : (start + end) / 2 }))
}

export function moveLayerGroup(order: readonly string[], selected: readonly string[], target: string, before: boolean): string[] {
  const chosen = new Set(selected)
  if (chosen.has(target) || !order.includes(target)) return [...order]
  const group = order.filter(id => chosen.has(id))
  const rest = order.filter(id => !chosen.has(id))
  rest.splice(rest.indexOf(target) + (before ? 0 : 1), 0, ...group)
  return rest
}

/** Move every selected block one layer, retaining relative order. Order is front-to-back. */
export function stepLayerGroup(order: readonly string[], selected: readonly string[], up: boolean): string[] {
  const next = [...order], chosen = new Set(selected)
  if (up) {
    for (let i = 1; i < next.length; i++) if (chosen.has(next[i]!) && !chosen.has(next[i - 1]!))
      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
  } else {
    for (let i = next.length - 2; i >= 0; i--) if (chosen.has(next[i]!) && !chosen.has(next[i + 1]!))
      [next[i], next[i + 1]] = [next[i + 1]!, next[i]!]
  }
  return next
}
