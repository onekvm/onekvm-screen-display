import { expect, test } from 'bun:test'
import { debugTreeRows } from '../web/display/debug-tree'
import type { DebugNode } from '../web/display/useScreenDevtools'

test('text leaves highlight the enclosing native layout; virtual groups are not inspected', () => {
  const rows = debugTreeRows({ i: 0, t: 'surfaces', v: 1, k: [{ i: 5, t: 'text', k: [{ i: 6, t: '#text', x: 'counter' }] }] })
  expect(rows.map(row => row.inspectId)).toEqual([0, 5, 5])
})
test('oversized and deeply nested debug trees stay bounded in the browser', () => {
  expect(debugTreeRows({ i: 1, t: 'root', k: Array.from({ length: 4000 }, (_, i) => ({ i: i + 2, t: 'view' })) })).toHaveLength(2000)
  let root: DebugNode = { i: 1, t: 'view' }
  for (let i = 0; i < 200; i++) root = { i: i + 2, t: 'view', k: [root] }
  expect(debugTreeRows(root)).toHaveLength(65)
})
