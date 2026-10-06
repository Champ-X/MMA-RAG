/**
 * Real React/Radix DOM regressions without adding a production dependency.
 * From frontend/:
 * npm install --prefix /tmp/tessmora-sidebar-dom-tests --no-package-lock --no-save jsdom@26.1.0
 * ./node_modules/.bin/esbuild tests/conversationDeletion.dom.tsx --bundle --platform=node --format=cjs --packages=external --loader:.css=empty --outfile=/tmp/tessmora-sidebar-dom-tests/sidebar-tests.cjs
 * NODE_PATH="$PWD/node_modules:/tmp/tessmora-sidebar-dom-tests/node_modules" node --test /tmp/tessmora-sidebar-dom-tests/sidebar-tests.cjs
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React, { useState } from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { ChatSession } from '../src/store/useChatStore'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3001', pretendToBeVisual: true,
})
for (const key of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement',
  'Element', 'Node', 'NodeFilter', 'MutationObserver', 'Event', 'KeyboardEvent', 'CustomEvent']) {
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

let root: Root
let container: HTMLDivElement
let act: typeof import('react-dom/test-utils').act
let Sidebar: typeof import('../src/components/layout/ConversationSidebar').ConversationSidebar
const requireFrontendPackage = createRequire(`${process.cwd()}/package.json`)

const makeSessions = (): ChatSession[] => ['first', 'second', 'third'].map((id, index) => ({
  id, title: ['麝香甜瓜的起源', '中国古典园林', '下一次讨论'][index], messages: [],
  knowledgeBaseIds: [], createdAt: index, updatedAt: index, isActive: index === 0,
}))

function Harness() {
  const [sessions, setSessions] = useState(makeSessions)
  const [deleted, setDeleted] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  return <>
    <Sidebar sessions={sessions} activeSessionId={sessions[0]?.id ?? null} activeView="chat"
      collapsed={false} isDark={false} onToggleCollapsed={() => {}} onToggleTheme={() => {}}
      onNewConversation={() => {}} onNavigate={() => {}}
      onSelectConversation={(id) => setSelected((previous) => [...previous, id])}
      onRenameConversation={(id, title) => setSessions(previous => previous.map(session =>
        session.id === id ? { ...session, title, titleEdited: true } : session))}
      onTogglePinnedConversation={(id) => setSessions(previous => previous.map(session =>
        session.id === id ? { ...session, isPinned: !session.isPinned } : session))}
      onDeleteConversation={(id) => {
        setDeleted((previous) => [...previous, id])
        setSessions((previous) => previous.filter((session) => session.id !== id))
      }}
    />
    <output id="deleted">{JSON.stringify(deleted)}</output>
    <output id="selected">{JSON.stringify(selected)}</output>
  </>
}

const callbackIds = (id: string) => JSON.parse(document.getElementById(id)?.textContent ?? '[]')
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')
const menuTrigger = () => {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="会话操作：麝香甜瓜的起源"]')
  assert.ok(button)
  return button
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const click = async (button: HTMLElement) => {
  await act(async () => { button.click(); await settle() })
  await settle()
}

const openMenu = async () => {
  const trigger = menuTrigger()
  await act(async () => {
    trigger.focus()
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await settle()
  })
  await settle()
  assert.ok(document.querySelector('[role="menu"]'))
  return trigger
}

const openDeletion = async () => {
  const trigger = await openMenu()
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === '删除')
  assert.ok(item)
  await click(item)
  return trigger
}

beforeEach(async () => {
  // Import DOM-aware libraries only after installing the browser environment.
  const client = requireFrontendPackage('react-dom/client') as typeof import('react-dom/client')
  act = (requireFrontendPackage('react-dom/test-utils') as typeof import('react-dom/test-utils')).act
  Sidebar = (await import('../src/components/layout/ConversationSidebar')).ConversationSidebar
  container = document.createElement('div')
  document.body.appendChild(container)
  root = client.createRoot(container)
  await act(async () => { root.render(<Harness />); await settle() })
})

afterEach(async () => {
  await act(async () => { root.unmount(); await settle() })
  container.remove()
})

test('opening confirmation preserves messages and names the target; cancel receives default focus', async () => {
  const trigger = await openDeletion()
  assert.ok(dialog())
  assert.match(dialog()!.textContent ?? '', /麝香甜瓜的起源/)
  const description = document.getElementById(dialog()!.getAttribute('aria-describedby')!)
  assert.match(description?.textContent ?? '', /麝香甜瓜的起源/)
  assert.equal(document.activeElement?.textContent, '取消')
  assert.deepEqual(callbackIds('deleted'), [])
  assert.deepEqual(callbackIds('selected'), [])
  assert.equal(document.querySelectorAll('[data-conversation-select]').length, 3)
  assert.equal(document.querySelector('button button'), null)
  // Activating the initially focused control (the Enter/Space target) cancels.
  await click(document.activeElement as HTMLButtonElement)
  assert.equal(dialog(), null)
  assert.deepEqual(callbackIds('deleted'), [])
  assert.equal(document.activeElement, trigger)
})

test('Escape dismisses confirmation without deletion and returns focus to its trigger', async () => {
  const trigger = await openDeletion()
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
  })
  await settle()
  assert.equal(dialog(), null)
  assert.deepEqual(callbackIds('deleted'), [])
  assert.equal(document.querySelectorAll('[data-conversation-select]').length, 3)
  assert.equal(document.activeElement, trigger)
})

test('dismissing the backdrop is cancellation and never calls deletion', async () => {
  const trigger = await openDeletion()
  const backdrop = document.querySelector<HTMLElement>('.conversation-delete-overlay')!
  await act(async () => {
    backdrop.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await settle()
  })
  await settle()
  assert.equal(dialog(), null)
  assert.deepEqual(callbackIds('deleted'), [])
  assert.equal(document.querySelectorAll('[data-conversation-select]').length, 3)
  assert.equal(document.activeElement, trigger)
})

test('explicit confirmation deletes exactly once and focuses the remaining active conversation', async () => {
  await openDeletion()
  const confirm = dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!
  await act(async () => { confirm.click(); confirm.click(); await settle() })
  await settle()
  assert.deepEqual(callbackIds('deleted'), ['first'])
  assert.deepEqual(callbackIds('selected'), [])
  assert.equal(dialog(), null)
  assert.equal(document.querySelectorAll('[data-conversation-select]').length, 2)
  assert.equal(document.activeElement?.getAttribute('aria-label'), '当前会话：中国古典园林')
})

test('each recent conversation has a decorative line icon and only the current one is highlighted', () => {
  const icons = document.querySelectorAll('.conversation-sidebar-row-icon')
  assert.equal(icons.length, 3)
  assert.equal(document.querySelectorAll('.conversation-sidebar-row-icon[data-active="true"]').length, 1)
  for (const icon of icons) {
    assert.equal(icon.getAttribute('aria-hidden'), 'true')
    const glyph = icon.querySelector('svg')
    assert.ok(glyph)
    assert.equal(glyph.getAttribute('aria-hidden'), 'true')
    assert.equal(glyph.getAttribute('focusable'), 'false')
  }
})
