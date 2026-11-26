import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type { PageHost } from './types'

export interface DebugTarget { id: string; app: string; instance: string; role: string }
export interface DebugNode { i: number; t: string; n?: string; x?: string; c?: string; v?: number; k?: DebugNode[] }
export interface DebugEvent { sequence: number; target: string; message: Record<string, unknown> }
interface Snapshot { enabled: boolean; cursor: number; dropped: number; targets: DebugTarget[]; events: DebugEvent[] }
export interface ConsoleLine { key: number; level: string; text: string }

export function useScreenDevtools(host: PageHost) {
  const enabled = shallowRef(false)
  const busy = shallowRef(false)
  const error = shallowRef('')
  const targets = shallowRef<DebugTarget[]>([])
  const selected = shallowRef('')
  const tree = shallowRef<DebugNode | null>(null)
  const lines = shallowRef<ConsoleLine[]>([])
  const paused = shallowRef(false)
  const frame = shallowRef(0)
  const dropped = shallowRef(0)
  const url = `/api/plugins/${encodeURIComponent(host.extension.value.id || 'screen-display')}/remote/devtools`
  let cursor = 0
  let lineKey = 0
  let modeRevision = 0
  const targetStatus = new Map<string, { paused: boolean; frame: number }>()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const controllers = new Set<AbortController>()
  const target = computed(() => targets.value.find(item => item.id === selected.value))

  async function request(body?: unknown): Promise<Snapshot | undefined> {
    const controller = new AbortController()
    controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(body ? url : `${url}?after=${cursor}`, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
      return body ? undefined : result as Snapshot
    } finally { clearTimeout(timeout); controllers.delete(controller) }
  }
  function append(level: string, text: string) {
    lines.value = [...lines.value, { key: ++lineKey, level, text: text.slice(0, 2048) }].slice(-200)
  }
  function receive(event: DebugEvent) {
    const message = event.message
    const previous = targetStatus.get(event.target) || { paused: false, frame: 0 }
    targetStatus.set(event.target, {
      paused: message.t === 'stats' ? message.paused === true : previous.paused,
      frame: typeof message.frame === 'number' ? message.frame : previous.frame,
    })
    if (event.target !== selected.value) return
    if (typeof message.frame === 'number') frame.value = message.frame
    switch (message.t) {
      case 'tree': tree.value = message.root as DebugNode; break
      case 'stats': paused.value = message.paused === true; break
      case 'log': append(String(message.level), (Array.isArray(message.args) ? message.args : []).join(' ')); break
      case 'error': append('error', [message.message || message.error || JSON.stringify(message), message.stack].filter(Boolean).join('\n')); break
      case 'evalResult': append(message.ok ? 'result' : 'error', String(message.value)); break
    }
  }
  async function command(message: Record<string, unknown>) {
    if (stopped || !enabled.value || !selected.value) return
    try {
      await request({ action: 'command', target: selected.value, command: message })
      error.value = ''
    } catch (reason) { if (!stopped) error.value = String(reason) }
  }
  async function poll() {
    if (stopped) return
    try {
      const revision = modeRevision
      const result = await request()
      if (!result || stopped || revision !== modeRevision) return
      enabled.value = result.enabled
      targets.value = result.targets
      for (const id of targetStatus.keys()) if (!result.targets.some(item => item.id === id)) targetStatus.delete(id)
      if (!result.enabled) targetStatus.clear()
      dropped.value = result.dropped
      if (!result.targets.some(item => item.id === selected.value)) selected.value = result.targets[0]?.id || ''
      for (const event of result.events) if (event.sequence > cursor) receive(event)
      cursor = Math.max(cursor, result.cursor)
      error.value = ''
      if (enabled.value && selected.value) await command({ t: 'devStats' })
    } catch (reason) { if (!stopped) error.value = String(reason) }
    finally { if (!stopped) timer = setTimeout(poll, 750) }
  }
  async function mode(value: boolean) {
    modeRevision += 1
    busy.value = true
    try {
      await request({ action: value ? 'enable' : 'disable' })
      if (stopped) return
      enabled.value = value
      if (value) await command({ t: 'getTree' })
      else { tree.value = null; lines.value = []; paused.value = false; targetStatus.clear() }
      error.value = ''
    } catch (reason) { error.value = String(reason) }
    finally { if (stopped) release(); busy.value = false }
  }
  async function reload() {
    try { await request({ action: 'reload' }); error.value = '' }
    catch (reason) { error.value = String(reason) }
  }
  function evaluate(code: string) { append('input', `> ${code}`); return command({ t: 'eval', id: ++lineKey, code }) }
  watch(selected, () => { tree.value = null; lines.value = []; paused.value = targetStatus.get(selected.value)?.paused || false; frame.value = targetStatus.get(selected.value)?.frame || 0; void command({ t: 'getTree' }) })
  function release() {
    void fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disable' }) }).catch(() => {})
  }
  onMounted(() => { void poll() })
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
    for (const controller of controllers) controller.abort()
    // The server lease also restores paused guests if this request cannot finish.
    if (enabled.value || busy.value) release()
  })
  return { enabled, busy, error, targets, selected, target, tree, lines, paused, frame, dropped, mode, command, reload, evaluate, clear: () => { lines.value = [] } }
}
