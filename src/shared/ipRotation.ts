import type { HomeWidgetStatus } from './homeWidgets'

/** Match OLED: preferred address first, reset on list changes, one step per 10s. */
export function createIpRotation() {
  let addresses: string[] = []
  let index = 0
  let deadline = Infinity
  let previousTime = 0
  return {
    update(status: HomeWidgetStatus, now = Date.now()): HomeWidgetStatus {
      const next = status.ipv4Addresses.length ? status.ipv4Addresses : status.primaryIp ? [status.primaryIp] : []
      if (now < previousTime || next.length !== addresses.length || next.some((ip, i) => ip !== addresses[i])) {
        addresses = [...next]
        index = 0
        deadline = addresses.length > 1 ? now + 10_000 : Infinity
      } else if (now >= deadline) {
        index = (index + 1) % addresses.length
        deadline = now + 10_000
      }
      previousTime = now
      return { ...status, ip: addresses[index] || '' }
    },
  }
}
