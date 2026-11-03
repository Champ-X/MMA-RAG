/** Topic reading contracts; geometry and visual appearance are verified separately. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React, { useState } from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { PortraitCluster } from '../src/components/knowledge/PortraitGraph'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node',
  'Event', 'KeyboardEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
let canvasObserver: { callback: ResizeObserverCallback; target?: Element } | undefined
Object.assign(globalThis, {
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    constructor(callback: ResizeObserverCallback) { canvasObserver = { callback } }
    observe(target: Element) { canvasObserver!.target = target }
    unobserve() {}
    disconnect() { canvasObserver = undefined }
  },
})
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
const settle = () => new Promise(resolve => setTimeout(resolve, 25))
let root: Root | undefined
let container: HTMLDivElement

const topics: PortraitCluster[] = [
  { cluster_id: 'compression', cluster_size: 4, keywords: ['压缩', '编码'], topic_summary: '讲解语言模型与文本压缩的关系。' },
  { cluster_id: 'jet', cluster_size: 25, keywords: ['射流', '入水', '实验'], topic_summary: '通过入水实验观察流体运动。' },
  { cluster_id: 'matrix', cluster_size: 19, keywords: ['矩阵', '向量'], topic_summary: '介绍 Transformer 多头注意力的计算过程。' },
]

async function setup(clusters = topics) {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { TopicAtlas } = await import('../src/components/knowledge/TopicAtlas')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const calls = { selected: [] as string[], cleared: 0 }
  function Harness() {
    const [selectedId, setSelectedId] = useState<string | null>(null)
    return <TopicAtlas clusters={clusters} selectedId={selectedId}
      onSelect={topic => {
        calls.selected.push(topic.cluster_id)
        // Match PortraitGraph's toggle contract: repeated callbacks would clear selection.
        setSelectedId(previous => previous === topic.cluster_id ? null : topic.cluster_id)
      }}
      onClear={() => { calls.cleared += 1; setSelectedId(null) }} />
  }
  await act(async () => { root!.render(<Harness />); await settle() })
  return calls
}

function button(label: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)
  assert.ok(result, `Missing button: ${label}`)
  return result
}

function topicButton(id: string) {
  const result = container.querySelector<HTMLButtonElement>(`[data-topic-id="${id}"]`)
  assert.ok(result, `Missing topic: ${id}`)
  return result
}

function input() {
  const result = container.querySelector<HTMLInputElement>('input[aria-label="搜索主题、关键词或摘要"]')
  assert.ok(result)
  return result
}

function readingTitle() {
  return container.querySelector('aside h4')?.textContent
}

function topicIds() {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-topic-id]:not(:disabled)')].map(node => node.dataset.topicId)
}

function assertMapTopics(count: number) {
  const map = container.querySelector('[role="group"][aria-label="主题聚类图"]')
  assert.ok(map, 'the selected cluster view must remain a spatial map')
  assert.equal(map.querySelectorAll('[data-topic-id]').length, count, 'every topic must remain on the map')
  assert.equal(map.querySelectorAll('[data-topic-id] > svg').length, count, 'every topic must retain its cluster drawing')
  assert.equal(map.querySelectorAll('[data-topic-id]:not(:disabled)[tabindex="0"]').length, 1,
    'the spatial map exposes exactly one sequential tab stop')
  assert.equal(container.querySelector('[aria-label="主题列表"]'), null, 'the directory is opt-in')
}

function assertBoundedMap(width: number, expectShrink = false) {
  const atlas = container.querySelector<HTMLElement>('.topic-atlas')!
  const height = parseFloat(atlas.style.getPropertyValue('--atlas-canvas-height'))
  assert.ok(height > 0 && height <= 520, 'topic density must not grow the map beyond its bounded height')
  const scales: number[] = []
  for (const cluster of container.querySelectorAll<HTMLButtonElement>('[data-topic-id]')) {
    const scale = Number(cluster.style.transform.match(/^scale\(([^)]+)\)$/)?.[1])
    assert.ok(Number.isFinite(scale) && scale > 0 && scale <= 1, 'each topic uses a finite, non-enlarging scale')
    scales.push(scale)
    const left = parseFloat(cluster.style.left)
    const top = parseFloat(cluster.style.top)
    const right = left + parseFloat(cluster.style.width) * scale
    const bottom = top + parseFloat(cluster.style.height) * scale
    assert.ok(left >= -0.01 && top >= -0.01 && right <= width + 0.01 && bottom <= height + 0.01,
      `${cluster.dataset.topicId} must fit inside the same bounded canvas after its transform`)
    assert.ok(cluster.querySelector(':scope > svg .atlas-cluster-members'), 'member dots scale with their interactive topic')
    assert.ok(cluster.querySelector(':scope > .atlas-cluster-name'), 'the title scales with the dots')
    assert.ok(cluster.querySelector(':scope > .atlas-cluster-count'), 'the sample caption scales with the dots')
  }
  if (expectShrink) assert.ok(scales.some(scale => scale < 1), 'dense maps shrink complete topics instead of extending the canvas')
}

async function resizeCanvas(width: number) {
  assert.ok(canvasObserver?.target, 'the map must observe its available width')
  const observer = canvasObserver
  await act(async () => {
    observer.callback([{ target: observer.target, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
    await settle()
  })
}

async function click(target: HTMLButtonElement) {
  await act(async () => { target.click(); await settle() })
}

async function search(value: string) {
  await act(async () => {
    const field = input()
    field.focus()
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  })
}

async function escape(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
  })
}

afterEach(async () => {
  await act(async () => { root?.unmount(); await settle() })
  root = undefined
  container?.remove()
})

test('the largest topic is previewed without selecting or clearing anything', async () => {
  const calls = await setup()
  assert.equal(readingTitle(), '射流')
  assert.deepEqual(topicIds(), ['jet', 'matrix', 'compression'])
  assert.equal(container.querySelectorAll('[data-topic-id][aria-pressed="true"]').length, 0)
  assert.deepEqual(calls, { selected: [], cleared: 0 })
  assert.equal(button('上一个主题').disabled, true)
  assert.equal(button('下一个主题').disabled, false)
})

test('clicking the current selected topic again does not toggle it off', async () => {
  const calls = await setup()
  await click(topicButton('matrix'))
  assert.equal(readingTitle(), '矩阵')
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true')
  await click(topicButton('matrix'))
  assert.equal(readingTitle(), '矩阵')
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true')
  assert.deepEqual(calls, { selected: ['matrix'], cleared: 0 })
})

test('previous and next navigate ranked topics and stop at both ends', async () => {
  const calls = await setup()
  await click(button('下一个主题'))
  assert.equal(readingTitle(), '矩阵')
  assert.equal(button('上一个主题').disabled, false)
  await click(button('下一个主题'))
  assert.equal(readingTitle(), '压缩')
  assert.equal(button('下一个主题').disabled, true)
  await click(button('下一个主题'))
  assert.deepEqual(calls.selected, ['matrix', 'compression'], 'a disabled next control must not select an absent topic')
  await click(button('上一个主题'))
  assert.equal(readingTitle(), '矩阵')
  await click(button('上一个主题'))
  assert.equal(readingTitle(), '射流')
  assert.equal(button('上一个主题').disabled, true)
  assert.deepEqual(calls.selected, ['matrix', 'compression', 'matrix', 'jet'])
})

test('summary search preserves every desktop cluster position and clearing restores availability and focus', async () => {
  const calls = await setup()
  assert.ok(container.querySelector('[aria-label="主题聚类图"]'))
  const before = new Map(topicIds().map(id => [id, topicButton(id!).getAttribute('style')]))
  await search('tRaNsFoRmEr')
  assert.deepEqual(topicIds(), ['matrix'], 'the matching word exists only in the full summary')
  assert.equal(container.querySelectorAll('[data-topic-id]').length, 3, 'non-matching clusters keep their spatial addresses')
  assert.equal(topicButton('jet').disabled, true)
  assert.equal(topicButton('compression').disabled, true)
  for (const [id, style] of before) assert.equal(topicButton(id!).getAttribute('style'), style, `${id} moved during search`)
  assert.equal(readingTitle(), '矩阵')
  assert.match(container.querySelector('[role="status"]')!.textContent!, /1 \/ 3/)
  assert.deepEqual(calls.selected, [], 'filtering previews a result without selecting it')
  await click(button('清空主题搜索'))
  assert.equal(input().value, '')
  assert.equal(document.activeElement, input())
  assert.deepEqual(topicIds(), ['jet', 'matrix', 'compression'])
  assert.equal(readingTitle(), '射流')
})

test('an empty search removes stale details and offers a working reset', async () => {
  await setup()
  await click(topicButton('matrix'))
  await search('没有这个主题')
  assert.deepEqual(topicIds(), [])
  assert.equal(readingTitle(), undefined)
  assert.match(container.textContent!, /没有找到匹配主题/)
  assert.match(container.textContent!, /搜索结果会在这里展开/)
  assert.equal(button('上一个主题').disabled, true)
  assert.equal(button('下一个主题').disabled, true)
  await click(button('清空搜索'))
  assert.equal(input().value, '')
  assert.equal(document.activeElement, input())
  assert.deepEqual(topicIds(), ['jet', 'matrix', 'compression'])
})

test('switching between the cluster view and directory preserves the selected topic', async () => {
  const calls = await setup()
  await click(topicButton('matrix'))
  await click(button('主题目录'))
  assert.equal(button('主题目录').getAttribute('aria-pressed'), 'true')
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true')
  assert.equal(readingTitle(), '矩阵')
  await click(button('聚类视图'))
  assert.equal(button('聚类视图').getAttribute('aria-pressed'), 'true')
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true')
  assert.equal(readingTitle(), '矩阵')
  assert.deepEqual(calls, { selected: ['matrix'], cleared: 0 })
})

for (const count of [14, 60]) {
  test(`${count} topics stay in the spatial map through selection, search, and directory round trips`, async () => {
    const denseTopics = Array.from({ length: count }, (_, index) => ({
      cluster_id: `dense-${index}`, cluster_size: 80 - index,
      keywords: [`主题${index}`, '智能体'], topic_summary: index === count - 1 ? 'Unique retrieval marker.' : '普通主题摘要。',
    }))
    const calls = await setup(denseTopics)
    assertMapTopics(count)
    assertBoundedMap(760, count === 60)
    const positions = new Map(topicIds().map(id => [id, topicButton(id!).getAttribute('style')]))
    const last = denseTopics[count - 1]
    await click(topicButton(last.cluster_id))
    assert.equal(readingTitle(), last.keywords[0])
    assert.equal(topicButton(last.cluster_id).getAttribute('aria-pressed'), 'true')

    await search('Unique retrieval marker')
    assertMapTopics(count)
    assert.deepEqual(topicIds(), [last.cluster_id])
    for (const [id, position] of positions) {
      assert.equal(topicButton(id!).getAttribute('style'), position, `${id} moved while searching the dense map`)
    }
    await click(button('清空主题搜索'))
    await click(topicButton(last.cluster_id))
    await click(button('主题目录'))
    assert.equal(container.querySelectorAll('[aria-label="主题列表"] [data-topic-id]').length, count)
    assert.equal(topicButton(last.cluster_id).getAttribute('aria-pressed'), 'true')
    await click(button('聚类视图'))
    assertMapTopics(count)
    assertBoundedMap(760, count === 60)
    assert.equal(readingTitle(), last.keywords[0])
    assert.equal(topicButton(last.cluster_id).getAttribute('aria-pressed'), 'true')
    assert.deepEqual(calls.selected, [last.cluster_id, last.cluster_id])
    await resizeCanvas(360)
    assertMapTopics(count)
    assertBoundedMap(360, true)
  })
}

test('resizing to narrow containers keeps discrete clusters, selection, and the focused tab stop', async () => {
  const calls = await setup()
  await click(topicButton('matrix'))
  await act(async () => { topicButton('matrix').focus(); await settle() })
  for (const width of [360, 280, 760]) {
    await resizeCanvas(width)
    assertMapTopics(topics.length)
    assertBoundedMap(width)
    assert.equal(button('聚类视图').getAttribute('aria-pressed'), 'true')
    assert.equal(readingTitle(), '矩阵')
    assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true')
    assert.equal(topicButton('matrix').tabIndex, 0)
    assert.equal(document.activeElement, topicButton('matrix'))
  }
  assert.deepEqual(calls, { selected: ['matrix'], cleared: 0 })
})

test('desktop topic selection reveals an offscreen reading panel without scrolling visible panels or paging', async () => {
  await setup()
  const atlas = container.querySelector<HTMLElement>('.topic-atlas')!
  const panel = container.querySelector<HTMLElement>('aside[aria-label="主题阅读面板"]')!
  Object.defineProperty(atlas, 'clientWidth', { value: 1200 })
  let panelTop = 80
  panel.getBoundingClientRect = () => new dom.window.DOMRect(0, panelTop, 300, 400)
  const scrolls: (boolean | ScrollIntoViewOptions | undefined)[] = []
  panel.scrollIntoView = options => { scrolls.push(options) }

  await click(topicButton('matrix'))
  assert.equal(scrolls.length, 0, 'an already visible desktop reader must not move the page')
  panelTop = -600
  await click(topicButton('compression'))
  assert.equal(readingTitle(), '压缩')
  assert.equal(scrolls.length, 1, 'a topic below the fold must reveal its reader above the viewport')
  await click(button('上一个主题'))
  assert.equal(readingTitle(), '矩阵')
  assert.equal(scrolls.length, 1, 'paging inside the reader must not trigger another reveal')
  panelTop = window.innerHeight + 40
  await click(topicButton('jet'))
  assert.equal(readingTitle(), '射流')
  assert.equal(scrolls.length, 2, 'a reader below the viewport must also be revealed')
})

test('the directory identifies the current reading separately from explicit selection', async () => {
  const calls = await setup()
  await click(button('主题目录'))
  const currentTopics = () => [...container.querySelectorAll<HTMLButtonElement>('[data-topic-id][aria-current="true"]')]
    .map(node => node.dataset.topicId)
  assert.deepEqual(currentTopics(), ['jet'], 'the initial preview must have one current reading indicator')
  assert.equal(topicButton('jet').getAttribute('aria-pressed'), 'false', 'a current reading is not an implicit selection')
  for (const topic of topics) {
    assert.equal(topicButton(topic.cluster_id).querySelector('.atlas-list-excerpt')?.textContent, topic.topic_summary,
      'directory excerpts must come from the actual topic summary')
  }
  assert.deepEqual(calls, { selected: [], cleared: 0 })

  await click(topicButton('matrix'))
  assert.deepEqual(currentTopics(), ['matrix'])
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true')
  await click(button('清除选择'))
  assert.deepEqual(currentTopics(), ['jet'], 'clearing selection must restore the first preview as the current reading')
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'false')
  assert.equal(document.activeElement, topicButton('matrix'))
  assert.deepEqual(calls, { selected: ['matrix'], cleared: 1 })

  await search('Transformer')
  assert.deepEqual(currentTopics(), ['matrix'], 'search must mark its first preview without selecting it')
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'false')
  assert.deepEqual(calls, { selected: ['matrix'], cleared: 2 })
})

test('Escape clears search first, then selection, restoring focus to the relevant control', async () => {
  const calls = await setup()
  await search('Transformer')
  await click(topicButton('matrix'))
  const clearedBeforeEscape = calls.cleared
  await escape(topicButton('matrix'))
  assert.equal(input().value, '')
  assert.equal(document.activeElement, input())
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true', 'the first Escape only clears the query')
  assert.equal(calls.cleared, clearedBeforeEscape)
  await escape(input())
  assert.equal(calls.cleared, clearedBeforeEscape + 1)
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'false')
  assert.equal(document.activeElement, topicButton('matrix'))
  assert.equal(readingTitle(), '射流')
})

test('zero and invalid counts keep selectable cluster labels without inventing sample dots', async () => {
  const missing = [0, -3, Number.NaN, Number.POSITIVE_INFINITY].map((cluster_size, index) => ({
    cluster_id: `missing-${index}`, cluster_size, keywords: [`缺失主题${index}`], topic_summary: '暂无可用样本数量。',
  }))
  const calls = await setup([topics[1], ...missing])
  assert.equal(button('主题目录').getAttribute('aria-pressed'), 'false')
  assert.equal(button('聚类视图').getAttribute('aria-pressed'), 'true')
  assert.equal(button('聚类视图').disabled, false)
  assert.ok(container.querySelector('[aria-label="主题聚类图"]'))
  assert.match(container.querySelector('[role="status"]')!.textContent!, /25\s*条已归类样本/, 'unknown counts must not add placeholder samples to the total')
  for (const topic of missing) {
    const cluster = topicButton(topic.cluster_id)
    assert.equal(cluster.disabled, false)
    assert.equal(cluster.querySelector('.atlas-cluster-count b')!.textContent, '0')
    assert.equal(cluster.querySelectorAll('.atlas-cluster-members circle').length, 0)
    assert.equal(cluster.querySelector('.atlas-cluster-envelope')!.getAttribute('d'), '', 'no samples means no fabricated cloud boundary')
  }
  await click(topicButton('missing-0'))
  assert.equal(topicButton('missing-0').getAttribute('aria-pressed'), 'true', 'a topic with unknown quantity remains readable')
  assert.equal(readingTitle(), '缺失主题0')
  assert.match(container.querySelector('.atlas-reading-stats')!.textContent!, /^0\s*条样本/)
  assert.deepEqual(calls, { selected: ['missing-0'], cleared: 0 })
})

test('large sample counts cap weighted dots while a one-sample topic stays readable and selectable', async () => {
  const calls = await setup([
    { ...topics[1], cluster_size: 1e9 },
    { ...topics[2], cluster_size: 1 },
  ])
  assert.equal(button('聚类视图').getAttribute('aria-pressed'), 'true')
  assert.equal(button('聚类视图').disabled, false)
  assert.deepEqual(topicIds(), ['jet', 'matrix'])
  const weightedDots = [...topicButton('jet').querySelectorAll('.atlas-cluster-members circle')]
  assert.equal(weightedDots.length, 80)
  assert.equal(weightedDots.reduce((sum, circle) => sum + Number(circle.getAttribute('data-sample-weight')), 0), 1e9)
  assert.equal(topicButton('jet').querySelector('.atlas-cluster-count b')!.textContent, (1e9).toLocaleString())
  assert.equal(topicButton('matrix').querySelectorAll('.atlas-cluster-members circle').length, 1)
  assert.equal(topicButton('matrix').querySelector('.atlas-cluster-count b')!.textContent, '1')
  await click(topicButton('matrix'))
  assert.equal(readingTitle(), '矩阵')
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true')
  assert.deepEqual(calls, { selected: ['matrix'], cleared: 0 })
})

test('a keyword starts a search and focuses its input without selecting a topic', async () => {
  const calls = await setup()
  await click(button('入水'))
  assert.equal(input().value, '入水')
  assert.equal(document.activeElement, input())
  assert.deepEqual(topicIds(), ['jet'])
  assert.equal(topicButton('matrix').disabled, true)
  assert.equal(topicButton('jet').getAttribute('aria-pressed'), 'false')
  assert.deepEqual(calls, { selected: [], cleared: 1 })
})

test('returning to the cluster keeps the current selection and restores focus', async () => {
  const calls = await setup()
  await click(topicButton('matrix'))
  const summary = container.querySelector<HTMLElement>('[role="region"][aria-label="主题摘要"]')!
  await act(async () => { summary.focus() })
  assert.equal(document.activeElement, summary)
  await click(button('返回主题'))
  assert.equal(document.activeElement, topicButton('matrix'))
  assert.equal(topicButton('matrix').getAttribute('aria-pressed'), 'true')
  assert.equal(readingTitle(), '矩阵')
  assert.deepEqual(calls, { selected: ['matrix'], cleared: 0 })
})
