import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { homeRefreshAt, readHomeLayout } from '../src/shell/homeLayout'

function fixture(run: (state: { now: number; cpu: number; widgets: Record<string, unknown>[]; addresses: string[] }) => void) {
  const previous = globalThis.onekvm
  const previousNow = Date.now
  const state = { now: 5_000_000_000_000, cpu: 10, widgets: [] as Record<string, unknown>[], addresses: ['192.0.2.1', '192.0.2.2'] }
  Date.now = () => state.now
  globalThis.onekvm = { get: key => key === 'layout'
    ? JSON.stringify({ face: 'screen-display/digital', clock_enabled: false, mode: 'free', home_widgets: state.widgets })
    : key === 'system' ? JSON.stringify({ network: { ip: state.addresses[0], ipv4_addresses: state.addresses }, system: { cpu_percent: state.cpu } }) : '' }
  try { run(state) } finally { globalThis.onekvm = previous; Date.now = previousNow }
}

test('only visible rotating IP text schedules an address deadline', () => fixture(state => {
  state.widgets = [{ id: 'address', widget: 'screen-display/text', text: '{ip}' }]
  readHomeLayout()
  assert.equal(homeRefreshAt(), state.now + 10_000)
  state.now += 1000
  readHomeLayout()
  assert.equal(homeRefreshAt(), state.now + 9000)
  state.widgets[0].hidden = true
  readHomeLayout()
  assert.equal(homeRefreshAt(), Infinity)
  state.widgets[0].hidden = false
  state.addresses = ['192.0.2.1']
  readHomeLayout()
  assert.equal(homeRefreshAt(), Infinity)
}))

test('static and primary-IP text need no periodic refresh', () => fixture(state => {
  state.widgets = [{ id: 'label', widget: 'screen-display/text', text: 'OneKVM {primary_ip}' }]
  readHomeLayout()
  assert.equal(homeRefreshAt(), Infinity)
}))

test('pending CPU data gets one deferred sample, not a permanent tick', () => fixture(state => {
  state.widgets = [{ id: 'cpu', widget: 'screen-display/text', text: '{cpu_value}' }]
  assert.equal(readHomeLayout().widgets[0].text, '10')
  state.now += 1000
  state.cpu = 20
  assert.equal(readHomeLayout().widgets[0].text, '10')
  assert.equal(homeRefreshAt(), state.now + 4000)
  state.now += 4000
  assert.equal(readHomeLayout().widgets[0].text, '20')
  assert.equal(homeRefreshAt(), Infinity)
}))

test('date widgets refresh at midnight even when the clock is hidden', () => fixture(state => {
  state.widgets = [{ id: 'date', widget: 'screen-display/text', text: '{date}' }]
  readHomeLayout()
  const midnight = new Date()
  midnight.setHours(24, 0, 0, 0)
  assert.equal(homeRefreshAt(), midnight.getTime())
}))
