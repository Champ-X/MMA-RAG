/** Browser-like image events and card controls; layout is verified separately in a browser. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { KnowledgeBase } from '../src/store/useKnowledgeStore'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLImageElement', 'HTMLButtonElement', 'Element', 'Node', 'Event', 'MouseEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const fallbackSrc = '/knowledge/covers-v2/documents.webp'
let root: Root | undefined
let container: HTMLDivElement

async function setup(initial: Partial<KnowledgeBase> = {}, dark = false) {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { act } = requireFrontend('react') as typeof import('react')
  const { KnowledgeSpaceCard } = await import('../src/components/knowledge/KnowledgeSpaceCard')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  document.documentElement.classList.toggle('dark', dark)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let knowledgeBase: KnowledgeBase = {
    id: 'interview', name: '访谈素材', description: '一段仍在处理的视频', updated_at: '2026-10-24T00:00:00Z',
    stats: { documents: 0, images: 0, chunks: 0, audio: 0, video: 1 }, cover_url: null, ...initial,
  }
  const calls = { open: 0, menu: 0, edit: 0, delete: 0 }
  const render = async (patch: Partial<KnowledgeBase> = {}, menuOpen = false) => {
    knowledgeBase = { ...knowledgeBase, ...patch }
    await act(async () => root!.render(<KnowledgeSpaceCard
      knowledgeBase={knowledgeBase} fallbackSrc={fallbackSrc}
      menuOpen={menuOpen} onOpen={() => { calls.open += 1 }} onToggleMenu={() => { calls.menu += 1 }}
      onEdit={() => { calls.edit += 1 }} onDelete={() => { calls.delete += 1 }}
    />))
  }
  const card = () => container.querySelector('[data-cover-kind]') as HTMLElement
  const picture = () => container.querySelector('img') as HTMLImageElement | null
  const load = async (element: HTMLImageElement, naturalWidth = 640) => {
    Object.defineProperty(element, 'naturalWidth', { configurable: true, value: naturalWidth })
    await act(async () => { element.dispatchEvent(new Event('load')) })
  }
  const fail = async (element: HTMLImageElement) => act(async () => { element.dispatchEvent(new Event('error')) })
  await render()
  return { act, render, card, picture, load, fail, calls }
}

afterEach(async () => {
  const { act } = requireFrontend('react') as typeof import('react')
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  document.documentElement.classList.remove('dark')
})

test('video or image counts never suppress the default cover when no usable URL exists', async () => {
  const { render, card, picture } = await setup()
  assert.equal(card().dataset.coverKind, 'default')
  assert.equal(picture(), null)
  assert.ok([...card().querySelectorAll<HTMLElement>('[aria-hidden="true"]')].some(node => node.style.backgroundImage.includes(fallbackSrc)))
  assert.match(card().textContent!, /访谈素材/)
  assert.match(card().textContent!, /1\s*视频/)
  await render({ cover_url: '   ', stats: { documents: 2, chunks: 5, images: 3, video: 1 } })
  assert.equal(card().dataset.coverKind, 'default')
  assert.equal(picture(), null)
  assert.match(card().textContent!, /3\s*图片/)
  assert.equal(container.querySelectorAll('h3').length, 1)
})

test('a media cover changes styling only after a successful load and errors restore the fallback', async () => {
  const { card, picture, load, fail } = await setup({ cover_url: '/covers/interview.jpg' })
  const title = container.querySelector('h3')!
  const description = container.querySelector('p')!
  const media = picture()!
  assert.equal(card().dataset.coverKind, 'default', 'a pending URL is not a loaded cover')
  assert.equal(media.classList.contains('opacity-0'), true)
  assert.equal(title.classList.contains('text-white'), false)
  await load(media)
  assert.equal(card().dataset.coverKind, 'media')
  assert.equal(picture()!.classList.contains('opacity-100'), true)
  assert.equal(title.classList.contains('text-white'), true)
  assert.equal(container.querySelector('h3'), title, 'the content remains the same DOM across cover states')
  assert.equal(container.querySelector('p'), description)
  await fail(media)
  assert.equal(card().dataset.coverKind, 'default')
  assert.equal(picture(), null)
  assert.equal(title.classList.contains('text-white'), false)
  assert.equal(container.querySelector('h3'), title)
})

test('an empty image load uses the fallback and a replacement URL can recover', async () => {
  const { render, card, picture, load, fail } = await setup({ cover_url: '/covers/broken.jpg' })
  const broken = picture()!
  await load(broken, 0)
  assert.equal(card().dataset.coverKind, 'default')
  assert.equal(picture(), null)
  await render({ cover_url: '/covers/recovered.jpg' })
  const recovered = picture()!
  assert.equal(recovered.getAttribute('src'), '/covers/recovered.jpg')
  assert.equal(card().dataset.coverKind, 'default')
  await load(recovered)
  assert.equal(card().dataset.coverKind, 'media')
  await fail(broken)
  assert.equal(card().dataset.coverKind, 'media', 'late events for a removed URL cannot replace the current cover')
  await render({ cover_url: null })
  assert.equal(card().dataset.coverKind, 'default')
  assert.equal(picture(), null)
})

test('replacing a loaded media URL uses the default while the replacement is pending', async () => {
  const { render, card, picture, load } = await setup({ cover_url: '/covers/first.jpg' })
  const first = picture()!
  await load(first)
  assert.equal(card().dataset.coverKind, 'media')
  await render({ cover_url: '/covers/second.jpg' })
  assert.equal(card().dataset.coverKind, 'default')
  assert.equal(picture()!.getAttribute('src'), '/covers/second.jpg')
  await load(first)
  assert.equal(card().dataset.coverKind, 'default', 'a late old load must not reveal the unready replacement')
  await load(picture()!)
  assert.equal(card().dataset.coverKind, 'media')
})

for (const dark of [false, true]) test(`open and menu actions stay distinct with ${dark ? 'dark' : 'light'} theme and fallback/media covers`, async () => {
  const { act, render, card, picture, load, calls } = await setup({ cover_url: '/covers/actions.jpg' }, dark)
  const button = (label: string) => container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
  await act(async () => { button('打开知识库：访谈素材').click() })
  assert.deepEqual(calls, { open: 1, menu: 0, edit: 0, delete: 0 })
  await act(async () => { button('更多操作：访谈素材').click() })
  assert.deepEqual(calls, { open: 1, menu: 1, edit: 0, delete: 0 })
  await render({}, true)
  assert.equal(button('更多操作：访谈素材').getAttribute('aria-expanded'), 'true')
  await act(async () => {
    const edit = [...container.querySelectorAll('button')].find(node => node.textContent === '编辑')!
    edit.click()
  })
  assert.deepEqual(calls, { open: 1, menu: 1, edit: 1, delete: 0 })
  await load(picture()!)
  assert.equal(card().dataset.coverKind, 'media')
  await act(async () => {
    const remove = [...container.querySelectorAll('button')].find(node => node.textContent === '删除')!
    remove.click()
  })
  assert.deepEqual(calls, { open: 1, menu: 1, edit: 1, delete: 1 })
  await render({}, false)
  assert.equal(button('更多操作：访谈素材').getAttribute('aria-expanded'), 'false')
  assert.equal([...container.querySelectorAll('button')].some(node => node.textContent === '删除'), false)
})
