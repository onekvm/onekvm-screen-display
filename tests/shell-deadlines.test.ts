import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextShellDelay } from '../src/shell/deadlines'

test('minute-only faces do not request invisible seconds', () => {
  assert.equal(nextShellDelay(12_345, true, false), 47_655)
  assert.equal(nextShellDelay(60_000, true, false), 60_000)
  assert.equal(nextShellDelay(59_999, true, false), 1)
})

test('ticks retain seconds, hidden clocks and launcher need no clock timer', () => {
  assert.equal(nextShellDelay(12_345, true, true), 655)
  assert.equal(nextShellDelay(12_345, false, true), 0)
  assert.equal(nextShellDelay(12_345, false, false), 0)
})

test('visible data deadlines win over the clock and overdue work runs promptly', () => {
  assert.equal(nextShellDelay(12_345, true, false, 20_000), 7655)
  assert.equal(nextShellDelay(12_345, false, false, 20_000), 7655)
  assert.equal(nextShellDelay(12_345, true, true, 12_000), 1)
  assert.equal(nextShellDelay(0, false, false, 86_400_000), 86_400_000)
})

test('clock boundaries remain aligned across midnight and backward clock changes', () => {
  assert.equal(nextShellDelay(86_399_900, true, false), 100)
  assert.equal(nextShellDelay(1_200, true, false), 58_800)
  assert.equal(nextShellDelay(-1, true, false), 1)
})
