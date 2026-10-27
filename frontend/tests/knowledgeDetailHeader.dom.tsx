/** Detail identity and return navigation; visual styling is checked in-browser. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLImageElement', 'HTMLButtonElement', 'Element', 'Node',
  'NodeFilter', 'MutationObserver', 'Event', 'KeyboardEvent', 'CustomEvent', 'DocumentFragment', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, {
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
})
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
let root: Root | undefined
let container: HTMLDivElement
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

async function setup(coverUrl: string | null = null) {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { KnowledgeDetailHeader } = await import('../src/components/knowledge/KnowledgeDetailHeader')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const calls = { back: 0 }
  const render = async (nextCoverUrl = coverUrl) => act(async () => {
    root!.render(<KnowledgeDetailHeader name="影视素材" description="电影、角色与场景参考" coverUrl={nextCoverUrl}
      onBack={() => { calls.back++ }} />)
    await settle()
  })
  await render()
  return { render, calls }
}

function button(label: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label)
  assert.ok(result, `Missing button: ${label}`)
  return result
}

afterEach(async () => {
  await act(async () => { root?.unmount(); await settle() })
  root = undefined
  container?.remove()
})

test('detail cover failure preserves identity and a replacement URL can recover', async () => {
  const { render, calls } = await setup()
  const heading = container.querySelector('h1')!
  const fallback = container.querySelector<HTMLImageElement>('img')!
  const picture = (src: string) => [...container.querySelectorAll<HTMLImageElement>('img')].find(image => image.getAttribute('src') === src)
  assert.equal(heading.textContent, '影视素材')
  assert.ok(fallback)
  await render('/covers/broken.jpg')
  const broken = picture('/covers/broken.jpg')!
  assert.ok(broken)
  assert.equal(broken.getAttribute('src'), '/covers/broken.jpg')
  await act(async () => { broken.dispatchEvent(new Event('error')) })
  assert.equal(picture('/covers/broken.jpg'), undefined, 'A failed URL must not leave a broken image')
  assert.equal(fallback.isConnected, true)
  assert.equal(container.querySelector('h1'), heading)
  assert.match(container.textContent!, /电影、角色与场景参考/)
  assert.ok(button('返回知识库列表'))

  await render('/covers/recovered.jpg')
  const recovered = picture('/covers/recovered.jpg')!
  assert.ok(recovered)
  assert.equal(recovered.getAttribute('src'), '/covers/recovered.jpg')
  Object.defineProperty(recovered, 'naturalWidth', { configurable: true, value: 640 })
  await act(async () => { recovered.dispatchEvent(new Event('load')) })
  assert.equal(picture('/covers/recovered.jpg'), recovered)
  await act(async () => { broken.dispatchEvent(new Event('error')) })
  assert.equal(picture('/covers/recovered.jpg'), recovered, 'Detached old image events must not replace the new cover')
  await render(null)
  assert.equal(picture('/covers/recovered.jpg'), undefined)
  assert.equal(fallback.isConnected, true)
  assert.equal(container.querySelector('h1'), heading)
  assert.deepEqual(calls, { back: 0 })
})

test('back button returns to the knowledge list', async () => {
  const { calls } = await setup('/covers/film.jpg')
  await act(async () => {
    button('返回知识库列表').click()
    await settle()
  })
  assert.deepEqual(calls, { back: 1 })
})
