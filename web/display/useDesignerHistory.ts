import { computed, shallowRef, watch } from 'vue'
import { createDesignerHistory } from './designer-history'

export function useDesignerHistory<T>(read: () => T, write: (value: T) => void, equal: (a: T, b: T) => boolean, paused: () => boolean = () => false) {
  const history = createDesignerHistory(read(), equal)
  const revision = shallowRef(0)
  let restoring = false
  let merging = false
  let dragging = false
  let timer: ReturnType<typeof setTimeout> | undefined
  function boundary() { merging = false; clearTimeout(timer) }
  watch(() => ({ value: read(), paused: paused() }), ({ value, paused }) => {
    if (restoring || paused || !history.record(value, merging)) return
    merging = true
    revision.value++
    clearTimeout(timer)
    if (!dragging) timer = setTimeout(boundary, 700)
  }, { flush: 'sync' })
  function restore(action: 'undo' | 'redo') {
    boundary()
    const value = history[action]()
    if (value === undefined) return
    restoring = true
    try { write(value) } finally { restoring = false }
    revision.value++
  }
  return {
    canUndo: computed(() => { revision.value; return history.canUndo }),
    canRedo: computed(() => { revision.value; return history.canRedo }),
    undo: () => restore('undo'),
    redo: () => restore('redo'),
    reset() { boundary(); history.reset(read()); revision.value++ },
    boundary,
    dispose() { clearTimeout(timer) },
    pointerDown() { boundary(); dragging = true },
    pointerUp() { dragging = false; queueMicrotask(boundary) },
  }
}
