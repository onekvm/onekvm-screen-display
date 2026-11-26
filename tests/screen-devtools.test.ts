import { expect, test } from 'bun:test'
import { createRenderer, defineComponent } from 'vue'
import { useScreenDevtools } from '../web/display/useScreenDevtools'
import type { PageHost } from '../web/display/types'

test('leaving during Enable still disables remote evaluation after the pending request settles', async () => {
  const originalFetch = globalThis.fetch
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null } as any)
  let debug!: ReturnType<typeof useScreenDevtools>
  const component = defineComponent({ setup() { debug = useScreenDevtools({ extension: { value: { id: 'screen-display' } } } as unknown as PageHost); return () => null } })
  const actions: string[] = []
  let finish!: (response: Response) => void
  const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
  const app = renderer.createApp(component)
  try {
    globalThis.fetch = (async (_url, init) => {
      if (!init?.body) return Response.json({ enabled: false, cursor: 0, dropped: 0, targets: [], events: [] })
      const { action } = JSON.parse(String(init.body)); actions.push(action)
      if (action === 'enable') return new Promise<Response>(resolve => { finish = resolve })
      return Response.json({ ok: true })
    }) as typeof fetch
    app.mount({}); await tick()
    const enabling = debug.mode(true)
    app.unmount()
    expect(actions).toEqual(['enable', 'disable'])
    finish(Response.json({ ok: true })); await enabling
    expect(actions).toEqual(['enable', 'disable', 'disable'])
    expect(debug.enabled.value).toBe(false)
  } finally { globalThis.fetch = originalFetch }
})

test('switching between independent targets retains each paused state', async () => {
  const originalFetch = globalThis.fetch
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null } as any)
  let debug!: ReturnType<typeof useScreenDevtools>
  const component = defineComponent({ setup() { debug = useScreenDevtools({ extension: { value: { id: 'screen-display' } } } as unknown as PageHost); return () => null } })
  const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  const app = renderer.createApp(component)
  try {
    globalThis.fetch = (async (_url, init) => Response.json(init?.body ? { ok: true } : {
      enabled: true, cursor: 2, dropped: 0,
      targets: [{ id: 'a', app: 'example/counter', instance: 'first', role: 'widget' }, { id: 'b', app: 'example/counter', instance: 'second', role: 'widget' }],
      events: [{ sequence: 1, target: 'a', message: { t: 'stats', paused: true, frame: 42 } }, { sequence: 2, target: 'b', message: { t: 'stats', paused: false, frame: 80 } }],
    })) as typeof fetch
    app.mount({}); await tick(); expect(debug.paused.value).toBe(true)
    debug.selected.value = 'b'; await tick(); expect(debug.paused.value).toBe(false)
    debug.selected.value = 'a'; await tick(); expect(debug.paused.value).toBe(true); expect(debug.frame.value).toBe(42)
  } finally { app.unmount(); globalThis.fetch = originalFetch }
})
