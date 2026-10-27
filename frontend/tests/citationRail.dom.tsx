/** DOM/geometry contracts only; these assertions do not claim visual acceptance. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React, { useState } from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { CitationReference } from '../src/types/sse'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLMediaElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter',
  'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'DocumentFragment', 'localStorage', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
const resizeObservers: Array<{ observed: Set<Element>; notify: () => void }> = []
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class {
    observed = new Set<Element>()
    constructor(public notify: () => void) { resizeObservers.push(this) }
    observe(element: Element) { this.observed.add(element) }
    unobserve(element: Element) { this.observed.delete(element) }
    disconnect() { this.observed.clear() }
  },
})
HTMLMediaElement.prototype.pause = function () {}
const rect = (left: number, top: number, width: number, height: number) => new dom.window.DOMRect(left, top, width, height)
const realRect = HTMLElement.prototype.getBoundingClientRect
HTMLElement.prototype.getBoundingClientRect = function () {
  return this.classList.contains('citation-rail') ? rect(Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0, Number.parseFloat(this.style.width) || 360, 300) : realRect.call(this)
}
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
let root: Root | undefined
let container: HTMLDivElement
const fixtures: HTMLElement[] = []
const settle = () => new Promise(resolve => setTimeout(resolve, 25))
const doc: CitationReference = { id: 9, type: 'doc', file_name: 'evidence.pdf', content: 'This is the original evidence.' }

async function mount(element: React.ReactNode) {
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.append(container)
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  root = createRoot(container)
  await act(async () => root!.render(element))
  await act(async () => { await settle() })
}

function workspaceFixture() {
  const workspace = document.createElement('main')
  workspace.innerHTML = '<div class="chat-messages"><div><div class="chat-message-content"><div class="chat-message-log"><button type="button">[2]</button></div></div></div></div><footer></footer>'
  const viewport = workspace.querySelector<HTMLDivElement>('.chat-messages > div')!
  const anchor = workspace.querySelector<HTMLButtonElement>('button')!
  const composer = workspace.querySelector('footer')!
  document.body.append(workspace)
  fixtures.push(workspace)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
  workspace.getBoundingClientRect = () => rect(240, 60, 1200, 840)
  composer.getBoundingClientRect = () => rect(240, 740, 1200, 160)
  workspace.querySelector<HTMLElement>('.chat-message-log')!.getBoundingClientRect = () => rect(280, 100, 700, 1200)
  viewport.scrollTop = 100
  anchor.getBoundingClientRect = () => rect(620, 260 - (viewport.scrollTop - 100), 20, 20)
  const located: ScrollIntoViewOptions[] = []
  anchor.scrollIntoView = options => { located.push(options as ScrollIntoViewOptions) }
  return { workspace, viewport, anchor, composer, located }
}

function citationContextFixture() {
  const fixture = workspaceFixture()
  const log = fixture.workspace.querySelector('.chat-message-log')!
  log.innerHTML = '<div class="rag-markdown"><p>First supported claim <strong>with emphasis</strong>.<button type="button" data-source="knowledge">[1]</button></p><p>Unrelated paragraph.</p><ul><li>Second supported claim.<button type="button" data-source="attachment">[2]</button></li></ul></div>'
  const markdown = log.querySelector<HTMLElement>('.rag-markdown')!
  const firstScope = markdown.querySelector<HTMLParagraphElement>('p')!
  const secondScope = markdown.querySelector<HTMLLIElement>('li')!
  const firstAnchor = firstScope.querySelector<HTMLButtonElement>('button')!
  const secondAnchor = secondScope.querySelector<HTMLButtonElement>('button')!
  firstAnchor.getBoundingClientRect = () => rect(600, 200, 20, 20)
  secondAnchor.getBoundingClientRect = () => rect(650, 340, 20, 20)
  return { ...fixture, markdown, firstScope, secondScope, firstAnchor, secondAnchor }
}

async function mountCitationContextHarness(fixture: ReturnType<typeof citationContextFixture>) {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  let select: (anchor: HTMLButtonElement) => void = () => undefined
  function Harness() {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
    select = setAnchor
    return <CitationPopover open={Boolean(anchor)} rect={anchor?.getBoundingClientRect() ?? null}
      item={doc} anchor={anchor} workspace={fixture.workspace} composer={fixture.composer}
      onClose={() => setAnchor(null)} onOpenInspector={() => {}} />
  }
  const bind = (anchor: HTMLButtonElement) => { anchor.onclick = () => select(anchor) }
  bind(fixture.firstAnchor)
  bind(fixture.secondAnchor)
  await mount(<Harness />)
  return { bind }
}

afterEach(async () => {
  await act(async () => { root?.unmount(); await settle() })
  root = undefined
  container?.remove()
  fixtures.splice(0).forEach(element => element.remove())
  resizeObservers.length = 0
})

test('opening the right rail preserves the clicked reading position, numbers it for the answer, and focuses close', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  await mount(<CitationPopover open rect={rect(620, 200, 20, 20)} item={doc} displayNumber={2}
    {...fixture} onClose={() => {}} onOpenInspector={() => {}} />)
  assert.equal(fixture.viewport.scrollTop, 160, 'opening reflow must preserve the clicked citation vertical position')
  assert.equal(container.querySelector('.citation-rail__number')?.textContent, '02')
  assert.equal(fixture.anchor.dataset.sourceActive, 'true')
  assert.ok(document.activeElement === container.querySelector('.citation-rail__close'), 'the close button receives focus after layout')
  const panel = container.querySelector<HTMLElement>('[role="dialog"]')!
  assert.equal(panel.getAttribute('aria-modal'), 'false')
  assert.equal(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent, 'evidence.pdf')
  assert.ok(Number.parseFloat(panel.style.left) > fixture.anchor.getBoundingClientRect().right)
  const endpoint = container.querySelector('.citation-connector__origin')!
  const liveAnchor = fixture.anchor.getBoundingClientRect()
  assert.equal(Number(endpoint.getAttribute('cx')), liveAnchor.right + 3,
    'the connector starts at the actual citation, even when it crosses answer text')
  assert.equal(Number(endpoint.getAttribute('cy')), liveAnchor.top + liveAnchor.height * .6,
    'the connector starts inside the actual inline marker, slightly below its center')
  assert.equal(container.querySelector('.citation-connector__lead'), null, 'there is one direct curve rather than a separate margin lead')
  assert.ok(container.querySelector('.citation-connector path')!.getAttribute('d')!.startsWith(`M ${liveAnchor.right + 3} ${liveAnchor.top + liveAnchor.height * .6}`))
  const connector = container.querySelector<SVGSVGElement>('.citation-connector')!
  assert.deepEqual(connector.getAttribute('viewBox')!.split(' ').map(Number), [240, 60, 1200, 840])
  assert.equal(Number.parseFloat(connector.style.top) + Number.parseFloat(connector.style.height), window.innerHeight,
    'the connector spans the visible workspace; the actual composer covers only the line beneath it')
})

test('scrolling retains the complete connector and restores its exact coordinates when the source returns', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  await mount(<CitationPopover open rect={rect(620, 200, 20, 20)} item={doc} {...fixture} onClose={() => {}} onOpenInspector={() => {}} />)
  await act(async () => { fixture.viewport.scrollTop -= 40; fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  const connector = container.querySelector('.citation-connector')!
  const restoredY = fixture.anchor.getBoundingClientRect().top + fixture.anchor.getBoundingClientRect().height * .6
  const restoredPath = connector.querySelector('path')!.getAttribute('d')
  assert.equal(Number(connector.querySelector('.citation-connector__origin')!.getAttribute('cy')), restoredY)
  await act(async () => { fixture.viewport.scrollTop += 500; fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  assert.equal(container.querySelector('.citation-connector'), connector, 'offscreen origins do not remove or remount the SVG')
  const offscreenY = fixture.anchor.getBoundingClientRect().top + fixture.anchor.getBoundingClientRect().height * .6
  assert.equal(Number(connector.querySelector('.citation-connector__origin')!.getAttribute('cy')), offscreenY)
  assert.ok(offscreenY < 60)
  assert.ok(connector.querySelector('path')!.getAttribute('d')!.startsWith(`M 643 ${offscreenY}`), 'the path retains the real offscreen origin rather than snapping to a viewport edge')
  assert.ok(container.querySelector('[role="dialog"]'), 'source details remain available while their anchor is offscreen')
  await act(async () => { fixture.viewport.scrollTop -= 500; fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  assert.equal(Number(connector.querySelector('.citation-connector__origin')!.getAttribute('cy')), restoredY)
  assert.equal(connector.querySelector('path')!.getAttribute('d'), restoredPath)
  await act(async () => root!.unmount())
  root = undefined
  assert.equal(fixture.anchor.hasAttribute('data-source-active'), false)
})

test('locate returns focus to the exact source anchor and close/details actions remain independent', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  const calls = { close: 0, details: 0 }
  await mount(<CitationPopover open rect={rect(620, 200, 20, 20)} item={doc} {...fixture}
    onClose={() => { calls.close++ }} onOpenInspector={() => { calls.details++ }} />)
  await act(async () => container.querySelector<HTMLButtonElement>('.citation-rail__locate')!.click())
  assert.ok(document.activeElement === fixture.anchor, 'locate should focus the source citation')
  assert.deepEqual(fixture.located, [{ block: 'center', behavior: 'instant' }])
  await act(async () => container.querySelector<HTMLButtonElement>('.citation-rail__details')!.click())
  assert.deepEqual(calls, { close: 0, details: 1 })
  await act(async () => container.querySelector<HTMLButtonElement>('.citation-rail__close')!.click())
  assert.deepEqual(calls, { close: 1, details: 1 })
})

test('clicking paragraph and list citations moves the context highlight and closing clears it', async () => {
  const fixture = citationContextFixture()
  await mountCitationContextHarness(fixture)
  assert.equal(fixture.markdown.querySelector('[data-source-context]'), null)
  await act(async () => { fixture.firstAnchor.click(); await settle() })
  assert.equal(fixture.firstScope.dataset.sourceContext, 'true')
  assert.equal(fixture.firstAnchor.dataset.sourceActive, 'true')
  assert.equal(fixture.secondScope.hasAttribute('data-source-context'), false)
  assert.equal(fixture.markdown.querySelectorAll('[data-source-context="true"]').length, 1)
  await act(async () => { fixture.secondAnchor.click(); await settle() })
  assert.equal(fixture.firstScope.hasAttribute('data-source-context'), false, 'the previous paragraph does not remain highlighted')
  assert.equal(fixture.firstAnchor.hasAttribute('data-source-active'), false)
  assert.equal(fixture.secondScope.dataset.sourceContext, 'true', 'the clicked list item owns the new context')
  assert.equal(fixture.secondAnchor.dataset.sourceActive, 'true')
  assert.equal(fixture.markdown.querySelectorAll('[data-source-context="true"]').length, 1)
  assert.equal(fixture.markdown.querySelector('p:nth-child(2)')?.hasAttribute('data-source-context'), false)
  await act(async () => { container.querySelector<HTMLButtonElement>('.citation-rail__close')!.click(); await settle() })
  assert.equal(container.querySelector('.citation-rail'), null)
  assert.equal(fixture.markdown.querySelector('[data-source-context]'), null)
  assert.equal(fixture.secondAnchor.hasAttribute('data-source-active'), false)
})

test('stream replacement clears the detached context and a queued mutation cannot restore it after close', async () => {
  const fixture = citationContextFixture()
  const { bind } = await mountCitationContextHarness(fixture)
  await act(async () => { fixture.firstAnchor.click(); await settle() })
  assert.equal(fixture.firstScope.dataset.sourceContext, 'true')
  const replacement = document.createElement('p')
  replacement.innerHTML = 'Rewritten streaming answer.<button type="button" data-source="knowledge">[1]</button>'
  const replacementAnchor = replacement.querySelector<HTMLButtonElement>('button')!
  replacementAnchor.getBoundingClientRect = () => rect(600, 220, 20, 20)
  bind(replacementAnchor)
  await act(async () => { fixture.firstScope.replaceWith(replacement); await settle() })
  assert.equal(fixture.firstAnchor.isConnected, false)
  assert.equal(fixture.firstScope.hasAttribute('data-source-context'), false, 'streamed replacement releases the old detached block')
  assert.equal(replacement.hasAttribute('data-source-context'), false, 'a new citation is not silently selected by matching text')
  await act(async () => { replacementAnchor.click(); await settle() })
  assert.equal(replacement.dataset.sourceContext, 'true')
  await act(async () => {
    replacement.firstChild!.textContent = 'Another streamed revision.'
    await Promise.resolve() // Let MutationObserver queue its frame before the rail closes.
    container.querySelector<HTMLButtonElement>('.citation-rail__close')!.click()
  })
  await act(async () => { await settle() })
  assert.equal(container.querySelector('.citation-rail'), null)
  assert.equal(replacement.hasAttribute('data-source-context'), false, 'cancelled frames must not resurrect a closed source highlight')
  assert.equal(fixture.markdown.querySelector('[data-source-context]'), null)
})

test('native context ranges refresh after streamed text replacement but remain stable during scroll', async () => {
  const cssDescriptor = Object.getOwnPropertyDescriptor(window, 'CSS')
  const highlightDescriptor = Object.getOwnPropertyDescriptor(window, 'Highlight')
  const registry = new Map<string, { ranges: Range[] }>()
  Object.defineProperty(window, 'CSS', { configurable: true, value: { highlights: registry } })
  Object.defineProperty(window, 'Highlight', { configurable: true, value: class {
    ranges: Range[]
    constructor(...ranges: Range[]) { this.ranges = ranges }
  } })
  try {
    const fixture = citationContextFixture()
    await mountCitationContextHarness(fixture)
    await act(async () => { fixture.firstAnchor.click(); await settle() })
    const firstHighlight = registry.get('tessmora-citation-context')!
    assert.ok(firstHighlight)
    assert.match(firstHighlight.ranges.map(range => range.toString()).join(''), /First supported claim.*with emphasis/)
    assert.doesNotMatch(firstHighlight.ranges.map(range => range.toString()).join(''), /\[1\]|Unrelated|Second supported/)
    assert.equal(fixture.firstScope.hasAttribute('data-source-context'), false, 'native text paint does not add a paragraph background')
    await act(async () => { fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
    assert.equal(registry.get('tessmora-citation-context'), firstHighlight, 'scroll only changes geometry, not text range ownership')
    const streamedText = document.createTextNode('Updated streamed claim.')
    await act(async () => { fixture.firstScope.replaceChildren(streamedText, fixture.firstAnchor); await settle() })
    const refreshedHighlight = registry.get('tessmora-citation-context')!
    assert.notEqual(refreshedHighlight, firstHighlight)
    assert.equal(refreshedHighlight.ranges.map(range => range.toString()).join(''), 'Updated streamed claim.')
    assert.ok(refreshedHighlight.ranges.every(range => range.startContainer.isConnected))
    await act(async () => { container.querySelector<HTMLButtonElement>('.citation-rail__close')!.click(); await settle() })
    assert.equal(registry.size, 0, 'closing removes the active custom highlight')
  } finally {
    if (cssDescriptor) Object.defineProperty(window, 'CSS', cssDescriptor)
    else Reflect.deleteProperty(window, 'CSS')
    if (highlightDescriptor) Object.defineProperty(window, 'Highlight', highlightDescriptor)
    else Reflect.deleteProperty(window, 'Highlight')
  }
})

test('source details preserve the displayed citation number and return focus to its connected trigger on close', async () => {
  const { InspectorDrawer } = await import('../src/components/debug/InspectorDrawer')
  const fixture = workspaceFixture()
  fixture.anchor.focus()
  function Harness() {
    const [open, setOpen] = useState(true)
    return open ? <InspectorDrawer isOpen citations={[doc]} displayNumber={2} returnFocusTarget={fixture.anchor} onClose={() => setOpen(false)} /> : null
  }
  await mount(<Harness />)
  assert.match(document.querySelector('.source-inspector-description')!.textContent!, /引用 2/)
  const citationLabel = [...document.querySelectorAll('.source-inspector-metadata dt')].find(item => item.textContent === '引用编号')!
  assert.equal(citationLabel.nextElementSibling?.textContent, '2', 'visible citation number must match the answer rather than an internal source ID')
  await act(async () => { document.querySelector<HTMLButtonElement>('.source-inspector-close')!.click(); await settle() })
  await act(async () => { await settle() })
  assert.equal(document.querySelector('.source-inspector'), null)
  assert.ok(document.activeElement === fixture.anchor, 'closing details restores the original citation focus')
})

test('source details show original content, adjacent text and metadata expanded on arrival', async () => {
  const { InspectorDrawer } = await import('../src/components/debug/InspectorDrawer')
  const source: CitationReference = { ...doc, file_path: '/library/original-evidence.pdf',
    debug_info: { kb_id: 'kb-source', chunk_id: 'chunk-source', context_window: { prev: 'Previous original paragraph.', next: 'Next original paragraph.' } } }
  await mount(<InspectorDrawer isOpen citations={[source]} displayNumber={2} onClose={() => {}} />)
  assert.equal(document.querySelector('.source-inspector-content .source-inspector-prose')!.textContent, doc.content)
  const sections = [...document.querySelectorAll<HTMLDetailsElement>('.source-inspector-disclosure')]
  assert.equal(sections.length, 2)
  assert.ok(sections.every(section => section.open), 'original context and file metadata are available without another disclosure click')
  assert.match(document.querySelector('.source-inspector-context')!.textContent!, /Previous original paragraph\./)
  assert.match(document.querySelector('.source-inspector-context')!.textContent!, /Next original paragraph\./)
  const metadata = new Map([...document.querySelectorAll('.source-inspector-metadata dt')].map(label => [label.textContent, label.nextElementSibling?.textContent]))
  assert.equal(metadata.get('原始文件名'), 'evidence.pdf')
  assert.equal(metadata.get('来源路径'), '/library/original-evidence.pdf')
  assert.equal(metadata.get('片段标识'), 'chunk-source')
  assert.equal(metadata.get('知识库标识'), 'kb-source')
})

test('image anchors keep their actual side center behind the composer and beyond the screen', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  let imageTop = 600
  fixture.anchor.getBoundingClientRect = () => rect(500, imageTop, 350, 400)
  const mediaGroup = document.createElement('div')
  mediaGroup.className = 'answer-media-group'
  fixture.anchor.replaceWith(mediaGroup)
  mediaGroup.append(fixture.anchor, document.createElement('img'))
  mediaGroup.getBoundingClientRect = () => rect(500, imageTop, 480, 400)
  await mount(<CitationPopover open rect={fixture.anchor.getBoundingClientRect()} item={doc} {...fixture}
    onClose={() => {}} onOpenInspector={() => {}} />)
  const origin = container.querySelector('.citation-connector__origin')!
  assert.equal(Number(origin.getAttribute('cx')), fixture.anchor.getBoundingClientRect().right + 3)
  assert.equal(Number(origin.getAttribute('cy')), 800,
    'neither the composer nor a neighboring image moves the origin away from the selected image center')
  imageTop = 750
  await act(async () => { fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  assert.equal(Number(container.querySelector('.citation-connector__origin')!.getAttribute('cy')), 950)
  assert.ok(container.querySelector('.citation-connector path')!.getAttribute('d')!.startsWith('M 853 950'))
  assert.ok(container.querySelector('[role="dialog"]'), 'a covered image does not remove its readable source card')
})

test('a citation to the left of the composer remains connected below its top instead of being dock-clipped', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  let anchorTop = 690
  fixture.anchor.getBoundingClientRect = () => rect(620, anchorTop, 20, 20)
  fixture.composer.getBoundingClientRect = () => rect(800, 740, 600, 160)
  await mount(<CitationPopover open rect={fixture.anchor.getBoundingClientRect()} item={doc} {...fixture}
    onClose={() => {}} onOpenInspector={() => {}} />)
  assert.ok(Number(container.querySelector('.citation-connector__origin')!.getAttribute('cy')) < 722)
  anchorTop = 704
  await act(async () => { fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  assert.equal(Number(container.querySelector('.citation-connector__origin')!.getAttribute('cy')), 716)
  anchorTop = 705
  await act(async () => { fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  assert.equal(Number(container.querySelector('.citation-connector__origin')!.getAttribute('cy')), 717,
    'a visible marker must remain connected beyond the old card-margin cutoff')
  anchorTop = 730
  await act(async () => { fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  assert.equal(Number(container.querySelector('.citation-connector__origin')!.getAttribute('cy')), 742,
    'the origin does not jump to the old dock clipping boundary')
  anchorTop = 760
  await act(async () => { fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  const origin = container.querySelector('.citation-connector__origin')!
  assert.equal(Number(origin.getAttribute('cy')), 772)
  assert.ok(Number(origin.getAttribute('cx')) < fixture.composer.getBoundingClientRect().left,
    'the actual citation is visible beside the input even though it is below the composer top')
  assert.ok(container.querySelector('.citation-connector path')!.getAttribute('d')!.startsWith('M 643 772'))
  assert.equal(fixture.anchor.dataset.sourceActive, 'true')
})

test('the recorded 650.242–666.242 citation remains connected above the 676.5 composer edge', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  fixture.workspace.getBoundingClientRect = () => rect(240, 60, 1200, 1140)
  fixture.composer.getBoundingClientRect = () => rect(240, 676.5, 1200, 223.5)
  fixture.anchor.getBoundingClientRect = () => rect(620, 650.242, 20, 16)
  await mount(<CitationPopover open rect={fixture.anchor.getBoundingClientRect()} item={doc} {...fixture}
    onClose={() => {}} onOpenInspector={() => {}} />)
  const connector = container.querySelector<SVGSVGElement>('.citation-connector')!
  assert.ok(connector, 'the entirely visible citation from the reported failure must retain its line')
  const origin = connector.querySelector('.citation-connector__origin')!
  assert.equal(Number(origin.getAttribute('cx')), 643)
  assert.ok(Math.abs(Number(origin.getAttribute('cy')) - 659.842) < 0.0001)
  assert.deepEqual(connector.getAttribute('viewBox')!.split(' ').map(Number), [240, 60, 1200, 840],
    'window.innerHeight clips a tall workspace independently from the composer')
  const rail = container.querySelector<HTMLElement>('.citation-rail')!
  assert.ok(Number.parseFloat(rail.style.top) >= 80, 'the source card retains its top breathing room')
  assert.ok(Number.parseFloat(rail.style.top) + rail.getBoundingClientRect().height <= 658.5,
    'source-card spacing remains independent of the connector clipping area')
})

test('scrolling above the screen keeps the same SVG with unmodified source coordinates', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  let anchorTop = 90
  fixture.anchor.getBoundingClientRect = () => rect(620, anchorTop, 20, 20)
  await mount(<CitationPopover open rect={fixture.anchor.getBoundingClientRect()} item={doc} {...fixture}
    onClose={() => {}} onOpenInspector={() => {}} />)
  const connector = container.querySelector('.citation-connector')!
  for (const top of [78, 60, 50, 41, 39, -40, -200]) {
    anchorTop = top
    await act(async () => { fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
    const origin = container.querySelector('.citation-connector__origin')!
    assert.ok(origin, `the path retains its source even at top=${top}`)
    assert.equal(container.querySelector('.citation-connector'), connector)
    assert.equal(Number(origin.getAttribute('cx')), 643)
    const y = Number(origin.getAttribute('cy'))
    assert.equal(y, top + 12, 'the origin follows the source instead of clamping to the top of the screen')
  }
  assert.ok(container.querySelector('.citation-rail'), 'the source card remains open while scrolling')
  for (const top of [-40, 39, 41, 50, 60, 78, 90]) {
    anchorTop = top
    await act(async () => { fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
    assert.equal(container.querySelector('.citation-connector'), connector)
    assert.equal(Number(connector.querySelector('.citation-connector__origin')!.getAttribute('cy')), top + 12)
  }
})

test('detaching the active source removes its connector while preserving the readable source card', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  await mount(<CitationPopover open rect={fixture.anchor.getBoundingClientRect()} item={doc} {...fixture}
    onClose={() => {}} onOpenInspector={() => {}} />)
  assert.ok(container.querySelector('.citation-connector'))
  await act(async () => { fixture.anchor.remove(); fixture.viewport.dispatchEvent(new Event('scroll')); await settle() })
  assert.equal(container.querySelector('.citation-connector'), null, 'a detached node is different from a connected offscreen source')
  assert.ok(container.querySelector('.citation-rail'))
  assert.equal(container.querySelector<HTMLButtonElement>('.citation-rail__locate')!.disabled, true)
  await act(async () => root!.unmount())
  root = undefined
  assert.equal(fixture.anchor.hasAttribute('data-source-active'), false)
})

test('answer reflow updates connector placement without requiring a manual scroll', async () => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const fixture = workspaceFixture()
  let anchorTop = 200
  fixture.anchor.getBoundingClientRect = () => rect(620, anchorTop, 20, 20)
  await mount(<CitationPopover open rect={fixture.anchor.getBoundingClientRect()} item={doc} {...fixture}
    onClose={() => {}} onOpenInspector={() => {}} />)
  const content = fixture.workspace.querySelector('.chat-message-content')!
  const observingContent = resizeObservers.filter(observer => observer.observed.has(content))
  assert.ok(observingContent.length > 0, 'late media loading must invalidate the connector geometry')
  anchorTop = 320
  await act(async () => { observingContent.forEach(observer => observer.notify()); await settle() })
  assert.equal(Number(container.querySelector('.citation-connector__origin')!.getAttribute('cy')), 332)
})

test('attachment sources in both rail and detail drawer never request knowledge-base media URLs', async context => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const { InspectorDrawer } = await import('../src/components/debug/InspectorDrawer')
  const { chatApi } = await import('../src/services/api_client')
  const requests: string[] = []
  for (const method of ['getReferenceImageUrl', 'getReferenceAudioUrl', 'getReferenceVideoUrl'] as const) {
    context.mock.method(chatApi, method, async () => { requests.push(method); throw new Error('Attachments must not request KB media') })
  }
  const fixture = workspaceFixture()
  const attachment: CitationReference = { ...doc, id: 17, type: 'audio', source: 'attachment', attachment_id: 'audio-local',
    pi_run_id: 'run-audio', file_name: 'note.mp3', file_path: '/api/pi/runs/run-audio/sources/original',
    audio_url: 'https://old.test/note.mp3?X-Amz-Date=20200101T000000Z&X-Amz-Expires=60', debug_info: { kb_id: 'must-not-be-used' } }
  await mount(<CitationPopover open rect={rect(620, 200, 20, 20)} item={attachment} displayNumber={3}
    {...fixture} onClose={() => {}} onOpenInspector={() => {}} />)
  assert.ok(container.querySelector('[data-attachment-evidence="audio-local"]'))
  assert.match(container.querySelector('audio')!.getAttribute('src')!, /\/runs\/run-audio\/sources\/original$/)
  await act(async () => root!.render(<InspectorDrawer isOpen citations={[attachment]} displayNumber={3} returnFocusTarget={fixture.anchor} onClose={() => {}} />))
  assert.ok(document.querySelector('.source-inspector [data-attachment-evidence="audio-local"]'))
  assert.match(document.querySelector('.source-inspector-description')!.textContent!, /引用 3/)
  assert.deepEqual(requests, [])
})

test('media errors refresh the correct original once automatically and retain an explicit retry after another failure', async context => {
  const { SourceMediaPreview } = await import('../src/components/chat/SourceMediaPreview')
  const { chatApi } = await import('../src/services/api_client')
  const requests: Array<{ kb_id?: string; file_path: string }> = []
  context.mock.method(chatApi, 'getReferenceImageUrl', async params => {
    requests.push(params)
    return { img_url: `/refreshed-image-${requests.length}.jpg` }
  })
  const item: CitationReference = { ...doc, type: 'image', file_path: '/images/error-retry.jpg', img_url: '/first-image.jpg', debug_info: { kb_id: 'image-retry-kb' } }
  await mount(<SourceMediaPreview item={item} type="image" name="Actual source.jpg" />)
  assert.equal(requests.length, 0, 'ordinary current URLs should load without an extra request')
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
  assert.deepEqual(requests, [{ kb_id: 'image-retry-kb', file_path: '/images/error-retry.jpg' }])
  assert.equal(container.querySelector('img')!.getAttribute('src'), '/refreshed-image-1.jpg')
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
  assert.equal(requests.length, 1, 'a bad source must not enter an automatic refresh loop')
  assert.match(container.querySelector('[role="status"]')!.textContent!, /暂时无法加载/)
  await act(async () => container.querySelector<HTMLButtonElement>('.source-inspector-media-fallback button')!.click())
  assert.equal(requests.length, 2)
  assert.equal(container.querySelector('img')!.getAttribute('src'), '/refreshed-image-2.jpg')
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')))
  assert.equal(container.querySelector('.source-inspector-loading'), null)
  assert.equal(container.querySelector('img')!.alt, 'Actual source.jpg')
})

test('switching the open citation prevents a slow expired-media response from replacing the new source', async context => {
  const { CitationPopover } = await import('../src/components/chat/CitationPopover')
  const { chatApi } = await import('../src/services/api_client')
  let completeOld: (value: { img_url: string }) => void = () => undefined
  context.mock.method(chatApi, 'getReferenceImageUrl', () => new Promise<{ img_url: string }>(resolve => { completeOld = resolve }))
  const fixture = workspaceFixture()
  const original: CitationReference = { ...doc, type: 'image', file_path: '/images/slow-old.jpg', debug_info: { kb_id: 'slow-old-kb' },
    img_url: 'https://old.test/image.jpg?X-Amz-Date=20200101T000000Z&X-Amz-Expires=60' }
  const view = (item: CitationReference) => <CitationPopover open rect={rect(620, 200, 20, 20)} item={item}
    {...fixture} onClose={() => {}} onOpenInspector={() => {}} />
  await mount(view(original))
  assert.match(container.querySelector('.source-inspector-media [role="status"]')!.textContent!, /正在加载/)
  await act(async () => root!.render(view({ ...original, id: 10, file_name: 'New source.jpg', file_path: '/images/new.jpg', img_url: '/new-current.jpg' })))
  assert.equal(container.querySelector('img')!.getAttribute('src'), '/new-current.jpg')
  await act(async () => completeOld({ img_url: '/old-refreshed.jpg' }))
  assert.equal(container.querySelector('img')!.getAttribute('src'), '/new-current.jpg')
  assert.equal(container.querySelector('.citation-rail__identity h2')!.textContent, 'New source.jpg')
})

test('video evidence seeks to its cited segment and clamps a stale segment start to available duration', async context => {
  const { SourceMediaPreview } = await import('../src/components/chat/SourceMediaPreview')
  const pauses: HTMLMediaElement[] = []
  context.mock.method(HTMLMediaElement.prototype, 'pause', function (this: HTMLMediaElement) { pauses.push(this) })
  const item: CitationReference = { ...doc, type: 'video', file_name: 'scene.mp4', video_url: '/scene.mp4', start_sec: 18, end_sec: 24 }
  await mount(<SourceMediaPreview item={item} type="video" name="scene.mp4" />)
  const video = container.querySelector('video')!
  assert.equal(video.autoplay, false)
  assert.match(container.querySelector('.source-inspector-segment')!.textContent!, /00:18 — 00:24/)
  Object.defineProperty(video, 'duration', { configurable: true, value: 45 })
  await act(async () => video.dispatchEvent(new Event('loadedmetadata')))
  assert.equal(video.currentTime, 18)
  video.currentTime = 24
  await act(async () => video.dispatchEvent(new Event('timeupdate')))
  assert.equal(pauses.length, 1)
  assert.ok(pauses[0] === video)
  Object.defineProperty(video, 'duration', { configurable: true, value: 10 })
  await act(async () => video.dispatchEvent(new Event('loadedmetadata')))
  assert.ok(video.currentTime >= 0 && video.currentTime < 10)
})
