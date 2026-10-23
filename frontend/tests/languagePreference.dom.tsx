import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost:3001' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')

test('language selector persists the locale, updates document language, and preserves drafts through hydration', async () => {
  const { LanguageSelect } = await import('../src/i18n/LanguageSelect')
  const { useConfigStore } = await import('../src/store/useConfigStore')
  const root = createRoot(document.getElementById('root')!)
  useConfigStore.setState({ hasUnsavedChanges: true })
  const models = useConfigStore.getState().config.models
  await act(async () => root.render(<><LanguageSelect /><textarea defaultValue="中文 original draft" /></>))
  const select = document.querySelector('select')!
  await act(async () => { select.value = 'en-US'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.equal(document.documentElement.lang, 'en-US')
  assert.equal(select.getAttribute('aria-label'), 'Interface language')
  assert.equal(JSON.parse(localStorage.getItem('config-store')!).state.config.language, 'en-US')
  assert.equal(useConfigStore.getState().hasUnsavedChanges, true)
  assert.strictEqual(useConfigStore.getState().config.models, models)
  assert.equal(document.querySelector('textarea')?.value, '中文 original draft')
  await act(async () => useConfigStore.persist.rehydrate())
  assert.equal(useConfigStore.getState().config.language, 'en-US')
  await act(async () => { select.value = 'zh-CN'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.equal(document.documentElement.lang, 'zh-CN')
  assert.equal(select.getAttribute('aria-label'), '界面语言')
  assert.equal(document.querySelector('textarea')?.value, '中文 original draft')
  await act(async () => root.unmount())
})
