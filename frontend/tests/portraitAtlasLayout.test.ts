import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutPortraitClusters, type PortraitAtlasNode } from '../src/components/knowledge/portraitAtlasLayout'

const clusters = (counts: number[]) => counts.map((cluster_size, index) => ({
  cluster_id: `topic-${String(index).padStart(3, '0')}`,
  cluster_size,
}))

function assertContainedAndSeparate(nodes: PortraitAtlasNode[], width: number, height: number, margin = 0) {
  const epsilon = 1e-7
  for (const node of nodes) {
    assert.ok([node.x, node.y, node.r].every(Number.isFinite), `${node.id} must have finite geometry`)
    assert.ok(node.r > 0, `${node.id} must remain visible`)
    assert.ok(node.x - node.r >= margin - epsilon, `${node.id} crosses the left boundary`)
    assert.ok(node.y - node.r >= margin - epsilon, `${node.id} crosses the top boundary`)
    assert.ok(node.x + node.r <= width - margin + epsilon, `${node.id} crosses the right boundary`)
    assert.ok(node.y + node.r <= height - margin + epsilon, `${node.id} crosses the bottom boundary`)
  }
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]
      const b = nodes[j]
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) + epsilon >= a.r + b.r, `${a.id} overlaps ${b.id}`)
    }
  }
}

test('empty and single-topic atlases have finite, centered geometry', () => {
  assert.deepEqual(layoutPortraitClusters([], 640, 420), [])
  const nodes = layoutPortraitClusters(clusters([72]), 640, 420)
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].x, 320)
  assert.equal(nodes[0].y, 210)
  assertContainedAndSeparate(nodes, 640, 420, 20)
})

test('the six-topic screenshot data stays within the chart at desktop and narrow sizes', () => {
  for (const [width, height] of [[680, 420], [320, 360], [180, 480], [1000, 240]]) {
    const nodes = layoutPortraitClusters(clusters([20, 7, 20, 19, 4, 2]), width, height)
    assert.equal(nodes.length, 6)
    assertContainedAndSeparate(nodes, width, height, 20)
  }
})

test('circle area ratios match positive sample counts, including large disparities', () => {
  const input = clusters([1, 2, 7, 20, 1e12])
  const nodes = layoutPortraitClusters(input, 680, 420)
  const first = nodes.find((node) => node.id === input[0].cluster_id)!
  for (const cluster of input) {
    const node = nodes.find((candidate) => candidate.id === cluster.cluster_id)!
    const relativeError = Math.abs((node.r / first.r) ** 2 / cluster.cluster_size - 1)
    assert.ok(relativeError < 1e-10, `${node.id} lost its area ratio`)
  }
  assertContainedAndSeparate(nodes, 680, 420, 20)
})

test('many equally sized topics neither overlap nor leave the viewport', () => {
  for (const [width, height] of [[640, 420], [220, 320]]) {
    const nodes = layoutPortraitClusters(clusters(Array.from({ length: 80 }, () => 1)), width, height)
    assert.equal(nodes.length, 80)
    assertContainedAndSeparate(nodes, width, height, 20)
    assert.ok(nodes.every((node) => Math.abs(node.r - nodes[0].r) < 1e-10))
  }
})

test('extreme finite positive counts do not underflow radii to zero', () => {
  const input = clusters([Number.MIN_VALUE, 1e-300, 1, 1e300, Number.MAX_VALUE])
  const nodes = layoutPortraitClusters(input, 680, 420)
  assertContainedAndSeparate(nodes, 680, 420, 20)
  const scales = input.map(cluster => nodes.find(node => node.id === cluster.cluster_id)!.r / Math.sqrt(cluster.cluster_size))
  for (const scale of scales) assert.ok(Math.abs(scale / scales[2] - 1) < 1e-8)
})

test('ordering and placement are stable when the API returns the same topics in another order', () => {
  const input = clusters([4, 20, 20, 2, 7])
  const original = structuredClone(input)
  const first = layoutPortraitClusters(input, 680, 420)
  assert.deepEqual(layoutPortraitClusters([...input].reverse(), 680, 420), first)
  assert.deepEqual(input, original, 'layout must not mutate API data')
  assert.deepEqual(first.map((node) => node.id), ['topic-001', 'topic-002', 'topic-004', 'topic-000', 'topic-003'])
})

test('invalid counts normalize to one and invalid/tiny dimensions remain safe', () => {
  const input = clusters([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1])
  for (const [width, height] of [[1, 1], [0, -5], [Number.NaN, Number.POSITIVE_INFINITY], [30, 80]]) {
    const safeWidth = Number.isFinite(width) ? Math.max(1, width) : 1
    const safeHeight = Number.isFinite(height) ? Math.max(1, height) : 1
    const nodes = layoutPortraitClusters(input, width, height)
    assertContainedAndSeparate(nodes, safeWidth, safeHeight)
    assert.ok(nodes.every((node) => Math.abs(node.r - nodes[0].r) < 1e-10))
  }
})
