import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { PiRun } from '../src/types/pi'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react-dom/test-utils') as typeof import('react-dom/test-utils')
const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
let root: Root
let container: HTMLDivElement
let hook: ReturnType<typeof import('../src/hooks/usePiAgent').usePiAgent>
let store: typeof import('../src/store/useChatStore').useChatStore
let api: typeof import('../src/services/piAgent').piApi
let original: typeof api

beforeEach(async () => {
  store = (await import('../src/store/useChatStore')).useChatStore
  api = (await import('../src/services/piAgent')).piApi
  original = { ...api }
  api.list = async () => ({ runs: [] })
  store.setState({ sessions: [], activeSessionId: null })
  const { usePiAgent } = await import('../src/hooks/usePiAgent')
  function Harness() { hook = usePiAgent(); return null }
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<Harness />) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  Object.assign(api, original)
})

test('double-submit is rejected while creation is pending and a late response cannot revive a deleted session', async () => {
  let sessionId = ''
  await act(async () => { sessionId = store.getState().createSession() })
  let resolveRun!: (run: PiRun) => void
  let creations = 0
  const cancelled: string[] = []
  api.create = async () => { creations++; return new Promise<PiRun>(resolve => { resolveRun = resolve }) }
  api.closeSession = async () => {}
  api.cancel = async id => { cancelled.push(id); return { id, status: 'cancelled' } as PiRun }
  let pending!: Promise<void>
  await act(async () => { pending = hook.sendMessage('问题', [], sessionId) })
  await assert.rejects(hook.sendMessage('重复点击', [], sessionId), /已有正在提交/)
  assert.equal(creations, 1)
  await act(async () => { await store.getState().deleteSession(sessionId) })
  await act(async () => {
    resolveRun({ id: 'late-run', status: 'running', session_id: sessionId, seq: 1, created_at: 1,
      config: { model: 'fixture' }, request: { message: '问题', client_request_id: 'fixture-key' }, state: {} })
    await pending
  })
  assert.deepEqual(cancelled, ['late-run'])
  assert.equal(store.getState().getSessionById(sessionId), null)
  assert.ok(store.getState().sessions.every(s => s.messages.length === 0))
})

test('switching sessions while create completes preserves the original task and never cancels it', async () => {
  let first = '', second = ''
  await act(async () => {
    first = store.getState().createSession()
    // New-conversation actions reuse an empty session; seed an earlier turn so
    // this fixture still exercises a genuine switch between two conversations.
    store.getState().addMessage(first, { role: 'user', content: '已有问题' })
    store.getState().addMessage(first, { role: 'assistant', content: '已有回答' })
    second = store.getState().createSession()
    store.getState().switchSession(first)
  })
  let resolveRun!: (run: PiRun) => void
  api.create = async () => new Promise<PiRun>(resolve => { resolveRun = resolve })
  api.cancel = async () => { throw new Error('route changes must not cancel paid work') }
  let pending!: Promise<void>
  await act(async () => { pending = hook.sendMessage('问题', [], first) })
  await act(async () => { store.getState().switchSession(second) })
  await act(async () => {
    resolveRun({ id: 'finished-run', status: 'completed', session_id: first, seq: 1, created_at: 1,
      config: { model: 'fixture' }, request: { message: '问题', client_request_id: 'fixture-key' }, state: {} })
    await pending
  })
  assert.equal(store.getState().getSessionById(first)!.messages.length, 4)
  assert.deepEqual(store.getState().getSessionById(first)!.messages.slice(0, 2).map(message => message.content), ['已有问题', '已有回答'])
  assert.equal(store.getState().getSessionById(second)!.messages.length, 0)
  assert.equal(store.getState().activeSessionId, second)
})

test('reply restarts event watching on the same run and retains its evidence and messages', async t => {
  const { initialPiTrace } = await import('../src/lib/piTrace')
  let sessionId = ''
  const paused: PiRun = { id: 'same-run', status: 'needs_input', seq: 2, session_id: 's', created_at: 1,
    config: { model: 'fixture', runtime: 'durable' }, request: { message: 'Compare', client_request_id: 'first' },
    state: { answer: 'Which year?', options: ['2026'] } }
  let input: { request_id: string; message: string; mode: 'reply' | 'steer' }
  const cursors: string[] = []
  api.create = async () => { throw new Error('Continuing must not create another run') }
  api.input = async (id, value) => {
    assert.equal(id, 'same-run'); input = value
    return { run: { ...paused, status: 'queued', seq: 4 }, input: { ...value, status: 'accepted' } }
  }
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    cursors.push(url)
    return new Response([
      ['input.accepted', input], ['run.queued', { reason: 'user_reply' }], ['run.running', {}],
      ['input.applied', input], ['run.completed', { answer: 'The 2026 answer', citations: [] }],
    ].map(([type, data], index) => `data: ${JSON.stringify({ protocol_version: 1, run_id: 'same-run', event_id: String(index + 3),
      seq: index + 3, timestamp: index + 3, type, data })}\n\n`).join(''))
  })
  await act(async () => {
    sessionId = store.getState().createSession()
    store.getState().addMessage(sessionId, { role: 'user', content: 'Compare' })
    store.getState().addMessage(sessionId, { role: 'assistant', content: 'Which year?', pi: { ...initialPiTrace(paused),
      status: 'needs_input', seq: 2, evidence: [{ id: 1, file_name: 'source', modality: 'doc', observation: 'parsed_text', locator: {} }] } })
  })
  assert.ok(hook.waiting)
  await act(async () => { await hook.sendInput('2026') })
  const messages = store.getState().getSessionById(sessionId)!.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[1].pi!.runId, 'same-run')
  assert.equal(messages[1].pi!.seq, 7)
  assert.equal(messages[1].pi!.evidence.length, 1)
  assert.equal(messages[1].content, 'The 2026 answer')
  assert.equal(messages[1].pi!.inputs?.[0].status, 'applied')
  assert.equal(cursors.length, 1)
  assert.match(cursors[0], /after=2/)
})
