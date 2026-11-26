import { expect, test } from 'bun:test'
import { createRenderer, defineComponent } from 'vue'
import { useRemoteDisplay } from '../web/display/useRemoteDisplay'
import type { PageHost } from '../web/display/types'

test('remote stays idle until Connect, releases on hide/disconnect, and does not reconnect after manual stop or remount', async () => {
  const oldDocument = globalThis.document, oldDecoder = globalThis.VideoDecoder, oldFetch = globalThis.fetch
  const document = new EventTarget() as EventTarget & { hidden: boolean }; document.hidden = false
  let requests = 0, aborted = 0
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null } as any)
  let remote!: ReturnType<typeof useRemoteDisplay>
  const component = defineComponent({ setup() { remote = useRemoteDisplay({ extension: { value: { id: 'screen-display' } }, invoke: async () => {} } as unknown as PageHost, () => {}, () => 'unsupported'); return () => null } })
  const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
  try {
    globalThis.document = document as unknown as Document
    globalThis.VideoDecoder = class {
      static async isConfigSupported() { return { supported: true } }
      state = 'configured'; configure() {}; close() { this.state = 'closed' }
    } as unknown as typeof VideoDecoder
    globalThis.fetch = (async (_url, init) => {
      requests++
      return await new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => { aborted++; reject(new Error('aborted')) }))
    }) as typeof fetch
    let app = renderer.createApp(component); app.mount({})
    await tick(); expect(requests).toBe(0)
    document.dispatchEvent(new Event('visibilitychange')); await tick(); expect(requests).toBe(0)
    remote.connect(); await tick(); expect(requests).toBe(1)
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); await tick(); expect(aborted).toBe(1)
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); await tick(); expect(requests).toBe(2)
    remote.disconnect(); await tick(); expect(aborted).toBe(2); expect(remote.requested.value).toBe(false)
    document.dispatchEvent(new Event('visibilitychange')); await tick(); expect(requests).toBe(2)
    app.unmount(); app = renderer.createApp(component); app.mount({}); await tick(); expect(requests).toBe(2)
    remote.connect(); remote.disconnect(); await tick(); expect(requests).toBe(2)
    app.unmount()
  } finally { globalThis.document = oldDocument; globalThis.VideoDecoder = oldDecoder; globalThis.fetch = oldFetch }
})
