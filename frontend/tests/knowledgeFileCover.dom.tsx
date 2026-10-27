import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { KnowledgeFileView } from '../src/components/knowledge/KnowledgeListHelpers'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLImageElement', 'Element', 'Node', 'Event', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
let root: Root | undefined
let container: HTMLDivElement | undefined
const file = (type: string, overrides: Partial<KnowledgeFileView> = {}): KnowledgeFileView => ({
  id: 'file-1', name: `素材.${type}`, type, status: 'ready', size: '1 KB', date: '2026-10-26', ...overrides,
})

async function setup(initialFile: KnowledgeFileView) {
  const { FileHero, FileThumb } = await import('../src/components/knowledge/KnowledgeListHelpers')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = async (next: KnowledgeFileView) => act(async () => {
    root!.render(<><div data-view="gallery"><FileHero file={next} /></div><div data-view="list"><FileThumb file={next} /></div></>)
  })
  await render(initialFile)
  return render
}
const image = (view: string) => container?.querySelector<HTMLImageElement>(`[data-view="${view}"] img`)
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); root = undefined })

test('gallery and list share document and stable audio covers', async () => {
  const render = await setup(file('pdf'))
  assert.equal(image('gallery')?.getAttribute('src'), '/knowledge/file-covers-v1/pdf.webp')
  assert.equal(image('gallery')?.getAttribute('src'), image('list')?.getAttribute('src'))
  assert.equal(image('gallery')?.getAttribute('alt'), '', 'Decorative art does not claim to be document content')
  assert.match(container!.querySelector('[role="img"]')!.getAttribute('aria-label')!, /PDF/)
  await render(file('mp3'))
  const audioSrc = image('gallery')?.getAttribute('src')
  assert.match(audioSrc!, /audio-.*\.webp$/)
  assert.equal(audioSrc, image('list')?.getAttribute('src'))
  await render(file('mp3', { name: '重命名.mp3' }))
  assert.equal(image('gallery')?.getAttribute('src'), audioSrc)
  assert.match(container!.textContent!, /MP3/)
})

test('failed artwork falls back to a format icon and a changed cover URL recovers', async () => {
  const render = await setup(file('pdf'))
  const failedHero = image('gallery')!
  await act(async () => {
    failedHero.dispatchEvent(new Event('error'))
    image('list')!.dispatchEvent(new Event('error'))
  })
  assert.equal(image('gallery'), null)
  assert.equal(image('list'), null)
  assert.ok(container!.querySelector('.file-artwork-cover__fallback svg'))
  assert.match(container!.textContent!, /PDF/)
  await render(file('md'))
  assert.equal(image('gallery')?.getAttribute('src'), '/knowledge/file-covers-v1/markdown.webp')
  assert.equal(image('list')?.getAttribute('src'), '/knowledge/file-covers-v1/markdown.webp')
  await act(async () => failedHero.dispatchEvent(new Event('error')))
  assert.equal(image('gallery')?.getAttribute('src'), '/knowledge/file-covers-v1/markdown.webp')
})

test('real image and video thumbnails stay intact', async () => {
  const render = await setup(file('jpg', { name: '用户原文.pdf', previewUrl: '/original.jpg', thumbnailUrl: '/thumbnail.jpg' }))
  assert.equal(image('gallery')?.getAttribute('src'), '/thumbnail.jpg')
  assert.equal(image('gallery')?.getAttribute('alt'), '用户原文.pdf')
  assert.equal(image('list')?.getAttribute('src'), '/thumbnail.jpg')
  await render(file('mp4', { coverUrl: '/video-frame.jpg' }))
  assert.equal(image('list')?.getAttribute('src'), '/video-frame.jpg')
  assert.ok(container!.querySelector('.file-list-thumb__play'))
  assert.equal(container!.querySelector('.file-artwork-cover'), null)
})

test('unknown document formats show their own extension without TXT artwork', async () => {
  const render = await setup(file('json', { type: 'text/plain' }))
  assert.equal(image('gallery'), null)
  assert.equal(image('list'), null)
  assert.ok(container!.querySelector('.file-artwork-cover__fallback svg'))
  assert.match(container!.textContent!, /JSON/)
  assert.doesNotMatch(container!.textContent!, /TXT/)
  await render(file('txt'))
  assert.equal(image('gallery')?.getAttribute('src'), '/knowledge/file-covers-v1/text.webp')
  assert.equal(image('list')?.getAttribute('src'), '/knowledge/file-covers-v1/text.webp')
})
