import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { PageHost } from './types'
import type { RemoteFrame } from './remote-display'
import { screenVideoConfig, ScreenVideoReader } from './screen-video'

export function useRemoteDisplay(host: PageHost, paint: (frame: VideoFrame) => void, unsupported: () => string) {
  const frame = shallowRef<RemoteFrame | null>(null)
  const error = ref('')
  const busy = ref(false)
  const connected = ref(false)
  const requested = ref(false)
  const ready = computed(() => connected.value && Boolean(frame.value?.ready))
  let stopped = false
  let generation = 0
  let controller: AbortController | undefined
  let decoder: VideoDecoder | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let inputTimer: ReturnType<typeof setTimeout> | undefined

  function closeStream() {
    generation += 1
    clearTimeout(timer)
    controller?.abort()
    if (decoder && decoder.state !== 'closed') decoder.close()
    decoder = undefined
    connected.value = false
  }

  async function connect() {
    closeStream()
    if (!requested.value || stopped || document.hidden) return
    const current = generation
    const abort = new AbortController()
    controller = abort
    let failure: Error | undefined
    let localDecoder: VideoDecoder | undefined
    try {
      if (typeof VideoDecoder === 'undefined') throw new Error(unsupported())
      const config = await screenVideoConfig(config => VideoDecoder.isConfigSupported(config))
      if (!config) throw new Error(unsupported())
      if (current !== generation) return
      const id = encodeURIComponent(host.extension.value.id || 'screen-display')
      const response = await fetch(`/api/plugins/${id}/remote/h264`, { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
      if (!response.ok || !response.body) throw new Error(`Screen video: HTTP ${response.status}`)
      const controls = (response.headers.get('X-OneKVM-Screen-Controls') || '').split(',').filter(Boolean)
      localDecoder = new VideoDecoder({
        output: (decoded) => {
          try {
            if (current !== generation) return
            paint(decoded)
            if (frame.value && !frame.value.ready) frame.value = { ...frame.value, ready: true }
          } finally { decoded.close() }
        },
        error: (reason) => { failure = reason; abort.abort() },
      })
      localDecoder.configure(config)
      decoder = localDecoder
      connected.value = true
      error.value = ''
      frame.value = null
      const reader = response.body.getReader()
      const parser = new ScreenVideoReader()
      let waitingForKeyframe = true
      while (current === generation) {
        const { value, done } = await reader.read()
        if (done) { parser.finish(); throw new Error('Screen video disconnected') }
        for (const packet of parser.push(value)) {
          if (current !== generation) return
          if (!packet.data.length) continue
          if (waitingForKeyframe && !packet.keyframe) continue
          waitingForKeyframe = false
          // Reconnect at a new IDR instead of accumulating latency or dropping reference frames.
          if (localDecoder.decodeQueueSize > 4) throw new Error('Screen video decoder is behind')
          frame.value = { ready: ready.value, width: packet.width, height: packet.height, sequence: packet.timestamp, pixels: '', controls, blanked: packet.blanked }
          localDecoder.decode(new EncodedVideoChunk({ type: packet.keyframe ? 'key' : 'delta', timestamp: packet.timestamp, data: packet.data }))
        }
      }
    } catch (reason) {
      if (current === generation && requested.value && !stopped && !document.hidden) {
        connected.value = false
        error.value = (failure || (reason instanceof Error ? reason : new Error(String(reason)))).message
        timer = setTimeout(connect, 1500)
      }
    } finally {
      abort.abort()
      if (localDecoder && localDecoder.state !== 'closed') localDecoder.close()
    }
  }

  async function send(payload: Record<string, unknown>) {
    if (!ready.value || busy.value) return
    busy.value = true
    try {
      await host.invoke('input', payload)
      if (stopped) return
      const delay = payload.action === 'gesture' ? Number(payload.duration_ms) + 80 : 120
      inputTimer = setTimeout(() => { busy.value = false }, delay)
    } catch (reason) {
      if (!stopped) { error.value = reason instanceof Error ? reason.message : String(reason); busy.value = false }
    }
  }

  function start() { requested.value = true; error.value = ''; void connect() }
  function disconnect() {
    requested.value = false
    closeStream()
    clearTimeout(inputTimer)
    busy.value = false
    error.value = ''
    frame.value = null
  }
  function visibility() {
    if (document.hidden) closeStream()
    else if (requested.value) void connect()
  }

  onMounted(() => { document.addEventListener('visibilitychange', visibility) })
  onBeforeUnmount(() => {
    stopped = true
    disconnect()
    clearTimeout(inputTimer)
    document.removeEventListener('visibilitychange', visibility)
  })
  return { frame: computed(() => frame.value), ready, busy: computed(() => busy.value), error: computed(() => error.value), requested, send, connect: start, disconnect, retry: start }
}
