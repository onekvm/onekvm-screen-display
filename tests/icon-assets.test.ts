import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iconPixels } from '../web/display/icon-assets'

test('plugin preview artwork decodes RGB565 and alpha and rejects malformed icons', () => {
  const encoded = Buffer.from([73,67,79,49,1,0,1,0,0,248,128]).toString('base64')
  const icon = iconPixels(encoded)!
  assert.equal(icon.width, 1)
  assert.deepEqual([...icon.pixels], [255,0,0,128])
  assert.equal(iconPixels('invalid'), null)
  assert.equal(iconPixels(Buffer.from([73,67,79,49,0,0,1,0]).toString('base64')), null)
  assert.equal(iconPixels(encoded.slice(0,-4)), null)
})
