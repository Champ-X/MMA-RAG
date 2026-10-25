/** Color Atlas navigation and evidence interactions; jsdom is not visual acceptance. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001/architecture', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter',
  'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'DocumentFragment', 'localStorage', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
// These tests exercise navigation and cleanup, not browser media decoding.
dom.window.HTMLMediaElement.prototype.pause = () => {}
dom.window.HTMLElement.prototype.scrollTo = () => {}
dom.window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })

const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
let root: Root | undefined
let container: HTMLDivElement | undefined
let router: ReturnType<typeof import('react-router-dom')['createMemoryRouter']> | undefined

async function mountBook(entry = '/architecture') {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
  const { ArchitecturePage } = await import('../src/pages/ArchitecturePage')
  router = createMemoryRouter([{ path: '/architecture', element: <ArchitecturePage /> }], { initialEntries: [entry] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<RouterProvider router={router!} />))
}

async function language(next: 'zh-CN' | 'en-US') {
  const { setLanguage } = await import('../src/i18n')
  await act(async () => setLanguage(next))
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = container!.querySelector<T>(selector)
  assert.ok(found, `Expected ${selector}`)
  return found
}

async function click(target: HTMLElement) {
  await act(async () => target.click())
}

async function press(target: HTMLElement, key: string) {
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    // Radix defers roving focus until after the key event.
    await new Promise(resolve => setTimeout(resolve, 5))
  })
}

function productCopy() {
  return [container!.textContent, ...[...container!.querySelectorAll('[aria-label], [title], [placeholder], [alt]')]
    .flatMap(node => ['aria-label', 'title', 'placeholder', 'alt'].map(name => node.getAttribute(name) ?? ''))].join('\n')
}

afterEach(async () => {
  await act(async () => root?.unmount())
  router?.dispose()
  container?.remove()
  root = undefined
  router = undefined
  container = undefined
  await language('zh-CN')
})

test('chapters turn through next, contents and previous controls, and router history restores the chapter', async () => {
  await mountBook()
  const destinations = [...container!.querySelectorAll<HTMLAnchorElement>('.ca-chapters a')]
    .map(link => new URL(link.href).hash || '#overview')
  assert.deepEqual(destinations, ['#overview', '#idea', '#materials', '#storage', '#retrieval', '#paths', '#evidence', '#system'])
  assert.equal(element<HTMLButtonElement>('.book-prev').disabled, true)
  assert.match(element('#book-heading').textContent!, /知识有形/)

  await click(element('.book-start'))
  assert.equal(router!.state.location.hash, '#idea')
  assert.match(element('#book-heading').textContent!, /能被找到/)
  assert.equal(document.activeElement, element('#book-heading'))

  await click(element('.book-next'))
  assert.equal(router!.state.location.hash, '#materials')
  assert.match(element('[aria-current="page"]').textContent!, /分模态解析/)

  await click(element('.book-next'))
  assert.equal(router!.state.location.hash, '#storage')
  assert.equal(document.activeElement, element('#book-heading'))
  await click(element('.book-next'))
  assert.equal(router!.state.location.hash, '#retrieval')
  assert.ok(element('.ca-sys-channel-list'))
  await click(element('.book-next'))
  assert.equal(router!.state.location.hash, '#paths')

  await click(element('.ca-chapters a[href$="#evidence"]'))
  assert.equal(router!.state.location.hash, '#evidence')
  assert.equal(document.activeElement, element('#book-heading'))

  await click(element('.book-prev'))
  assert.equal(router!.state.location.hash, '#paths')
  await act(async () => { await router!.navigate(-1) })
  assert.equal(router!.state.location.hash, '#evidence')
  assert.match(element('#book-heading').textContent!, /沿着引用/)
  assert.equal(document.activeElement, element('#book-heading'))
})

test('legacy module and journey links open their chapters and preserve the Pi path', async () => {
  await mountBook('/architecture?path=pi#modules')
  assert.match(element('#book-heading').textContent!, /看清系统/)
  const moduleAppendix = [...container!.querySelectorAll<HTMLDetailsElement>('.book-appendix')]
    .find(details => details.querySelector('summary')?.textContent?.includes('模块与源码'))
  assert.ok(moduleAppendix?.open, 'The old module deep link should reveal its appendix')
  assert.match(element('.atlas-module-trigger[aria-selected="true"]').textContent!, /Pi 运行时/)

  await act(async () => { await router!.navigate('/architecture?path=pi#flow-lab') })
  assert.match(element('#book-heading').textContent!, /沿着引用/)
  assert.ok(element('.ca-story-citation'))
  await click(element('.ca-chapters a[href$="#paths"]'))
  assert.equal(router!.state.location.search, '?path=pi')
  assert.match(element('.ca-story-mode-controls button[aria-pressed="true"]').textContent!, /Pi Agent/)

  await click(element('.ca-story-mode-controls button'))
  assert.equal(router!.state.location.search, '')
  assert.equal(router!.state.location.hash, '#paths')
  assert.match(element('.ca-story-mode-controls button[aria-pressed="true"]').textContent!, /Direct/)
})

test('material tabs follow keyboard focus and expose the matching reading panel', async () => {
  await mountBook('/architecture#materials')
  const tabs = [...container!.querySelectorAll<HTMLButtonElement>('.ca-ps-tabs [role="tab"]')]
  assert.equal(tabs.length, 5)
  assert.deepEqual(tabs.map(tab => tab.textContent), ['文档', '表格', '图片', '音频', '视频'])
  assert.match(element('.ca-ps-panel[data-state="active"]').textContent!, /source\[start:end\]/)
  await act(async () => tabs[0].focus())
  await press(tabs[0], 'ArrowRight')
  assert.equal(document.activeElement, tabs[1])
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true')
  assert.equal(tabs[0].getAttribute('aria-selected'), 'false')
  assert.match(element('.ca-ps-panel[data-state="active"]').textContent!, /row_block/)
  assert.match(element('.ca-ps-panel[data-state="active"]').textContent!, /表头/)
  assert.equal(element('.ca-ps-panel[data-state="active"]').getAttribute('aria-labelledby'), tabs[1].id)

  await press(tabs[1], 'ArrowRight')
  assert.equal(document.activeElement, tabs[2])
  assert.match(element('.ca-ps-panel[data-state="active"]').textContent!, /CLIP/)

  await press(tabs[2], 'End')
  assert.equal(document.activeElement, tabs[4])
  assert.match(element('.ca-ps-panel[data-state="active"]').textContent!, /scene_shot_asr_v4/)
  assert.match(element('.ca-ps-panel[data-state="active"]').textContent!, /关键帧/)
  await press(tabs[4], 'ArrowLeft')
  assert.equal(document.activeElement, tabs[3])
  assert.match(element('.ca-ps-panel[data-state="active"]').textContent!, /CLAP/)
  assert.match(element('.ca-ps-panel[data-state="active"]').textContent!, /文件级/)
  await press(tabs[3], 'Home')
  assert.equal(document.activeElement, tabs[0])
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true')
})

test('retrieval channels expose distinct clues and limits with keyboard navigation', async () => {
  await mountBook('/architecture#retrieval')
  const tabs = [...container!.querySelectorAll<HTMLButtonElement>('.ca-sys-channel-list [role="tab"]')]
  assert.equal(tabs.length, 5)
  const activePanel = () => element('.ca-sys-channel-explanation[data-state="active"]')
  assert.match(tabs[0].textContent!, /Dense/)
  assert.match(activePanel().textContent!, /意义相近|语义相近/)
  await act(async () => tabs[0].focus())
  await press(tabs[0], 'ArrowDown')
  assert.equal(document.activeElement, tabs[1])
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true')
  assert.equal(activePanel().getAttribute('aria-labelledby'), tabs[1].id)
  assert.match(activePanel().textContent!, /BGE-M3/)
  assert.match(activePanel().textContent!, /精确字符串/)

  await press(tabs[1], 'ArrowDown')
  assert.equal(document.activeElement, tabs[2])
  assert.match(activePanel().textContent!, /CLIP/)
  assert.match(activePanel().textContent!, /原图/)
  await press(tabs[2], 'ArrowDown')
  assert.equal(document.activeElement, tabs[3])
  assert.match(activePanel().textContent!, /CLAP/)
  assert.match(activePanel().textContent!, /文件级/)
  await press(tabs[3], 'End')
  assert.equal(document.activeElement, tabs[4])
  assert.match(activePanel().textContent!, /ASR/)
  assert.match(activePanel().textContent!, /Dense \/ Sparse/)
  assert.match(activePanel().textContent!, /所属镜头/)
  await press(tabs[4], 'Home')
  assert.equal(document.activeElement, tabs[0])
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true')
})

test('citations open actual retrieved passages, keep original links and restore focus on close or Escape', async () => {
  await mountBook('/architecture#evidence')
  const citations = [...container!.querySelectorAll<HTMLButtonElement>('.ca-story-citation')]
  assert.equal(citations.length, 2)
  const pageText = productCopy()
  assert.match(pageText, /2026-10-25/)
  assert.match(pageText, /真实命中 chunk 18 与 chunk 17/)
  assert.match(pageText, /回答为基于命中材料编写的引用示例/)
  for (const [index, citation] of citations.entries()) {
    await click(citation)
    const source = element('#ca-citation-source')
    assert.equal(document.activeElement, source)
    assert.equal(citation.getAttribute('aria-expanded'), 'true')
    assert.equal(citation.getAttribute('aria-controls'), source.id)
    assert.match(source.textContent!, index === 0 ? /对景与框景 · chunk 18/ : /借景 · chunk 17/)
    assert.match(source.textContent!, index === 0 ? /将框内的景物裁剪成一幅天然的图画/ : /拓展空间的层次与意境/)
    assert.ok(source.querySelector<HTMLAnchorElement>('a')?.href.endsWith('/architecture/atlas/garden-notes.md'))
    if (index === 0) await click(element('#ca-citation-source button[aria-label="收起来源并返回引用"]'))
    else await press(source, 'Escape')
    assert.equal(document.activeElement, citation)
    assert.equal(citation.getAttribute('aria-expanded'), 'false')
  }
})

test('saved retrieval examples change the source snapshot without pretending to be channel-specific live hits', async () => {
  await mountBook('/architecture#retrieval')
  assert.match(element('.ca-sys-result-folder').textContent!, /粗野主义混凝土/)
  const select = element<HTMLSelectElement>('.ca-sys-query-bar select')
  await act(async () => {
    select.value = 'garden'
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  const results = element('.ca-sys-result-folder')
  assert.match(results.textContent!, /对景与框景/)
  assert.match(results.textContent!, /块 18/)
  assert.match(results.textContent!, /块 17/)
  assert.match(element('.ca-sys-snapshot-note').textContent!, /不是每个通道的独立命中或实时数据/)
  const tabs = [...container!.querySelectorAll<HTMLButtonElement>('.ca-sys-channel-list [role="tab"]')]
  await click(tabs[2])
  assert.match(element('.ca-sys-result-folder').textContent!, /对景与框景/)
})

test('every chapter and its parsing, retrieval, path and citation variants have English product copy', async () => {
  await language('en-US')
  await mountBook()
  const assertEnglish = (where: string) => assert.deepEqual(productCopy().match(/[\u4e00-\u9fff][^\n<>]{0,100}/g), null, `${where}: untranslated product copy`)
  for (const chapter of ['', '#idea', '#materials', '#storage', '#retrieval', '#paths', '#evidence', '#system']) {
    await act(async () => { await router!.navigate(`/architecture${chapter}`) })
    assertEnglish(chapter || 'cover')
    if (chapter === '#materials') {
      for (const tab of container!.querySelectorAll<HTMLButtonElement>('.ca-ps-tabs [role="tab"]')) {
        await act(async () => tab.focus())
        assertEnglish(`material ${tab.textContent}`)
      }
    }
    if (chapter === '#retrieval') {
      for (const tab of container!.querySelectorAll<HTMLButtonElement>('.ca-sys-channel-list [role="tab"]')) {
        await act(async () => tab.focus())
        assertEnglish(`retrieval ${tab.textContent}`)
      }
    }
    if (chapter === '#paths') {
      for (const option of container!.querySelectorAll<HTMLButtonElement>('.ca-story-mode-controls button')) {
        await click(option)
        assertEnglish(`path ${option.textContent}`)
      }
    }
    if (chapter === '#evidence') {
      for (const citation of container!.querySelectorAll<HTMLButtonElement>('.ca-story-citation')) {
        await click(citation)
        assertEnglish(`source ${citation.textContent}`)
      }
    }
  }
  assert.equal(document.title, 'System architecture · Tessmora')
})
