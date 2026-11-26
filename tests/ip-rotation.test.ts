import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandHomeWidgetTemplate, normalizeHomeWidgetStatus } from '../src/shared/homeWidgets'
import { createIpRotation } from '../src/shared/ipRotation'
const status = () => normalizeHomeWidgetStatus({ network: { ip: '10.0.0.1', ipv4_addresses: ['192.168.1.2', '10.0.0.1', '', 42, '172.16.0.3'] } })

test('OLED address order: primary first, unique nonempty addresses including fallback', () => {
  assert.deepEqual(status().ipv4Addresses, ['10.0.0.1', '192.168.1.2', '172.16.0.3'])
})

test('original ip variable cycles every 10 seconds while primary_ip stays fixed', () => {
  const rotation = createIpRotation()
  const value = (now: number) => expandHomeWidgetTemplate('{ip}|{primary_ip}', rotation.update(status(), now))
  assert.equal(value(1000), '10.0.0.1|10.0.0.1')
  assert.equal(value(10999), '10.0.0.1|10.0.0.1')
  assert.equal(value(11000), '192.168.1.2|10.0.0.1')
  assert.equal(value(21000), '172.16.0.3|10.0.0.1')
  assert.equal(value(31000), '10.0.0.1|10.0.0.1')
})

test('polling preserves rotation; address changes restart at primary and remove stale addresses', () => {
  const rotation = createIpRotation()
  rotation.update(status(), 0)
  rotation.update(status(), 9000)
  assert.equal(rotation.update(status(), 10000).ip, '192.168.1.2')
  const changed = normalizeHomeWidgetStatus({ network: { ip: '10.0.0.2', ipv4_addresses: ['172.16.0.3'] } })
  assert.equal(rotation.update(changed, 10001).ip, '10.0.0.2')
  assert.equal(rotation.update(changed, 20000).ip, '10.0.0.2')
  assert.equal(rotation.update(changed, 20001).ip, '172.16.0.3')
  assert.equal(rotation.update(changed, 500).ip, '10.0.0.2')
})

test('older Core, missing primary IP, and empty networks remain usable', () => {
  const rotation = createIpRotation()
  const single = normalizeHomeWidgetStatus({ network: { ip: '10.0.0.1' } })
  assert.equal(rotation.update(single, 0).ip, '10.0.0.1')
  assert.equal(rotation.update(single, 20000).ip, '10.0.0.1')
  const noPrimary = normalizeHomeWidgetStatus({ network: { ipv4_addresses: ['192.168.1.2'] } })
  assert.equal(expandHomeWidgetTemplate('{ip}|{primary_ip}', rotation.update(noPrimary, 21000)), '192.168.1.2|--')
  assert.equal(expandHomeWidgetTemplate('{ip}|{primary_ip}', rotation.update(normalizeHomeWidgetStatus({}), 22000)), '--|--')
})
