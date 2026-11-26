import { computed, onMounted, ref, watch } from 'vue'
import type { SelectionGesture } from './designer-arrange'

export function useDesignerSelection(order: () => string[], initial: string) {
  const selectedIds = ref<string[]>([initial])
  let anchor = initial
  const selectedId = computed({
    get: () => selectedIds.value[selectedIds.value.length - 1] || '',
    set: (id: string) => { selectedIds.value = id ? [id] : []; anchor = id },
  })
  function select(id: string, gesture: SelectionGesture = {}) {
    const ids = order()
    if (gesture.range && ids.includes(anchor)) {
      const a = ids.indexOf(anchor), b = ids.indexOf(id)
      if (b >= 0) selectedIds.value = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
    } else if (gesture.toggle) {
      selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(value => value !== id) : [...selectedIds.value, id]
      anchor = id
    } else if (!(gesture.preserve && selectedIds.value.includes(id))) selectedId.value = id
  }
  onMounted(() => { watch(order, ids => {
    const next = selectedIds.value.filter(id => ids.includes(id))
    if (next.length !== selectedIds.value.length) selectedIds.value = next
  }) })
  return { selectedId, selectedIds, select, all: () => { selectedIds.value = [...order()] } }
}
