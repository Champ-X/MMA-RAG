import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSpatialTopicTarget, type TopicNavigationRect } from '../src/components/knowledge/portraitAtlasNavigation'

test('edge neighbours remain reachable in all four directions', () => {
  const rects = [
    { id: 'current', left: 100, top: 100, width: 40, height: 40 },
    { id: 'right', left: 160, top: 100, width: 40, height: 40 },
    { id: 'left', left: 40, top: 100, width: 40, height: 40 },
    { id: 'up', left: 100, top: 40, width: 40, height: 40 },
    { id: 'down', left: 100, top: 160, width: 40, height: 40 },
  ]
  for (const [key, target] of [['ArrowRight', 'right'], ['ArrowLeft', 'left'], ['ArrowUp', 'up'], ['ArrowDown', 'down']]) {
    assert.equal(getSpatialTopicTarget('current', key, rects), target)
  }
})

test('45-degree tangent circles are reachable despite overlapping bounding boxes on both axes', () => {
  const diagonal = 100 / Math.sqrt(2)
  const rects = [
    { id: 'current', left: 0, top: 0, width: 100, height: 100 },
    { id: 'diagonal', left: diagonal, top: diagonal, width: 100, height: 100 },
  ]
  assert.ok(diagonal < 100, 'both bounding boxes overlap, although circles are tangent')
  assert.equal(getSpatialTopicTarget('current', 'ArrowRight', rects), 'diagonal')
  assert.equal(getSpatialTopicTarget('current', 'ArrowDown', rects), 'diagonal')
  assert.equal(getSpatialTopicTarget('diagonal', 'ArrowLeft', rects), 'current')
  assert.equal(getSpatialTopicTarget('diagonal', 'ArrowUp', rects), 'current')
})

test('direct edge candidates win before nearer diagonal fallback; cross-axis overlap stays preferred', () => {
  const rects = [
    { id: 'current', left: 0, top: 0, width: 100, height: 100 },
    { id: 'diagonal', left: 71, top: 71, width: 100, height: 100 },
    { id: 'edge', left: 400, top: 0, width: 100, height: 100 },
    { id: 'off-axis-edge', left: 101, top: 110, width: 20, height: 20 },
  ]
  assert.equal(getSpatialTopicTarget('current', 'ArrowRight', rects), 'edge')
})

test('boundaries, unknown keys and missing current topics leave navigation to the browser', () => {
  const rects = [
    { id: 'current', left: 40, top: 40, width: 40, height: 40 },
    { id: 'behind', left: 0, top: 40, width: 30, height: 30 },
  ]
  assert.equal(getSpatialTopicTarget('current', 'ArrowRight', rects), null)
  assert.equal(getSpatialTopicTarget('current', 'ArrowDown', rects), null)
  assert.equal(getSpatialTopicTarget('current', 'Home', rects), null)
  assert.equal(getSpatialTopicTarget('missing', 'ArrowLeft', rects), null)
})

test('hidden and nonfinite rectangles cannot capture keyboard navigation', () => {
  const rects: TopicNavigationRect[] = [
    { id: 'current', left: 0, top: 0, width: 40, height: 40 },
    { id: 'zero-width', left: 41, top: 0, width: 0, height: 40 },
    { id: 'negative-height', left: 41, top: 0, width: 40, height: -1 },
    { id: 'nan-position', left: Number.NaN, top: 0, width: 40, height: 40 },
    { id: 'infinite-size', left: 41, top: 0, width: Infinity, height: 40 },
    { id: 'visible', left: 100, top: 0, width: 40, height: 40 },
  ]
  assert.equal(getSpatialTopicTarget('current', 'ArrowRight', rects), 'visible')
  assert.equal(getSpatialTopicTarget('zero-width', 'ArrowRight', rects), null)
})

test('ties are stable across input order and the supplied geometry is never changed', () => {
  const rects = [
    { id: 'current', left: 0, top: 0, width: 40, height: 40 },
    { id: 'b', left: 100, top: -20, width: 40, height: 40 },
    { id: 'a', left: 100, top: 20, width: 40, height: 40 },
  ]
  const before = structuredClone(rects)
  assert.equal(getSpatialTopicTarget('current', 'ArrowRight', rects), 'a')
  assert.equal(getSpatialTopicTarget('current', 'ArrowRight', [...rects].reverse()), 'a')
  assert.deepEqual(rects, before)
})
