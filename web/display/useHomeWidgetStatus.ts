import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { emptyHomeWidgetStatus, type HomeWidgetStatus } from '../../src/shared/homeWidgets'
import { createIpRotation } from '../../src/shared/ipRotation'

/** Keep live IP rotation independent of network polling and preview visibility. */
export function useHomeWidgetStatus() {
  const status = shallowRef(emptyHomeWidgetStatus())
  const rotation = createIpRotation()
  let latest = status.value
  let timer: ReturnType<typeof setInterval> | undefined
  function update(value: HomeWidgetStatus) {
    latest = value
    status.value = rotation.update(value)
  }
  onMounted(() => {
    timer = setInterval(() => {
      const next = rotation.update(latest)
      if (next.ip !== status.value.ip) status.value = next
    }, 1000)
  })
  onBeforeUnmount(() => { if (timer !== undefined) clearInterval(timer) })
  return { status, update }
}
