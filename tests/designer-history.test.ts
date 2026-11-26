import { describe, expect, test } from 'bun:test'
import { effectScope, ref } from 'vue'
import { createDesignerHistory } from '../web/display/designer-history'
import { useDesignerHistory } from '../web/display/useDesignerHistory'

describe('designer history', () => {
  test('groups a drag into one undo and invalidates redo after a new edit', () => {
    const history = createDesignerHistory('initial', (a, b) => a === b)
    history.record('x=1')
    history.record('x=15', true)
    history.record('x=30', true)
    expect(history.undo()).toBe('initial')
    expect(history.redo()).toBe('x=30')
    expect(history.undo()).toBe('initial')
    history.record('new component')
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toBe('initial')
  })

  test('keeps large immutable assets by reference and bounds retained steps', () => {
    const asset = { data: 'large media' }
    const first = { layout: 'one', asset }
    const history = createDesignerHistory(first, (a, b) => a.layout === b.layout && a.asset === b.asset, 2)
    for (const layout of ['two', 'three', 'four']) history.record({ layout, asset })
    expect(history.undo()?.asset).toBe(asset)
    expect(history.undo()?.layout).toBe('two')
    expect(history.canUndo).toBe(false)
    history.reset(first)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })

  test('Vue history restores deletion, properties and media together without recording restores', () => {
    const scope = effectScope()
    scope.run(() => {
      const layout = ref({ widgets: [{ id: 'status', border: true }] })
      const history = useDesignerHistory(() => JSON.stringify(layout.value), value => { layout.value = JSON.parse(value) }, (a, b) => a === b)
      history.pointerDown()
      layout.value.widgets[0].border = false
      history.boundary()
      layout.value.widgets = []
      expect(history.canUndo.value).toBe(true)
      history.undo()
      expect(layout.value.widgets[0].border).toBe(false)
      history.undo()
      expect(layout.value.widgets[0].border).toBe(true)
      history.redo()
      expect(layout.value.widgets[0].border).toBe(false)
      history.reset()
      expect(history.canUndo.value).toBe(false)
      history.dispose()
    })
    scope.stop()
  })
})
