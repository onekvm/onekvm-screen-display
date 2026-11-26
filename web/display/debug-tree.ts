import type { DebugNode } from './useScreenDevtools'

export interface DebugTreeRow { node: DebugNode; depth: number; key: number; inspectId: number }

export function debugTreeRows(root: DebugNode | null): DebugTreeRow[] {
  const result: DebugTreeRow[] = []
  const pending = root ? [{ node: root, depth: 0, parent: 0 }] : []
  while (pending.length && result.length < 2000) {
    const item = pending.pop()!
    // Vapor's #text leaf is folded into the enclosing native Text layout.
    const inspectId = item.node.v ? 0 : item.node.t === '#text' ? item.parent : item.node.i
    result.push({ ...item, key: result.length, inspectId })
    if (item.depth < 64) for (const node of [...(item.node.k || [])].reverse()) {
      pending.push({ node, depth: item.depth + 1, parent: inspectId || item.parent })
    }
  }
  return result
}
