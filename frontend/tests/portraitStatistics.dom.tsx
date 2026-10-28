/** Parsed-source semantics and static accessibility; visual layout is checked in-browser. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { PortraitSourceCounts } from '../src/components/knowledge/portraitSourceStats'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
const zeroCounts: PortraitSourceCounts = { textCount: 0, imageCount: 0, audioCount: 0, videoShotCount: 0 }
let root: Root | undefined
let container: HTMLDivElement

async function setup(counts: PortraitSourceCounts, documentCount = 0) {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { PortraitStatistics } = await import('../src/components/knowledge/PortraitStatistics')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<PortraitStatistics documentCount={documentCount} {...counts} />) })
}

function source(kind: string) {
  const element = container.querySelector<HTMLElement>(`.portrait-statistics__legend [data-source="${kind}"]`)
  assert.ok(element, `Missing source: ${kind}`)
  return element
}

function total() {
  return container.querySelector('.portrait-statistics__total strong')?.textContent
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
})

test('parsed totals exclude document counts and every source exposes its count and share', async () => {
  await setup({ textCount: 70, imageCount: 10, audioCount: 5, videoShotCount: 15 }, 12)
  assert.ok(container.querySelector('section[aria-label="主题统计"]'))
  assert.equal(total(), '100', 'documents are context, not an additional source of samples')
  assert.equal(container.querySelector('.portrait-statistics__total > span')?.textContent, '已解析内容')
  assert.equal(container.querySelector('.portrait-statistics__total small')?.textContent, '文档 12')
  for (const [kind, label, count] of [['text', '文本块', '70'], ['image', '图片', '10'], ['audio', '音频', '5'], ['video', '视频片段', '15']]) {
    const item = source(kind)
    assert.equal(item.querySelector('dt')?.textContent, label)
    assert.equal(item.querySelector('dd strong')?.textContent, count)
    assert.equal(item.querySelector('dd .sr-only')?.textContent, `占比 ${count}%`)
    assert.equal(item.dataset.empty, 'false')
  }
  const bar = container.querySelector('.portrait-statistics__bar')!
  assert.equal(bar.getAttribute('aria-hidden'), 'true', 'the visible composition band must not duplicate the accessible counts')
  assert.deepEqual([...bar.children].map(segment => (segment as HTMLElement).style.width), ['70%', '10%', '5%', '15%'])
})

test('a video-only source uses shot counts while zero categories stay visible and noninteractive', async () => {
  await setup({ ...zeroCounts, videoShotCount: 397 })
  assert.equal(total(), '397')
  assert.equal(source('video').querySelector('dt')?.textContent, '视频片段')
  assert.equal(source('video').querySelector('dd')?.textContent, '397占比 100%')
  assert.equal(container.querySelector('.portrait-statistics__total small'), null)
  for (const kind of ['text', 'image', 'audio']) {
    assert.equal(source(kind).querySelector('dd')?.textContent, '0占比 0%')
    assert.equal(source(kind).dataset.empty, 'true')
  }
  const segments = [...container.querySelectorAll<HTMLElement>('.portrait-statistics__bar [data-source]')]
  assert.deepEqual(segments.map(segment => [segment.dataset.source, segment.style.width]), [['video', '100%']])
  assert.equal(container.querySelector('button, [role="button"], [aria-pressed], [tabindex]'), null,
    'composition labels must not imply a filtering or selection action')
})

test('empty and invalid sources display zero and waiting state without fabricated shares', async () => {
  await setup({ textCount: Number.NaN, imageCount: -5, audioCount: Number.POSITIVE_INFINITY, videoShotCount: 0 }, -3)
  assert.equal(total(), '0')
  assert.equal(container.querySelector('.portrait-statistics__total > span')?.textContent, '等待内容解析')
  assert.equal(container.querySelector('.portrait-statistics__total small'), null)
  assert.equal(container.querySelectorAll('.portrait-statistics__legend [data-source]').length, 4)
  for (const kind of ['text', 'image', 'audio', 'video']) {
    assert.equal(source(kind).querySelector('dd')?.textContent, '0占比 0%')
    assert.equal(source(kind).dataset.empty, 'true')
  }
  assert.equal(container.querySelector('.portrait-statistics__bar')?.children.length, 0)
  assert.doesNotMatch(container.textContent!, /NaN|Infinity/)
})

test('fractional counts normalize before display and tiny nonzero sources keep their true share', async () => {
  await setup({ textCount: 10000.9, imageCount: 1, audioCount: 0, videoShotCount: 0 }, 2.9)
  assert.equal(total(), (10001).toLocaleString('zh-CN'))
  assert.equal(source('text').querySelector('dd strong')?.textContent, (10000).toLocaleString('zh-CN'))
  assert.equal(source('image').querySelector('dd')?.textContent, '1占比 <0.1%')
  assert.equal(source('image').dataset.empty, 'false')
  assert.equal(container.querySelector('.portrait-statistics__total small')?.textContent, '文档 2')
  const imageShare = container.querySelector<HTMLElement>('.portrait-statistics__bar [data-source="image"]')!
  const width = Number.parseFloat(imageShare.style.width)
  assert.ok(width > 0 && width < 0.1, 'a small source must retain its nonzero fraction without invented minimum weight')
})
