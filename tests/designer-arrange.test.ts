import { expect, test } from 'bun:test'
import { arrangeBoxes, moveLayerGroup, stepLayerGroup } from '../web/display/designer-arrange'
import { layoutBoxes, positionLayout } from '../web/display/designer-layout'
import { parseLayout, parsePanel } from '../web/display/types'
const boxes = [
  { id: 'a', x: 20, y: 30, width: 20, height: 10 },
  { id: 'b', x: 60, y: 70, width: 40, height: 20 },
  { id: 'c', x: 130, y: 110, width: 10, height: 30 },
]
test('alignment uses scaled edges and a shared center while preserving other dimensions', () => {
  expect(arrangeBoxes(boxes, 'left').map(b => b.x - b.width / 2)).toEqual([10, 10, 10])
  expect(arrangeBoxes(boxes, 'right').map(b => b.x + b.width / 2)).toEqual([135, 135, 135])
  expect(arrangeBoxes(boxes, 'middle').map(b => b.y)).toEqual([75, 75, 75])
  expect(arrangeBoxes(boxes, 'bottom').map(b => b.y + b.height / 2)).toEqual([125, 125, 125])
  expect(boxes[1]!.x).toBe(60)
})
test('equal gaps keep endpoints fixed, and use dimensions rather than center distance', () => {
  const result = arrangeBoxes([boxes[2]!, boxes[0]!, boxes[1]!], 'space-x')
  const [c, a, b] = result
  expect(a!.x).toBe(20); expect(c!.x).toBe(130)
  expect((b!.x - b!.width / 2) - (a!.x + a!.width / 2)).toBeCloseTo((c!.x - c!.width / 2) - (b!.x + b!.width / 2))
  expect(arrangeBoxes(boxes.slice(0, 2), 'space-y')).toEqual(boxes.slice(0, 2))
})
test('group layer drag retains relative order and ignores targets in its selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  expect(moveLayerGroup(order, ['d', 'b'], 'a', true)).toEqual(['b', 'd', 'a', 'c', 'e'])
  expect(moveLayerGroup(order, ['b', 'd'], 'e', false)).toEqual(['a', 'c', 'e', 'b', 'd'])
  expect(moveLayerGroup(order, ['b', 'd'], 'd', true)).toEqual(order)
  expect(stepLayerGroup(order, ['b', 'c'], true)).toEqual(['b', 'c', 'a', 'd', 'e'])
  expect(stepLayerGroup(order, ['b', 'd'], false)).toEqual(['a', 'c', 'b', 'e', 'd'])
  expect(stepLayerGroup(order, order, false)).toEqual(order)
})
test('geometry includes the clock and scale without changing native media indices', () => {
  const layout = parseLayout(JSON.stringify({ face: 'screen-display/dashboard', dashboard_clock: { x: 80, y: 20, scale: 1 },
    home_widgets: [{ id: 'a', kind: 'rect', x: 50, y: 50, width: 40, height: 20, scale: 1.5 }, { id: 'video', kind: 'media' }] }))
  const panel = parsePanel('{"width":320,"height":172}')
  expect(layoutBoxes(layout, panel, ['a'])[0]!.width).toBe(60)
  expect(layoutBoxes(layout, panel, ['clock'])[0]!.width).toBe(78)
  const next = positionLayout(layout, [{ id: 'a', x: 20, y: 30 }, { id: 'clock', x: 90, y: 10 }])
  expect(next.home_widgets.map(p => p.id)).toEqual(['a', 'video'])
  expect(next.dashboard_clock!.x).toBe(90)
  expect(layout.home_widgets[0]!.x).toBe(50)
})

test('selection supports touch toggles, ranges, group-preserving drag and prunes removed layers without reactive loops', async () => {
  const { createRenderer, defineComponent, computed, nextTick, ref } = await import('vue')
  const { useDesignerSelection } = await import('../web/display/useDesignerSelection')
  const ids = ref(['a', 'b', 'c', 'd'])
  let selection!: ReturnType<typeof useDesignerSelection>
  const app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null } as any).createApp(defineComponent({ setup() {
    // The actual layer list depends on selection for rendering its checkboxes.
    const items = computed(() => ids.value.map(id => ({ id, selected: selection.selectedIds.value.includes(id) })))
    selection = useDesignerSelection(() => items.value.map(item => item.id), 'a')
    return () => null
  } }))
  app.mount({})
  selection.select('c', { toggle: true }); await nextTick()
  expect(selection.selectedIds.value).toEqual(['a', 'c'])
  selection.select('a', { preserve: true }); expect(selection.selectedIds.value).toEqual(['a', 'c'])
  selection.select('a', { range: true }); expect(selection.selectedIds.value).toEqual(['a', 'b', 'c'])
  selection.select('b', { toggle: true }); expect(selection.selectedIds.value).toEqual(['a', 'c'])
  ids.value = ['a', 'b', 'd']; await nextTick(); expect(selection.selectedIds.value).toEqual(['a'])
  selection.all(); await nextTick(); expect(selection.selectedIds.value).toEqual(ids.value)
  app.unmount()
})
