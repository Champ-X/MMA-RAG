/** Product-copy and locale-switch contracts; jsdom is not visual acceptance. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter',
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
dom.window.HTMLElement.prototype.scrollTo = () => {}
dom.window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
let root: Root | undefined
let container: HTMLDivElement | undefined
async function mount(element: React.ReactNode) {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(element))
}
async function language(next: 'zh-CN' | 'en-US') {
  const { setLanguage } = await import('../src/i18n')
  await act(async () => setLanguage(next))
}
function visibleProductCopy(element: Element) {
  return [element.textContent, ...[...element.querySelectorAll('[aria-label], [title], [placeholder]')]
    .flatMap(node => ['aria-label', 'title', 'placeholder'].map(name => node.getAttribute(name) ?? ''))].join('\n')
}
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  await language('zh-CN')
})

test('setup sample controls switch language while preserving the source question', async context => {
  const { SetupSample } = await import('../src/components/SetupSample')
  const { MemoryRouter } = await import('react-router-dom')
  const { knowledgeApi } = await import('../src/services/api_client')
  context.mock.method(knowledgeApi, 'getKnowledgeBaseMetadata', async () => ({}))
  localStorage.setItem('tessmora.setup-sample', JSON.stringify({ kbId: 'sample', done: true }))
  context.after(() => localStorage.removeItem('tessmora.setup-sample'))
  await mount(<MemoryRouter><SetupSample /></MemoryRouter>)
  const originalQuestion = container!.querySelector('blockquote')!.textContent
  await language('en-US')
  assert.match(container!.textContent!, /Try a sample document/)
  assert.match(container!.textContent!, /Open the sample knowledge base/)
  assert.match(container!.textContent!, /Copy question/)
  assert.equal(container!.querySelector('blockquote')!.textContent, originalQuestion)
  assert.doesNotMatch(container!.textContent!.replace(originalQuestion!, ''), /[\u4e00-\u9fff]/)
  await language('zh-CN')
  assert.match(container!.textContent!, /试一份小文档/)
})

test('knowledge labels and queued stage semantics update without translating source names', async () => {
  const { StatusBadge, FileHero } = await import('../src/components/knowledge/KnowledgeListHelpers')
  const { KnowledgeContentOverview } = await import('../src/components/knowledge/KnowledgeContentOverview')
  await language('en-US')
  await mount(<><StatusBadge status="queued" stage="queued" variant="subtle" />
    <FileHero file={{ id: 'source', name: '用户原文.pdf', size: '1 KB', date: '2026-10-22', type: 'jpg', status: 'ready', previewUrl: '/source-image' }} />
    <KnowledgeContentOverview files={[]} loading={false} index={{ documents: 0, chunks: 0, images: 0, audio: 0, videoShots: 0, dimensions: { text: 1024, image: 512, audio: 512 } }} /></>)
  assert.match(container!.textContent!, /Queued/)
  assert.doesNotMatch(container!.textContent!, /Waiting in queue/)
  assert.match(container!.textContent!, /Content overview/)
  assert.match(container!.textContent!, /Documents/)
  assert.equal(container!.querySelector('img')?.getAttribute('alt'), '用户原文.pdf')
  await language('zh-CN')
  assert.match(container!.textContent!, /排队中/)
  assert.match(container!.textContent!, /内容概览/)
  assert.equal(container!.querySelector('img')?.getAttribute('alt'), '用户原文.pdf')
})

test('switching language keeps an unsaved knowledge-space draft and focus', async () => {
  const { CreateKbModal } = await import('../src/components/knowledge/KnowledgeListHelpers')
  const calls: unknown[] = []
  await language('zh-CN')
  await mount(<CreateKbModal onClose={() => {}} onCreate={(...args) => { calls.push(args) }} />)
  const input = document.querySelector('input[name="name"]') as HTMLInputElement
  assert.ok(input)
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setValue.call(input, 'My 中文 knowledge'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.focus() })
  await language('en-US')
  assert.equal(input.value, 'My 中文 knowledge')
  assert.equal(document.activeElement, input)
  assert.equal(calls.length, 0)
  assert.match(document.body.textContent!, /New knowledge space/)
  assert.match(document.body.textContent!, /Space name/)
  await language('zh-CN')
  assert.equal(input.value, 'My 中文 knowledge')
  assert.match(document.body.textContent!, /新建素材空间/)
})

test('reachable architecture content and accessibility labels are English in every path', async () => {
  const { ArchitecturePrinciples } = await import('../src/components/architecture/ArchitecturePrinciples')
  const { ArchitectureBlueprint } = await import('../src/components/architecture/ArchitectureBlueprint')
  const { ArchitectureMap } = await import('../src/components/architecture/ArchitectureMap')
  const { EvidenceJourney } = await import('../src/components/architecture/EvidenceJourney')
  const { ArchitectureDetails } = await import('../src/components/architecture/ArchitectureDetails')
  const { ArchitectureRuntime } = await import('../src/components/architecture/ArchitectureRuntime')
  await language('en-US')
  for (const mode of ['direct', 'agent', 'pi'] as const) {
    const content = <><ArchitecturePrinciples /><ArchitectureBlueprint /><ArchitectureMap mode={mode} onModeChange={() => {}} />
      <EvidenceJourney mode={mode} /><ArchitectureDetails mode={mode} /><ArchitectureRuntime mode={mode} /></>
    if (!root) await mount(content)
    else await act(async () => root!.render(content))
    const copy = visibleProductCopy(container!)
    assert.deepEqual(copy.match(/[\u4e00-\u9fff][^\n<>]{0,100}/g), null, `${mode}: untranslated product copy`)
    assert.match(copy, /Evidence|evidence/)
  }
})

test('model settings render translated static task labels and provider names', async () => {
  const { ModelConfig } = await import('../src/components/settings/ModelConfig')
  await language('en-US')
  await mount(<ModelConfig />)
  assert.match(container!.textContent!, /Model routing/)
  assert.match(container!.textContent!, /Query rewriting/)
  assert.match(container!.textContent!, /Answer generation/)
  assert.doesNotMatch(visibleProductCopy(container!), /[\u4e00-\u9fff]/)
})

test('architecture title follows language changes and restores the previous title', async () => {
  const { ArchitecturePage } = await import('../src/pages/ArchitecturePage')
  const { MemoryRouter } = await import('react-router-dom')
  document.title = 'Tessmora workspace'
  await mount(<MemoryRouter initialEntries={['/architecture']}><ArchitecturePage /></MemoryRouter>)
  assert.equal(document.title, '系统架构 · Tessmora')
  await language('en-US')
  assert.equal(document.title, 'System architecture · Tessmora')
  await act(async () => root!.unmount())
  root = undefined
  assert.equal(document.title, 'Tessmora workspace')
})

test('source inspector translates labels while preserving source text that matches catalog keys', async () => {
  const { InspectorDrawer } = await import('../src/components/debug/InspectorDrawer')
  await language('en-US')
  await mount(<InspectorDrawer isOpen onClose={() => {}} citations={[{
    id: 1, type: 'doc', file_name: '设置', content: '显示更多模型', file_path: '/原始/设置',
  }]} />)
  assert.equal(document.querySelector('.source-inspector-title')?.textContent, '设置')
  assert.equal(document.querySelector('.source-inspector-prose')?.textContent, '显示更多模型')
  assert.equal(document.querySelector('.source-inspector-section-heading h3')?.textContent, 'Cited source text')
  assert.match(document.querySelector('.source-inspector-description')!.textContent!, /Citation 1/)
  await language('zh-CN')
  assert.equal(document.querySelector('.source-inspector-prose')?.textContent, '显示更多模型')
  assert.equal(document.querySelector('.source-inspector-section-heading h3')?.textContent, '引用原文')
})

test('model search recalculates translated provider labels without clearing query or focus', async () => {
  const { UnifiedChatModelSearch, getChatModelDisplayName } = await import('../src/components/chat/UnifiedChatModelSearch')
  const model = { registry_id: 'aliyun_bailian:qwen-plus', id: 'qwen-plus', provider: 'aliyun_bailian', name: '阿里云百炼（目录同步）' }
  const selections: string[] = []
  await mount(<UnifiedChatModelSearch variant="dialog" catalog={[model]} loading={false} currentChatModel="" onSelect={id => selections.push(id)} />)
  const input = container!.querySelector('input')!
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setValue.call(input, 'Alibaba Cloud'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.focus() })
  assert.equal(container!.querySelectorAll('[role="option"]').length, 0)
  await language('en-US')
  assert.equal(input.value, 'Alibaba Cloud')
  assert.equal(document.activeElement, input)
  assert.equal(container!.querySelectorAll('[role="option"]').length, 1)
  assert.equal(getChatModelDisplayName(model), 'qwen-plus')
  assert.deepEqual(selections, [])
})
