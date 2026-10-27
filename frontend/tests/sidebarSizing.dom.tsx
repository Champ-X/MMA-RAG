/** Resize/persistence contracts; font measurements and visual checks are separate. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter',
  'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'DocumentFragment', 'localStorage', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
const storageKey = 'tessmora.sidebar.width.v1'
let root: Root | undefined
let container: HTMLDivElement

function viewport(width: number) { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
function sidebar() { return container.querySelector<HTMLElement>('aside')! }
function separator() { return container.querySelector<HTMLElement>('[role="separator"]')! }
function width() { return Number.parseInt(sidebar().style.getPropertyValue('--sidebar-width'), 10) }
async function key(key: string, shiftKey = false) {
  await act(async () => separator().dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })))
}
async function pointer(target: EventTarget, type: string, clientX: number) {
  const event = new MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  await act(async () => target.dispatchEvent(event))
}
async function resize(next: number) {
  await act(async () => { viewport(next); window.dispatchEvent(new Event('resize')) })
}

async function mount(saved?: string, viewportWidth = 1280, collapsed = false) {
  localStorage.clear()
  if (saved != null) localStorage.setItem(storageKey, saved)
  viewport(viewportWidth)
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  const { ConversationSidebar } = await import('../src/components/layout/ConversationSidebar')
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = async (nextCollapsed = collapsed) => act(async () => root!.render(<ConversationSidebar
    sessions={[]} activeSessionId={null} activeView="chat" collapsed={nextCollapsed} isDark={false}
    onToggleCollapsed={() => {}} onToggleTheme={() => {}} onNewConversation={() => {}}
    onSelectConversation={() => {}} onDeleteConversation={() => {}} onRenameConversation={() => {}}
    onTogglePinnedConversation={() => {}} onNavigate={() => {}} />))
  await render()
  sidebar().getBoundingClientRect = () => new dom.window.DOMRect(100, 0, width(), 900)
  return render
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  localStorage.clear()
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

test('old undersized preferences migrate to a brand-safe minimum and persist the corrected width', async () => {
  await mount('224')
  assert.equal(width(), 256)
  assert.equal(separator().getAttribute('aria-valuemin'), '256')
  assert.equal(separator().getAttribute('aria-valuenow'), '256')
  assert.equal(localStorage.getItem(storageKey), '256')
})

test('keyboard resizing respects the same minimum, maximum and fine/coarse steps', async () => {
  await mount()
  assert.equal(width(), 264, 'the default width remains unchanged')
  await key('Home')
  await key('ArrowLeft', true)
  assert.equal(width(), 256)
  await key('ArrowRight')
  assert.equal(width(), 272)
  await key('ArrowRight', true)
  assert.equal(width(), 304)
  await key('End')
  await key('ArrowRight', true)
  assert.equal(width(), 420)
  assert.equal(separator().getAttribute('aria-valuenow'), '420')
  assert.equal(localStorage.getItem(storageKey), '420')
})

test('dragging uses the sidebar origin, clamps both ends and restores body interaction after cancellation', async () => {
  await mount()
  document.body.style.cursor = 'crosshair'
  document.body.style.userSelect = 'text'
  await pointer(separator(), 'pointerdown', 364)
  assert.equal(document.body.style.cursor, 'col-resize')
  await pointer(window, 'pointermove', 110)
  assert.equal(width(), 256)
  await pointer(window, 'pointermove', 1000)
  assert.equal(width(), 420)
  await pointer(window, 'pointercancel', 1000)
  assert.equal(document.body.style.cursor, 'crosshair')
  assert.equal(document.body.style.userSelect, 'text')
  await pointer(window, 'pointermove', 110)
  assert.equal(width(), 420, 'a finished drag must no longer change the stored width')
})

test('window resizing updates the available maximum even when the current sidebar width does not change', async () => {
  await mount('256')
  await resize(800)
  assert.equal(width(), 256)
  assert.equal(separator().getAttribute('aria-valuemax'), '380')
  await key('End')
  assert.equal(width(), 380)
  await resize(700)
  assert.equal(width(), 280)
  assert.equal(separator().getAttribute('aria-valuemax'), '280')
  await resize(650)
  assert.equal(width(), 256)
  assert.equal(localStorage.getItem(storageKey), '256')
})

test('compact and collapsed rails preserve expanded preferences and never accept hidden resize input', async () => {
  const render = await mount('400', 600, true)
  assert.equal(container.querySelector('[role="separator"]'), null)
  assert.equal(width(), 400)
  await render(false)
  await key('Home')
  await pointer(separator(), 'pointerdown', 500)
  await pointer(window, 'pointermove', 200)
  assert.equal(width(), 400)
  assert.equal(document.body.style.cursor, '')
  await resize(1280)
  assert.equal(width(), 400)
  assert.equal(separator().getAttribute('aria-valuenow'), '400')
  assert.equal(localStorage.getItem(storageKey), '400')
})

test('entering compact mode ends an active drag without corrupting the remembered expanded width', async () => {
  await mount('360')
  await pointer(separator(), 'pointerdown', 460)
  await resize(600)
  assert.equal(width(), 360)
  assert.equal(document.body.style.cursor, '')
  await pointer(window, 'pointermove', 200)
  assert.equal(width(), 360)
})

test('an invalid saved preference uses the same viewport bounds as a valid one', async () => {
  await mount('not-a-number', 650)
  assert.equal(width(), 256)
  assert.equal(separator().getAttribute('aria-valuemax'), '256')
  assert.equal(localStorage.getItem(storageKey), '256')
})
