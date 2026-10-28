import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getTopicConstellationHeight, layoutTopicConstellations } from '../src/components/knowledge/topicConstellationLayout'

const clusters = (counts: number[]) => counts.map((cluster_size, index) => ({
  cluster_id: `topic-${String(index).padStart(3, '0')}`, cluster_size,
}))

function assertGeometry(counts: number[], width: number, height: number, input = clusters(counts)) {
  const islands = layoutTopicConstellations(input, width, height)
  const usesAbsoluteMap = width >= 600 && islands.every(island => island.rx >= 54 && island.ry >= 52)
  const epsilon = 1e-7
  for (const island of islands) {
    assert.ok([island.x, island.y, island.rx, island.ry, island.labelY, island.countY, island.keywordY, island.dotScale].every(Number.isFinite))
    assert.ok(island.dotScale >= 1 && island.dotScale <= 1.18)
    assert.ok(island.rx > 0 && island.ry > 0)
    const bounds = island.hitBounds
    assert.ok([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite))
    if (usesAbsoluteMap || counts.length === 1) {
      assert.ok(island.x + bounds.x >= -epsilon && island.x + bounds.x + bounds.width <= width + epsilon)
      assert.ok(island.y + bounds.y >= -epsilon && island.y + bounds.y + bounds.height <= height + epsilon)
    }
    if (island.points.length) assert.ok(island.outline.startsWith('M') && island.outline.endsWith('Z'))
    else assert.equal(island.outline, '', 'a topic without samples must not fabricate a cloud boundary')
    assert.doesNotMatch(island.outline, /NaN|Infinity/)
    for (const point of island.points) {
      assert.ok([point.x, point.y, point.weight].every(Number.isFinite))
      assert.ok(Number.isInteger(point.weight) && point.weight > 0)
      assert.ok(Math.hypot(point.x / island.rx, point.y / island.ry) <= 1)
      assert.ok(point.y >= island.countY + Math.min(9, island.ry * 0.13), 'sample dots must leave the upper title/count zone clear')
      assert.ok(point.y <= island.keywordY - Math.min(16, island.ry * 0.23) + epsilon, 'sample dots must leave the lower keyword zone clear')
    }
  }
  for (let i = 0; i < islands.length; i += 1) {
    for (const b of islands.slice(i + 1)) {
      const a = islands[i]
      if (!usesAbsoluteMap) continue // Dense and narrow hosts use the compact stream in document flow.
      const ax = a.x + a.hitBounds.x, ay = a.y + a.hitBounds.y
      const bx = b.x + b.hitBounds.x, by = b.y + b.hitBounds.y
      const separated = ax + a.hitBounds.width <= bx + epsilon || bx + b.hitBounds.width <= ax + epsilon
        || ay + a.hitBounds.height <= by + epsilon || by + b.hitBounds.height <= ay + epsilon
      assert.ok(separated, `${a.id} and ${b.id} have overlapping click targets`)
    }
  }
  return islands
}

test('the real eight topics contain exactly 144 equal sample dots on both desktop canvases', () => {
  const counts = [25, 22, 21, 20, 19, 19, 14, 4]
  for (const [width, height] of [[730, 480], [1140, 480]]) {
    const islands = assertGeometry(counts, width, height)
    assert.equal(islands.reduce((sum, island) => sum + island.points.length, 0), 144)
    assert.ok(islands.every(island => island.points.every(point => point.weight === 1)))
    for (const [index, count] of counts.entries()) {
      assert.equal(islands.find(island => island.id === clusters(counts)[index].cluster_id)!.points.length, count)
    }
    assert.ok(islands.every(island => island.rx >= 55 && island.ry >= 50), 'desktop islands must leave readable label space')
    const largest = islands[0]
    const cloudHeight = Math.max(...largest.points.map(point => point.y)) - Math.min(...largest.points.map(point => point.y))
    assert.ok(cloudHeight >= largest.ry * 0.5, 'a real cluster must have a two-dimensional cloud, not a horizontal dot strip')
  }
})

test('placement and clouds are deterministic, independent of API order, and leave input unchanged', () => {
  const input = clusters([4, 25, 19, 19, 22])
  const original = structuredClone(input)
  const first = layoutTopicConstellations(input, 730, 480)
  assert.deepEqual(layoutTopicConstellations([...input].reverse(), 730, 480), first)
  assert.deepEqual(layoutTopicConstellations(input, 730, 480), first)
  assert.deepEqual(input, original)
  assert.deepEqual(first.map(island => island.id), ['topic-001', 'topic-004', 'topic-002', 'topic-003', 'topic-000'])
})

test('large groups cap their displayed dots but preserve exact integer sample totals', () => {
  const counts = [1, 4, 80, 81, 305, 1000000, Number.MAX_SAFE_INTEGER]
  const islands = assertGeometry(counts, 1140, 480)
  for (const [index, count] of counts.entries()) {
    const island = islands.find(candidate => candidate.id === `topic-${String(index).padStart(3, '0')}`)!
    assert.equal(island.points.length, Math.min(80, count))
    assert.equal(island.points.reduce((sum, point) => sum + point.weight, 0), count)
  }
})

test('zero and invalid counts keep a text island without inventing sample dots', () => {
  const islands = assertGeometry([0, -5, NaN, Infinity], 730, 480)
  assert.ok(islands.every(island => island.points.length === 0))
  assert.equal(layoutTopicConstellations(clusters([2.9]), 200, 130)[0].points.length, 2)
})

test('empty, single, narrow, and invalid hosts retain finite contained geometry', () => {
  assert.deepEqual(layoutTopicConstellations([], 730, 480), [])
  const single = assertGeometry([25], 200, 130)[0]
  assert.ok(Math.abs(single.x + single.hitBounds.x + single.hitBounds.width / 2 - 100) < 1e-7)
  assert.ok(Math.abs(single.y + single.hitBounds.y + single.hitBounds.height / 2 - 65) < 1e-7)
  assertGeometry([25, 22, 21, 20, 19, 19, 14, 4], 250, 520)
  const invalid = layoutTopicConstellations(clusters([4, 25]), NaN, -10)
  assert.ok(invalid.every(island => [island.x, island.y, island.rx, island.ry].every(Number.isFinite)))
  assert.ok(invalid.every(island => [island.hitBounds.x, island.hitBounds.y, island.hitBounds.width, island.hitBounds.height].every(Number.isFinite)))
})

test('recommended heights adapt to one, two, three, five, eight, and twenty topics without hiding desktop groups', () => {
  for (const width of [730, 1140]) {
    const countsBySize = [[31], [31, 18], [31, 18, 12], [31, 18, 12, 4, 2],
      [25, 22, 21, 20, 19, 19, 14, 4], Array.from({ length: 20 }, (_, index) => index + 1)]
    let previousHeight = 0
    for (const counts of countsBySize) {
      const height = getTopicConstellationHeight(counts.length, width)
      assert.ok(height >= 260 && height <= 560)
      assert.ok(height >= previousHeight)
      previousHeight = height
      const islands = assertGeometry(counts, width, height)
      assert.equal(islands.reduce((sum, island) => sum + island.points.reduce((total, point) => total + point.weight, 0), 0), counts.reduce((sum, count) => sum + count, 0))
      if (counts.length <= 8) {
        assert.ok(islands.every(island => island.rx >= 54 && island.ry >= 54), 'desktop groups must not collapse into a stream because the canvas was shortened')
      }
    }
  }
  assert.equal(getTopicConstellationHeight(5, 730), 440)
  assert.equal(getTopicConstellationHeight(5, 1140), 420)
  assert.equal(getTopicConstellationHeight(8, 1140), 480)
  assert.equal(getTopicConstellationHeight(NaN, Infinity), 270)
})

test('adaptive canvas sizes preserve the original scattered centre relationships', () => {
  for (const counts of [[31, 18, 12, 4, 2], [25, 22, 21, 20, 19, 19, 14, 4]]) {
    const input = clusters(counts)
    const original = layoutTopicConstellations(input, 730, 500)
    for (const width of [730, 1140]) {
      const height = getTopicConstellationHeight(counts.length, width)
      const adapted = layoutTopicConstellations(input, width, height)
      for (let i = 0; i < adapted.length; i += 1) {
        for (let j = i + 1; j < adapted.length; j += 1) {
          assert.equal(Math.sign(adapted[j].x - adapted[i].x), Math.sign(original[j].x - original[i].x), 'gathering must preserve left/right relationships')
          assert.equal(Math.sign(adapted[j].y - adapted[i].y), Math.sign(original[j].y - original[i].y), 'gathering must preserve above/below relationships')
        }
      }
    }
  }
})

test('five-topic clouds use the available room and captions stay close to actual small clouds', () => {
  const counts = [31, 18, 12, 4, 2]
  for (const width of [730, 1140]) {
    const islands = assertGeometry(counts, width, getTopicConstellationHeight(counts.length, width))
    const largest = islands[0]
    const cloudWidth = Math.max(...largest.points.map(point => point.x)) - Math.min(...largest.points.map(point => point.x))
    const cloudHeight = Math.max(...largest.points.map(point => point.y)) - Math.min(...largest.points.map(point => point.y))
    assert.ok(cloudWidth >= 125, 'the 31-dot cloud should no longer remain a roughly 110px symbol on desktop')
    assert.ok(cloudWidth / cloudHeight <= 2.6, 'larger dots must retain a two-dimensional cloud instead of a horizontal strip')
    for (const island of islands) {
      const cloudTop = Math.min(...island.points.map(point => point.y))
      assert.ok(cloudTop - island.countY >= 9 && cloudTop - island.countY <= 16, 'count captions should follow the real cloud, including two-dot topics')
    }
  }
})

test('extreme sample ratios retain every group at the recommended height', () => {
  for (const width of [730, 1140]) {
    const counts = [Number.MAX_SAFE_INTEGER, 1000000, 4, 1, 0]
    const islands = assertGeometry(counts, width, getTopicConstellationHeight(counts.length, width))
    assert.equal(islands.length, 5)
    for (const [index, count] of counts.entries()) {
      const island = islands.find(candidate => candidate.id === `topic-${String(index).padStart(3, '0')}`)!
      assert.equal(island.points.length, Math.min(80, count))
      assert.equal(island.points.reduce((sum, point) => sum + point.weight, 0), count)
    }
  }
})

test('real film topics gather visible content while keeping separate click targets and unchanged clouds', () => {
  const input = [
    { cluster_id: '0b376ce0-1c3a-49d0-81f1-008771bd4058', cluster_size: 28, keywords: ['黑帮', '暴力', '尔比'] },
    { cluster_id: '2206d514-83e3-46ff-9df3-8bf5d944350d', cluster_size: 24, keywords: ['蜘蛛侠', '漫画', '迈尔斯'] },
    { cluster_id: 'ab290a63-40b0-496d-ac86-c94f6a97589c', cluster_size: 15, keywords: ['剧情片', '访谈', '金币'] },
    { cluster_id: 'd71fe238-75f2-44df-bee6-9e638fa88813', cluster_size: 11, keywords: ['革命', '场景', '演讲'] },
    { cluster_id: '2d444ab1-d292-4076-aff1-c6fe2e306318', cluster_size: 4, keywords: ['海报', '蜘蛛侠', '黑帮'] },
    { cluster_id: 'bfc0fa83-ce7e-49ea-904b-c74271bae572', cluster_size: 4, keywords: ['海报', '题材', '动画电影'] },
  ]
  for (const width of [730, 1231]) {
    const height = getTopicConstellationHeight(input.length, width)
    const islands = assertGeometry(input.map(cluster => cluster.cluster_size), width, height, input)
    const spanX = Math.max(...islands.map(island => island.x)) - Math.min(...islands.map(island => island.x))
    assert.ok(spanX <= (width === 730 ? 400 : 600), 'gathering should remove the old oversized horizontal spacing')
    const withoutLabels = layoutTopicConstellations(input.map(({ cluster_id, cluster_size }) => ({ cluster_id, cluster_size })), width, height)
    for (const island of islands) {
      assert.deepEqual(island.points, withoutLabels.find(candidate => candidate.id === island.id)!.points, 'fitting text must not shrink or regenerate sample clouds')
      const visible = island.contentBounds
      const hit = island.hitBounds
      assert.ok(hit.x <= visible.x && hit.y <= visible.y)
      assert.ok(hit.x + hit.width >= visible.x + visible.width && hit.y + hit.height >= visible.y + visible.height)
      assert.ok(hit.width >= 44 && hit.height >= 44)
      for (const point of island.points) {
        assert.ok(point.x > visible.x && point.x < visible.x + visible.width)
        assert.ok(point.y > visible.y && point.y < visible.y + visible.height)
      }
    }
  }
})
