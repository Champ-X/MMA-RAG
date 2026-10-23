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

test('language preferences and icon toggle stay synchronized while preserving drafts through hydration', async () => {
  const { LanguageSelect, LanguageToggle } = await import('../src/i18n/LanguageSelect')
  const { useConfigStore } = await import('../src/store/useConfigStore')
  const root = createRoot(document.getElementById('root')!)
  useConfigStore.setState({ hasUnsavedChanges: true })
  const models = useConfigStore.getState().config.models
  await act(async () => root.render(<><LanguageSelect /><LanguageToggle /><textarea defaultValue="中文 original draft" /></>))
  const english = document.querySelector<HTMLInputElement>('input[value="en-US"]')!
  const chinese = document.querySelector<HTMLInputElement>('input[value="zh-CN"]')!
  const toggle = document.querySelector('button')!
  assert.equal(chinese.checked, true)
  assert.equal(english.checked, false)
  assert.equal(toggle.getAttribute('aria-label'), '切换为 English（当前：简体中文）')
  await act(async () => english.click())
  assert.equal(document.documentElement.lang, 'en-US')
  assert.equal(english.checked, true)
  assert.equal(chinese.checked, false)
  const group = document.querySelector('fieldset')!
  assert.equal(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent, 'Interface language')
  assert.equal(toggle.getAttribute('aria-label'), 'Switch to 简体中文 (current: English)')
  assert.equal(toggle.title, toggle.getAttribute('aria-label'))
  assert.equal(JSON.parse(localStorage.getItem('config-store')!).state.config.language, 'en-US')
  assert.equal(useConfigStore.getState().hasUnsavedChanges, true)
  assert.strictEqual(useConfigStore.getState().config.models, models)
  assert.equal(document.querySelector('textarea')?.value, '中文 original draft')
  await act(async () => useConfigStore.persist.rehydrate())
  assert.equal(useConfigStore.getState().config.language, 'en-US')
  await act(async () => toggle.click())
  assert.equal(document.documentElement.lang, 'zh-CN')
  assert.equal(chinese.checked, true)
  assert.equal(english.checked, false)
  assert.equal(JSON.parse(localStorage.getItem('config-store')!).state.config.language, 'zh-CN')
  assert.equal(document.querySelector('textarea')?.value, '中文 original draft')
  await act(async () => root.unmount())
})

test('compact setup selector retains the native accessible selection behavior', async () => {
  const { LanguageSelect } = await import('../src/i18n/LanguageSelect')
  const { useConfigStore } = await import('../src/store/useConfigStore')
  const root = createRoot(document.getElementById('root')!)
  useConfigStore.setState({ hasUnsavedChanges: false })
  await act(async () => root.render(<LanguageSelect compact />))
  const select = document.querySelector('select')!
  assert.equal(select.getAttribute('aria-label'), '界面语言')
  await act(async () => { select.value = 'en-US'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.equal(select.getAttribute('aria-label'), 'Interface language')
  assert.equal(useConfigStore.getState().config.language, 'en-US')
  assert.equal(useConfigStore.getState().hasUnsavedChanges, false)
  await act(async () => useConfigStore.getState().setLanguage('zh-CN'))
  await act(async () => root.unmount())
})
