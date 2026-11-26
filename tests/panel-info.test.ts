import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readPanelInfo } from '../web/display/panel-info'
import type { PageHost, Settings } from '../web/display/types'

const geometry = { width: 480, height: 320, bpp: 16, shape: 'rect', device: '/dev/fb0' }

function host(settings: Settings, reply: unknown = null, failure?: Error): PageHost {
  return {
    apiVersion: 1,
    extension: { value: { settings } },
    getStatus: async () => ({}),
    invoke: async <T>() => {
      if (failure) throw failure
      return reply as T
    },
    registerSettings: () => () => {},
  }
}

test('uses current service panel settings without invoking legacy methods', async () => {
  const result = await readPanelInfo(host({ panel_json: JSON.stringify(geometry) }, null, new Error('Unsupported method')))
  assert.deepEqual(result, { status: 'ready', panel: geometry, source: 'settings' })
})

test('supports legacy screen information', async () => {
  const result = await readPanelInfo(host({}, { ok: true, ...geometry }))
  assert.deepEqual(result, { status: 'ready', panel: geometry, source: 'legacy' })
})

test('reports a confirmed missing screen separately from request failures', async () => {
  assert.deepEqual(await readPanelInfo(host({}, { ok: false, error: 'no framebuffer' })), { status: 'unavailable' })
  await assert.rejects(readPanelInfo(host({}, null, new Error('Connection failed'))), /Connection failed/)
  await assert.rejects(readPanelInfo(host({}, { ok: false, error: 'fb ioctl' })))
})

test('invalid or incomplete settings cannot create a default screen', async () => {
  for (const panel_json of ['{', '{}', 'null', '{"width":0,"height":240}', '{"width":"240","height":240}']) {
    assert.deepEqual(await readPanelInfo(host({ panel_json }, { ok: false, error: 'no framebuffer' })), { status: 'unavailable' })
  }
  await assert.rejects(readPanelInfo(host({}, { ok: true })))
})
