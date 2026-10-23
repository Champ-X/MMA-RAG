/**
 * Real React/Radix DOM regressions without adding a production dependency.
 * From frontend/:
 * npm run test:dom
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
let deleteBehavior: (id: string) => Promise<void> = async () => {}
let externalRemove: (id: string) => void
let externalAdd: (session: ChatSession) => void

const makeSessions = (): ChatSession[] => ['first', 'second', 'third'].map((id, index) => ({
  id, title: ['麝香甜瓜的起源', '中国古典园林', '下一次讨论'][index], messages: [],
  knowledgeBaseIds: [], createdAt: index, updatedAt: index, isActive: index === 0,
}))

function Harness() {
  const [sessions, setSessions] = useState(makeSessions)
  const [deleted, setDeleted] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  externalRemove = (id) => setSessions(previous => previous.filter(session => session.id !== id))
  externalAdd = (session) => setSessions(previous => [...previous, session])
  return <>
    <Sidebar sessions={sessions} activeSessionId={sessions[0]?.id ?? null} activeView="chat"
      collapsed={false} isDark={false} onToggleCollapsed={() => {}} onToggleTheme={() => {}}
      onNewConversation={() => {}} onNavigate={() => {}}
      onSelectConversation={(id) => setSelected((previous) => [...previous, id])}
      onRenameConversation={(id, title) => setSessions(previous => previous.map(session =>
        session.id === id ? { ...session, title, titleEdited: true } : session))}
      onTogglePinnedConversation={(id) => setSessions(previous => previous.map(session =>
        session.id === id ? { ...session, isPinned: !session.isPinned } : session))}
      onDeleteConversation={async (id) => {
        await deleteBehavior(id)
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

const buttonNamed = (name: string) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(candidate =>
    candidate.getAttribute('aria-label') === name || candidate.textContent?.trim() === name)
  assert.ok(button, `Expected button ${name}`)
  return button
}
const selectionBox = (title: string) => {
  const checkbox = document.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="选择会话：${title}"]`)
  assert.ok(checkbox, `Expected selection checkbox for ${title}`)
  return checkbox
}
const checkedTitles = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
  .filter(checkbox => checkbox.checked).map(checkbox => checkbox.getAttribute('aria-label')!.replace('选择会话：', '')).sort()
const bulkDelete = () => {
  const button = document.querySelector<HTMLButtonElement>('.conversation-bulk-delete')
  assert.ok(button)
  return button
}
const openMultiselect = async () => {
  await openMenu()
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(candidate => candidate.textContent === '多选')
  assert.ok(item)
  await click(item)
}

beforeEach(async () => {
  deleteBehavior = async () => {}
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

test('pending cancellation keeps the conversation visible and prevents repeat deletion or dismissal', async () => {
  let finish!: () => void
  let attempts = 0
  deleteBehavior = () => { attempts++; return new Promise<void>(resolve => { finish = resolve }) }
  await openDeletion()
  const confirm = dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!
  await click(confirm)
  assert.equal(confirm.disabled, true)
  assert.match(confirm.textContent!, /正在停止任务/)
  assert.equal(document.querySelectorAll('[data-conversation-select]').length, 3)
  await click(confirm)
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
  })
  assert.ok(dialog())
  assert.equal(attempts, 1)
  await act(async () => { finish(); await settle() })
  assert.equal(dialog(), null)
  assert.deepEqual(callbackIds('deleted'), ['first'])
})

test('cancellation failure preserves the target and exposes a retryable error', async () => {
  deleteBehavior = async () => { throw new Error('服务暂时不可用') }
  await openDeletion()
  await click(dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!)
  assert.match(dialog()!.querySelector('[role="alert"]')!.textContent!, /删除失败，会话已保留.*服务暂时不可用/)
  assert.equal(document.querySelectorAll('[data-conversation-select]').length, 3)
  assert.deepEqual(callbackIds('deleted'), [])
  deleteBehavior = async () => {}
  await click(dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!)
  assert.equal(dialog(), null)
  assert.deepEqual(callbackIds('deleted'), ['first'])
})

test('row multiselect starts with that conversation selected and changes selection without navigating', async () => {
  await openMultiselect()
  assert.equal(selectionBox('麝香甜瓜的起源').checked, true)
  assert.equal(selectionBox('中国古典园林').checked, false)
  await click(selectionBox('中国古典园林'))
  assert.deepEqual(checkedTitles(), ['中国古典园林', '麝香甜瓜的起源'].sort())
  await click(selectionBox('麝香甜瓜的起源'))
  assert.deepEqual(checkedTitles(), ['中国古典园林'])
  assert.deepEqual(callbackIds('selected'), [])
  assert.deepEqual(callbackIds('deleted'), [])
  await click(buttonNamed('取消多选'))
  assert.equal(document.querySelector('input[type="checkbox"]'), null)
  assert.deepEqual(callbackIds('deleted'), [])
})

test('header selection starts empty and select all can be reversed before deletion', async () => {
  await click(buttonNamed('多选会话'))
  assert.deepEqual(checkedTitles(), [])
  assert.equal(bulkDelete().disabled, true)
  await click(buttonNamed('全选'))
  assert.equal(checkedTitles().length, 3)
  assert.equal(bulkDelete().disabled, false)
  await click(buttonNamed('取消全选'))
  assert.deepEqual(checkedTitles(), [])
  assert.equal(bulkDelete().disabled, true)
  await click(buttonNamed('取消多选'))
  assert.deepEqual(callbackIds('deleted'), [])
  assert.deepEqual(callbackIds('selected'), [])
})

test('batch confirmation cancellation retains selection and confirming twice deletes each target once', async () => {
  await openMultiselect()
  await click(selectionBox('中国古典园林'))
  await click(bulkDelete())
  assert.match(dialog()!.textContent!, /删除 2 个会话/)
  assert.equal(document.activeElement?.textContent, '取消')
  assert.deepEqual(callbackIds('deleted'), [])
  await click(document.activeElement as HTMLButtonElement)
  assert.equal(dialog(), null)
  assert.equal(checkedTitles().length, 2)
  await click(bulkDelete())
  const confirm = dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!
  await act(async () => { confirm.click(); confirm.click(); await settle() })
  await settle()
  assert.deepEqual(callbackIds('deleted').sort(), ['first', 'second'])
  assert.deepEqual(callbackIds('selected'), [])
  assert.equal(dialog(), null)
  assert.equal(document.querySelector('input[type="checkbox"]'), null)
  assert.equal(document.querySelectorAll('[data-conversation-select]').length, 1)
})

test('partial batch failure keeps failed targets selected and retries only those conversations', async () => {
  const attempts: string[] = []
  let shouldFail = true
  deleteBehavior = async id => {
    attempts.push(id)
    if (id === 'second' && shouldFail) throw new Error('服务暂时不可用')
  }
  await click(buttonNamed('多选会话'))
  await click(buttonNamed('全选'))
  await click(bulkDelete())
  await click(dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!)
  assert.deepEqual(callbackIds('deleted').sort(), ['first', 'third'])
  assert.deepEqual([...attempts].sort(), ['first', 'second', 'third'])
  assert.ok(dialog())
  assert.match(dialog()!.querySelector('[role="alert"]')!.textContent!, /服务暂时不可用/)
  assert.deepEqual(checkedTitles(), ['中国古典园林'])
  shouldFail = false
  await click(dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!)
  assert.equal(attempts.filter(id => id === 'second').length, 2)
  assert.equal(attempts.filter(id => id === 'first').length, 1)
  assert.equal(attempts.filter(id => id === 'third').length, 1)
  assert.deepEqual(callbackIds('deleted').sort(), ['first', 'second', 'third'])
  assert.equal(dialog(), null)
  assert.equal(document.querySelector('input[type="checkbox"]'), null)
})

test('pending batch deletion cannot be dismissed or submitted twice while tasks stop', async () => {
  let finish!: () => void
  const attempts: string[] = []
  deleteBehavior = id => {
    attempts.push(id)
    return attempts.length === 1 ? new Promise<void>(resolve => { finish = resolve }) : Promise.resolve()
  }
  await openMultiselect()
  await click(selectionBox('中国古典园林'))
  await click(bulkDelete())
  const confirm = dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!
  await click(confirm)
  assert.equal(confirm.disabled, true)
  assert.equal(attempts.length, 1)
  assert.deepEqual(callbackIds('deleted'), [])
  await click(confirm)
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
  })
  assert.ok(dialog())
  assert.equal(attempts.length, 1)
  await act(async () => { finish(); await settle() })
  await settle()
  assert.deepEqual([...attempts].sort(), ['first', 'second'])
  assert.deepEqual(callbackIds('deleted').sort(), ['first', 'second'])
  assert.equal(dialog(), null)
})

test('batch confirmation skips removed targets and never includes newly added conversations', async () => {
  await click(buttonNamed('多选会话'))
  await click(buttonNamed('全选'))
  await click(bulkDelete())
  await act(async () => {
    externalRemove('first')
    externalAdd({ ...makeSessions()[0], id: 'new', title: '确认期间的新会话' })
    await settle()
  })
  assert.equal(selectionBox('确认期间的新会话').checked, false)
  await click(dialog()!.querySelector<HTMLButtonElement>('.conversation-delete-confirm')!)
  assert.deepEqual(callbackIds('deleted').sort(), ['second', 'third'])
  assert.equal(dialog(), null)
  const remaining = document.querySelectorAll('[data-conversation-select]')
  assert.equal(remaining.length, 1)
  assert.match(remaining[0].textContent!, /确认期间的新会话/)
})
