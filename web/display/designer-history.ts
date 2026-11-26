export function createDesignerHistory<T>(initial: T, equal: (a: T, b: T) => boolean, limit = 100) {
  let current = initial
  const past: T[] = []
  const future: T[] = []
  return {
    get canUndo() { return past.length > 0 },
    get canRedo() { return future.length > 0 },
    reset(value: T) { current = value; past.length = 0; future.length = 0 },
    record(value: T, merge = false) {
      if (equal(current, value)) return false
      if (!merge) {
        past.push(current)
        if (past.length > limit) past.shift()
      }
      current = value
      future.length = 0
      return true
    },
    undo() {
      if (!past.length) return undefined
      future.push(current)
      current = past.pop()!
      return current
    },
    redo() {
      if (!future.length) return undefined
      past.push(current)
      current = future.pop()!
      return current
    },
  }
}
