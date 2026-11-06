import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { PiRun, PiInput } from '../src/types/pi'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react-dom/test-utils') as typeof import('react-dom/test-utils')
const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
let root: Root, container: HTMLDivElement, sessionId: string, messageId: string
let store: typeof import('../src/store/useChatStore').useChatStore
let api: typeof import('../src/services/piAgent').piApi
let original: typeof api
let currentRuntime: 'core' | 'durable' | undefined
let renderHarness: () => Promise<void>
const run: PiRun = { id: 'durable-run', status: 'needs_input', seq: 2, session_id: 'session', created_at: 1,
  config: { model: 'fixture', runtime: 'durable' }, request: { client_request_id: 'original-request', message: 'Compare years' },
  state: { answer: 'Which year?', options: ['2025', '2026'] } }

beforeEach(async () => {
  store = (await import('../src/store/useChatStore')).useChatStore
  api = (await import('../src/services/piAgent')).piApi
  original = { ...api }
  currentRuntime = undefined
  store.setState({ sessions: [], activeSessionId: null })
  const { initialPiTrace } = await import('../src/lib/piTrace')
  sessionId = store.getState().createSession()
  store.getState().addMessage(sessionId, { role: 'assistant', content: 'Which year?', pi: {
    ...initialPiTrace(run), status: 'needs_input', seq: 2, answer: 'Which year?', options: ['2025', '2026'],
    evidence: [{ id: 1, file_name: 'source', modality: 'doc', observation: 'parsed_text', locator: {} }],
  } })
  messageId = store.getState().getSessionById(sessionId)!.messages[0].id
  const { PiProcess } = await import('../src/components/chat/PiProcess')
  function Harness() {
    const trace = store(state => state.sessions[0]?.messages[0]?.pi)
    return trace ? <PiProcess trace={trace} currentRuntime={currentRuntime} /> : null
  }
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  renderHarness = async () => { await act(async () => { root.render(<Harness />) }) }
  await renderHarness()
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove(); Object.assign(api, original)
})

test('clickable clarification options continue the same run and expose queued then applied input', async () => {
  const calls: Array<{ id: string; input: Pick<PiInput, 'request_id' | 'message' | 'mode'> }> = []
  api.input = async (id, input) => {
    calls.push({ id, input })
    return { run: { ...run, status: 'queued', seq: 4 }, input: { ...input, status: 'accepted' } }
  }
  const option = [...container.querySelectorAll('button')].find(button => button.textContent === '2026')!
  await act(async () => { option.click() })
  const textarea = container.querySelector('textarea')!
  assert.equal(textarea.value, '2026')
  assert.equal(document.activeElement, textarea)
  assert.equal(container.querySelector(`label[for="${textarea.id}"]`)?.textContent, '补充回复')
  await act(async () => { container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, run.id)
  assert.deepEqual({ message: calls[0].input.message, mode: calls[0].input.mode }, { message: '2026', mode: 'reply' })
  assert.match(container.textContent || '', /等待应用/)
  const current = store.getState().getSessionById(sessionId)!.messages[0].pi!
  assert.equal(current.evidence.length, 1)
  assert.equal(store.getState().getSessionById(sessionId)!.messages.length, 1)
  const { applyPiEvent } = await import('../src/lib/piTrace')
  await act(async () => {
    let trace = applyPiEvent(current, { protocol_version: 1, run_id: run.id, event_id: '3', seq: 3,
      type: 'run.queued', timestamp: 3, data: { reason: 'user_reply' } })
    trace = applyPiEvent(trace, { protocol_version: 1, run_id: run.id, event_id: '4', seq: 4,
      type: 'input.applied', timestamp: 4, data: calls[0].input })
    store.getState().updateMessage(sessionId, messageId, { pi: trace })
  })
  assert.match(container.textContent || '', /补充已生效/)
  assert.equal(container.querySelector('form'), null)
})

test('unconfirmed delivery keeps its request key across retry and blocks duplicate in-flight submissions', async () => {
  const { submitPiInput } = await import('../src/lib/piInputs')
  const keys: string[] = []
  let finish!: () => void
  api.input = async (_id, input) => {
    keys.push(input.request_id)
    if (keys.length === 1) throw new Error('fixture transport failed')
    await new Promise<void>(resolve => { finish = resolve })
    return { run, input: { ...input, status: 'accepted' } }
  }
  await act(async () => { await assert.rejects(submitPiInput(run.id, '2026', 'reply'), /transport failed/) })
  assert.match(container.textContent || '', /发送未确认/)
  let pending!: Promise<void>
  await act(async () => { pending = submitPiInput(run.id, '2026', 'reply') })
  await assert.rejects(submitPiInput(run.id, '2026', 'reply'), /正在发送补充/)
  await act(async () => { finish(); await pending })
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
})

test('IME confirmation never submits the clarification form and core runs have no resume control', async () => {
  let submissions = 0
  const form = container.querySelector('form')!
  form.addEventListener('submit', () => { submissions++ })
  const textarea = container.querySelector('textarea')!
  await act(async () => {
    textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }))
  })
  assert.equal(submissions, 0)
  await act(async () => {
    const trace = store.getState().getSessionById(sessionId)!.messages[0].pi!
    store.getState().updateMessage(sessionId, messageId, { pi: { ...trace, runtime: 'core' } })
  })
  assert.equal(container.querySelector('form'), null)
  assert.ok(![...container.querySelectorAll('button')].some(button => button.textContent === '继续原任务'))
})

test('a rejected input stays rejected and an explicit retry uses a new request ID', async () => {
  const { submitPiInput } = await import('../src/lib/piInputs')
  const keys: string[] = []
  api.input = async (_id, input) => {
    keys.push(input.request_id)
    return { run, input: { ...input, status: keys.length === 1 ? 'rejected' : 'accepted', reason: 'fixture' } }
  }
  await act(async () => { await assert.rejects(submitPiInput(run.id, '2026', 'reply'), /补充未能应用/) })
  assert.equal(store.getState().getSessionById(sessionId)!.messages[0].pi!.inputs?.[0].status, 'rejected')
  assert.match(container.textContent || '', /补充未应用/)
  await act(async () => { await submitPiInput(run.id, '2026', 'reply') })
  assert.notEqual(keys[0], keys[1])
})

test('core fallback pauses durable clarification controls and restoring durable keeps the draft and evidence', async () => {
  let calls = 0
  api.input = async () => { calls++; throw new Error('No input may be sent while paused') }
  const option = [...container.querySelectorAll('button')].find(button => button.textContent === '2026')!
  await act(async () => { option.click() })
  currentRuntime = 'core'
  await renderHarness()
  assert.equal(container.querySelector('form'), null)
  assert.match(container.textContent || '', /任务已暂停/)
  assert.match(container.textContent || '', /已保留并暂停/)
  assert.equal(calls, 0)
  currentRuntime = 'durable'
  await renderHarness()
  assert.equal(container.querySelector('textarea')?.value, '2026')
  assert.equal(store.getState().getSessionById(sessionId)!.messages[0].pi!.evidence.length, 1)
})

test('persisted runtime pause blocks a direct input even before workspace configuration loads', async () => {
  const { submitPiInput } = await import('../src/lib/piInputs')
  await act(async () => {
    const trace = store.getState().getSessionById(sessionId)!.messages[0].pi!
    store.getState().updateMessage(sessionId, messageId, { pi: { ...trace, runtimePaused: true } })
  })
  let calls = 0
  api.input = async () => { calls++; throw new Error('must not send') }
  await assert.rejects(submitPiInput(run.id, '2026', 'reply'), /此任务已暂停/)
  assert.equal(calls, 0)
  assert.equal(container.querySelector('form'), null)
})
