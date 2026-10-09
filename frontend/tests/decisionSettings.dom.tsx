/** User-facing settings contracts in jsdom; not browser visual acceptance. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { DecisionConfig, DecisionSettingsResponse, DecisionTestResponse } from '../src/types/decision'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter',
  'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'DocumentFragment', 'localStorage', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const off: DecisionConfig = { provider: 'bailian', model: 'decision-model-preview', intent_mode: 'off',
  rerank_mode: 'off', citation_mode: 'off', citation_strategy: 'per_unit' }
const jev = { ...off, provider: 'typesafe' as const, model: 'jev-1.13.0' }
const response = (config: DecisionConfig, keyConfigured = true): DecisionSettingsResponse => ({
  config: { ...config }, api_key_configured: keyConfigured, model: config.model, intent_diagnostic_available: true,
  providers: [{ id: 'bailian', name: '阿里云百炼', api_key_configured: keyConfigured, endpoint_kind: 'trial', region: 'cn-beijing' },
    { id: 'typesafe', name: 'TypeSafe', api_key_configured: keyConfigured }],
  models: [{ id: 'decision-model-preview', name: 'Decision Preview', provider: 'bailian',
    source_actions: { require: { execution: 'skip', reason: 'model_purpose_not_admitted' }, forbid: { execution: 'skip', reason: 'model_purpose_not_admitted' } } },
  { id: 'jev-1.13.0', name: 'Jev', provider: 'typesafe',
    source_actions: { require: { execution: 'verify', reason: 'admitted_profile' }, forbid: { execution: 'verify', reason: 'admitted_profile' } } }],
})
let root: Root | undefined
let container: HTMLDivElement
let restore: (() => void) | undefined

async function setup(config = off, keyConfigured = true) {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { act } = requireFrontend('react') as typeof import('react')
  const { systemApi } = await import('../src/services/api_client')
  const { DecisionSettings } = await import('../src/components/settings/DecisionSettings')
  const previous = { get: systemApi.getDecisionSettings, put: systemApi.updateDecisionSettings, test: systemApi.testDecisionConnection }
  let stored = { ...config }
  const writes: DecisionConfig[] = []
  const probes: unknown[] = []
  const changes: boolean[] = []
  systemApi.getDecisionSettings = async () => response(stored, keyConfigured)
  systemApi.updateDecisionSettings = async next => { writes.push({ ...next }); stored = { ...next }; return response(stored, keyConfigured) }
  systemApi.testDecisionConnection = async selection => {
    probes.push(selection)
    return { ...selection, requested_model: selection.model, success: true, duration_s: .2 }
  }
  restore = () => { systemApi.getDecisionSettings = previous.get; systemApi.updateDecisionSettings = previous.put; systemApi.testDecisionConnection = previous.test }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<DecisionSettings onHasChangesChange={value => changes.push(value)} />))
  const click = async (text: string) => act(async () => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === text)
    assert.ok(button, `Missing button: ${text}`)
    button.click()
  })
  const toggle = async (name: string) => act(async () => (container.querySelector(`input[name="${name}"]`) as HTMLInputElement).click())
  const submit = async () => act(async () => container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  return { act, writes, probes, changes, systemApi, click, toggle, submit }
}

afterEach(async () => {
  const { act } = requireFrontend('react') as typeof import('react')
  await act(async () => root?.unmount())
  container?.remove()
  restore?.()
  root = undefined
})

test('all-off page has only two task switches and never writes settings on load', async () => {
  const { writes, changes } = await setup()
  assert.equal(container.querySelectorAll('form').length, 1)
  assert.equal(container.querySelectorAll('input[role="switch"]').length, 2)
  assert.equal(container.querySelectorAll('input:checked, details, textarea, input[type="radio"]').length, 0)
  assert.doesNotMatch(container.textContent!, /辅助检索组合|上下文补证|对照记录|试用替换|严格验证|独立意图测试|逐条诊断|批量诊断/)
  assert.ok(container.querySelector('[aria-label="服务商，当前：阿里云百炼"] img'))
  assert.ok(container.querySelector('[aria-label="模型，当前：Decision Preview"] img'))
  assert.deepEqual(writes, [])
  assert.equal(changes.at(-1), false)
  assert.equal((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, true)
})

test('unsupported source check is disabled; citation check remains useful and saves as one batch', async () => {
  const { click, toggle, probes, writes, submit } = await setup()
  const source = container.querySelector('input[name="decision-source-check"]') as HTMLInputElement
  assert.equal(source.disabled, true)
  assert.match(container.textContent!, /此模型暂不支持，可选 Jev/)
  await click('测试连接')
  assert.equal(probes.length, 1)
  assert.equal(writes.length, 0)
  await toggle('decision-citation-check')
  assert.equal(writes.length, 0)
  await submit()
  assert.deepEqual(writes, [{ ...off, citation_mode: 'shadow', citation_strategy: 'batch_choice' }])
  assert.match(container.textContent!, /已保存，对新请求生效/)
})

for (const selection of [off, jev]) test(`legacy ${selection.provider} modes only migrate on explicit save`, async () => {
  const legacy = { ...selection, intent_mode: 'force' as const, rerank_mode: 'force' as const, citation_mode: 'shadow' as const }
  const { writes, changes, submit } = await setup(legacy)
  assert.equal(writes.length, 0)
  assert.equal(changes.at(-1), false)
  assert.match(container.textContent!, /旧版实验设置仍在生效/)
  assert.match(container.textContent!, /应用简化设置/)
  await submit()
  assert.deepEqual(writes, [{ ...legacy, intent_mode: selection.provider === 'typesafe' ? 'adaptive' : 'off',
    rerank_mode: 'off', citation_strategy: 'batch_choice' }])
  assert.doesNotMatch(container.textContent!, /旧版实验设置仍在生效/)
})

test('cancel restores saved switches and does not silently migrate a legacy mode', async () => {
  const { toggle, click, writes, changes } = await setup({ ...jev, rerank_mode: 'assist' })
  await toggle('decision-source-check')
  assert.equal(changes.at(-1), true)
  await click('取消')
  assert.equal(changes.at(-1), false)
  assert.equal(writes.length, 0)
  assert.equal((container.querySelector('input[name="decision-source-check"]') as HTMLInputElement).checked, false)
  assert.match(container.textContent!, /旧版实验设置仍在生效/)
})

test('a provider switch disables an unsupported check and discards the previous connection result', async () => {
  const { act, toggle, click, writes, systemApi, submit } = await setup({ ...jev, intent_mode: 'adaptive' })
  let finish: ((result: DecisionTestResponse) => void) | undefined
  systemApi.testDecisionConnection = () => new Promise(resolve => { finish = resolve })
  await click('测试连接')
  const trigger = container.querySelector('[aria-label="服务商，当前：TypeSafe"]')!
  await act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const option = [...document.querySelectorAll('[role="menuitemradio"]')].find(item => item.textContent?.includes('阿里云百炼')) as HTMLElement
  assert.ok(option)
  await act(async () => option.click())
  await act(async () => finish!({ provider: 'typesafe', model: jev.model, requested_model: jev.model, success: true, duration_s: .1 }))
  assert.doesNotMatch(container.textContent!, /连接正常/)
  assert.equal((container.querySelector('input[name="decision-source-check"]') as HTMLInputElement).checked, false)
  assert.match(container.textContent!, /保存后切换/)
  assert.equal(writes.length, 0)
  await toggle('decision-citation-check')
  await submit()
  assert.deepEqual(writes, [{ ...off, citation_mode: 'shadow', citation_strategy: 'batch_choice' }])
})

test('missing credentials still allow active features to be turned off', async () => {
  const { toggle, submit, writes } = await setup({ ...jev, intent_mode: 'adaptive', citation_mode: 'shadow' }, false)
  await toggle('decision-citation-check')
  await submit()
  assert.equal(writes.length, 0)
  assert.match(container.textContent!, /请先配置所选服务商的密钥/)
  await toggle('decision-source-check')
  await submit()
  assert.deepEqual(writes, [{ ...jev, intent_mode: 'off', citation_mode: 'off' }])
})

test('failed save retains the draft and never claims a successful update', async () => {
  const { systemApi, toggle, submit, changes } = await setup(jev)
  systemApi.updateDecisionSettings = async () => { throw new Error('offline') }
  await toggle('decision-source-check')
  await submit()
  assert.match(container.querySelector('[role="alert"]')!.textContent!, /无法连接服务端/)
  assert.equal((container.querySelector('input[name="decision-source-check"]') as HTMLInputElement).checked, true)
  assert.equal(changes.at(-1), true)
  assert.doesNotMatch(container.textContent!, /已保存，对新请求生效/)
})
