/** CSS Highlight is mocked; native jsdom exercises the unsupported fallback. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { activateCitationContext } from '../src/components/chat/citationContextHighlight'

const name = 'tessmora-citation-context'
const cite = (id = 'cite', source = 'knowledge') => `<button id="${id}" data-source="${source}">[1]<span>source action</span></button>`
class TestHighlight {
  ranges: Range[]
  constructor(...ranges: Range[]) { this.ranges = ranges }
}

function fixture(content: string, customHighlights = true) {
  const dom = new JSDOM(`<div class="rag-markdown">${content}</div>`)
  const doc = dom.window.document
  const registry = new Map<string, unknown>()
  if (customHighlights) {
    Object.defineProperty(dom.window, 'CSS', { configurable: true, value: { highlights: registry } })
    Object.defineProperty(dom.window, 'Highlight', { configurable: true, value: TestHighlight })
  }
  const anchor = (id = 'cite') => doc.getElementById(id)!
  const highlightedText = () => (registry.get(name) as TestHighlight | undefined)?.ranges.map(range => range.toString()).join('')
  return { dom, doc, registry, anchor, highlightedText }
}

test('highlights only the cited paragraph prose, preserving inline formatting, links and React text nodes', () => {
  const { doc, registry, anchor, highlightedText } = fixture(`<p>unrelated</p><p id="scope">Lead <strong>bold</strong> <a href="/source">linked text</a> <code>inline code</code>${cite()} end.</p><p>another paragraph</p>`)
  const originalNodes = [...doc.querySelector('#scope')!.childNodes]
  const before = doc.body.innerHTML
  const unrelated = { anotherFeature: true }
  registry.set('find-results', unrelated)
  const cleanup = activateCitationContext(anchor())
  assert.equal(highlightedText(), 'Lead bold linked text inline code end.')
  const highlight = registry.get(name) as TestHighlight
  assert.ok(highlight.ranges.length > 1)
  for (const range of highlight.ranges) {
    assert.equal(range.startContainer.nodeType, 3)
    assert.equal(range.endContainer.nodeType, 3)
    assert.ok(!anchor().contains(range.startContainer))
  }
  assert.equal(doc.body.innerHTML, before)
  assert.ok(originalNodes.every((node, index) => node === doc.querySelector('#scope')!.childNodes[index]))
  assert.equal(doc.querySelector('[data-source-context]'), null, 'Native highlights need no DOM attribute')
  cleanup()
  cleanup()
  assert.equal(registry.has(name), false)
  assert.equal(registry.get('find-results'), unrelated)
})

test('a list-item context excludes nested lists, nested blocks, controls and media text', () => {
  const { anchor, highlightedText } = fixture(`<ul><li id="scope">Own <em>prose</em>${cite()} tail.<button>other action</button><ul><li>nested item</li></ul><div>nested block</div><span class="answer-media-group"><span>image caption</span><img src="/photo.jpg"></span><span hidden>hidden text</span><svg><text>vector label</text></svg></li><li>sibling item</li></ul>`)
  const cleanup = activateCitationContext(anchor())
  assert.equal(highlightedText(), 'Own prose tail.')
  cleanup()
})

test('the nearest nested paragraph wins without highlighting its parent list item', () => {
  const { anchor, highlightedText } = fixture(`<ul><li>parent text<p>Inner ${cite()} paragraph.</p><p>other paragraph</p><ul><li>descendant</li></ul></li></ul>`)
  const cleanup = activateCitationContext(anchor())
  assert.equal(highlightedText(), 'Inner  paragraph.')
  cleanup()
})

test('table cells and headings stay within their own semantic boundary', () => {
  for (const content of [
    `<table><tr><td>cell ${cite()} content</td><td>other cell</td></tr></table>`,
    `<table><tr><th>cell ${cite()} content</th><th>other header</th></tr></table>`,
    `<h3>cell ${cite()} content</h3><p>following text</p>`,
  ]) {
    const { anchor, highlightedText } = fixture(content)
    const cleanup = activateCitationContext(anchor())
    assert.equal(highlightedText(), 'cell  content')
    cleanup()
  }
})

test('switching citations replaces our highlight and old cleanup cannot erase the current context', () => {
  const { anchor, registry, highlightedText } = fixture(`<p>first${cite('first')}</p><p>second${cite('second', 'attachment')}</p>`)
  const firstCleanup = activateCitationContext(anchor('first'))
  const firstHighlight = registry.get(name)
  const secondCleanup = activateCitationContext(anchor('second'))
  assert.notEqual(registry.get(name), firstHighlight)
  firstCleanup()
  assert.equal(highlightedText(), 'second')
  secondCleanup()
  assert.equal(registry.has(name), false)
})

test('streamed text replacement gets fresh ranges on reactivation without retaining detached content', () => {
  const { doc, anchor, registry, highlightedText } = fixture(`<p id="scope">old${cite()}</p>`)
  const firstCleanup = activateCitationContext(anchor())
  const oldRange = (registry.get(name) as TestHighlight).ranges[0]
  const oldText = doc.querySelector('#scope')!.firstChild!
  oldText.replaceWith(doc.createTextNode('new streamed prose'))
  const secondCleanup = activateCitationContext(anchor())
  assert.equal(highlightedText(), 'new streamed prose')
  assert.ok((registry.get(name) as TestHighlight).ranges.every(range => range !== oldRange && range.startContainer.isConnected))
  firstCleanup()
  assert.equal(highlightedText(), 'new streamed prose')
  secondCleanup()
})

test('unsupported browsers mark only a simple scope and restore attributes on switch and cleanup', () => {
  const { doc, anchor } = fixture(`<p id="one" data-source-context="existing">one ${cite('first')}</p><p id="two">two ${cite('second')}</p>`, false)
  const firstCleanup = activateCitationContext(anchor('first'))
  assert.equal(doc.querySelector('#one')!.getAttribute('data-source-context'), 'true')
  const secondCleanup = activateCitationContext(anchor('second'))
  assert.equal(doc.querySelector('#one')!.getAttribute('data-source-context'), 'existing')
  assert.equal(doc.querySelector('#two')!.getAttribute('data-source-context'), 'true')
  firstCleanup()
  assert.equal(doc.querySelector('#two')!.getAttribute('data-source-context'), 'true')
  secondCleanup()
  assert.equal(doc.querySelector('#two')!.hasAttribute('data-source-context'), false)
})

test('unsupported complex contexts never shade nested list items or media', () => {
  for (const content of [
    `<ul><li>Own${cite()}<ul><li>nested item</li></ul></li></ul>`,
    `<p>Own${cite()}<img aria-hidden="true" src="/photo.jpg"></p>`,
    `<li>Own${cite()}<div class="answer-media-group">media caption</div></li>`,
  ]) {
    const { doc, anchor } = fixture(content, false)
    activateCitationContext(anchor())()
    assert.equal(doc.querySelector('[data-source-context]'), null)
  }
})

test('invalid, detached, media and out-of-markdown anchors never highlight an entire answer', () => {
  for (const content of [
    `<div>no prose block${cite()}</div>`,
    `<p>wrong source${cite('cite', 'other')}</p>`,
    `<p>not a button<span id="cite" data-source="knowledge">1</span></p>`,
    `<div class="answer-media-group"><p>media ${cite()}</p></div>`,
    `<li>outer prose<div>nested block ${cite()}</div></li>`,
    `<li>outer prose<pre>code sample ${cite()}</pre></li>`,
    `<p hidden>hidden prose${cite()}</p>`,
    `<p>${cite()}</p>`,
  ]) {
    const { doc, anchor, registry } = fixture(content)
    activateCitationContext(anchor())()
    assert.equal(registry.has(name), false)
    assert.equal(doc.querySelector('[data-source-context]'), null)
  }
  const { doc, anchor, registry } = fixture(`<p>prose${cite()}</p>`)
  const cleanup = activateCitationContext(anchor())
  anchor().remove()
  activateCitationContext(doc.createElement('button'))()
  assert.equal(registry.has(name), false, 'An invalid next anchor clears the previous context')
  cleanup()
  const detachedMarkdown = doc.querySelector('.rag-markdown')!
  detachedMarkdown.classList.remove('rag-markdown')
  detachedMarkdown.innerHTML = `<p>outside${cite()}</p>`
  activateCitationContext(anchor())()
  assert.equal(registry.has(name), false)
})

test('a partially implemented Highlight API falls back without replacing text nodes', () => {
  const { dom, doc, anchor } = fixture(`<p>prose ${cite()}</p>`)
  Object.defineProperty(dom.window, 'Highlight', { value: class { constructor() { throw new Error('unsupported') } } })
  const text = doc.querySelector('p')!.firstChild
  const cleanup = activateCitationContext(anchor())
  assert.equal(doc.querySelector('p')!.getAttribute('data-source-context'), 'true')
  assert.equal(doc.querySelector('p')!.firstChild, text)
  cleanup()
})
