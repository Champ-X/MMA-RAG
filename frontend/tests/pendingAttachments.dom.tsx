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
let root: Root, container: HTMLDivElement
let pi: ReturnType<typeof import('../src/hooks/usePiAgent').usePiAgent>
let legacy: ReturnType<typeof import('../src/hooks/useThinkingChain').useThinkingChain>
let store: typeof import('../src/store/useChatStore').useChatStore
let api: typeof import('../src/services/piAgent').piApi
let originalApi: typeof api
const originalFetch = globalThis.fetch
const originalCreateUrl = URL.createObjectURL, originalRevokeUrl = URL.revokeObjectURL
let blobs: Map<string, Blob>, writes: string[], previews: string[], revoked: string[]
let heldIds: Set<string>, releases: Map<string, () => void>

// Exercise the real blob helpers with transaction completion under test control.
// Writes become visible only when their transaction commits, including late ones.
function installStorage() {
  blobs = new Map(); writes = []; heldIds = new Set(); releases = new Map()
  const db = { transaction: () => {
    const tx: { oncomplete?: () => void; objectStore?: () => unknown } = {}
    const commit = (id: string, apply: () => void, hold: boolean) => {
      const finish = () => queueMicrotask(() => { apply(); tx.oncomplete?.() })
      if (hold && heldIds.has(id)) releases.set(id, finish)
      else finish()
    }
    tx.objectStore = () => ({
      put: (blob: Blob, id: string) => { writes.push(id); commit(id, () => blobs.set(id, blob), true) },
      delete: (id: string) => commit(id, () => blobs.delete(id), false),
    })
    return tx
  } }
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: () => {
    const request: { result: typeof db; onsuccess?: () => void } = { result: db }
    queueMicrotask(() => request.onsuccess?.())
    return request
  } } })
}

const audio = () => new dom.window.File(['audio'], 'sample.mp3', { type: 'audio/mpeg' })
const picture = () => new dom.window.File(['image'], 'sample.png', { type: 'image/png' })
async function session() {
  let id = ''
  await act(async () => { id = store.getState().createSession() })
  return id
}

beforeEach(async () => {
  installStorage(); previews = []; revoked = []
  URL.createObjectURL = () => { const url = `blob:test-${previews.length}`; previews.push(url); return url }
  URL.revokeObjectURL = url => { revoked.push(url) }
  globalThis.fetch = async () => { throw new Error('Unexpected network request in attachment lifecycle test') }
  store = (await import('../src/store/useChatStore')).useChatStore
  api = (await import('../src/services/piAgent')).piApi
  originalApi = { ...api }
  api.list = async () => ({ runs: [] })
  api.closeSession = async () => {}
  store.setState({ sessions: [], activeSessionId: null })
  const { usePiAgent } = await import('../src/hooks/usePiAgent')
  const { useThinkingChain } = await import('../src/hooks/useThinkingChain')
  function Harness() { pi = usePiAgent(); legacy = useThinkingChain(); return null }
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<Harness />) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  Object.assign(api, originalApi)
  globalThis.fetch = originalFetch
  URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl
  Reflect.deleteProperty(globalThis, 'indexedDB')
})

test('Pi deletion reclaims a blob whose write finishes after the session disappears', async () => {
  const id = await session()
  heldIds.add('late-blob')
  let creations = 0, pending!: Promise<void>
  api.create = async () => { creations++; throw new Error('Deleted submission must not start') }
  await act(async () => { pending = pi.sendMessage('upload', [], id, [audio()], undefined, undefined, ['late-blob']) })
  await act(async () => { await store.getState().deleteSession(id) })
  assert.equal(blobs.size, 0)
  await act(async () => { releases.get('late-blob')!(); await pending })
  assert.equal(creations, 0)
  assert.equal(blobs.size, 0)
  assert.equal(store.getState().getSessionById(id), null)
})

test('Pi create failure cleans new files and preserves old attachment IDs in another session', async () => {
  const previous = await session()
  const originalBlob = audio()
  blobs.set('old-blob', originalBlob)
  await act(async () => store.getState().addMessage(previous, { role: 'user', content: 'old',
    attachments: [{ id: 'old-blob', kind: 'audio', name: 'old.mp3', size: 5 }] }))
  const id = await session()
  api.create = async () => { throw new Error('fixture create failure') }
  await act(async () => {
    await assert.rejects(pi.sendMessage('retry', [], id, [audio(), audio()], undefined, undefined,
      ['old-blob', 'new-blob']), /fixture create failure/)
  })
  assert.deepEqual(writes, ['new-blob'])
  assert.equal(blobs.get('old-blob'), originalBlob)
  assert.equal(blobs.has('new-blob'), false)
  assert.equal(store.getState().getSessionById(previous)!.messages.length, 1)
})

test('Pi deletion reclaims staged files while the create response is still pending', async () => {
  const id = await session()
  let resolveRun!: (run: PiRun) => void, pending!: Promise<void>
  api.create = async () => new Promise<PiRun>(resolve => { resolveRun = resolve })
  api.cancel = async runId => ({ id: runId, status: 'cancelled' } as PiRun)
  await act(async () => { pending = pi.sendMessage('upload', [], id, [audio()], undefined, undefined, ['waiting-blob']) })
  assert.equal(blobs.has('waiting-blob'), true)
  await act(async () => { await store.getState().deleteSession(id) })
  assert.equal(blobs.has('waiting-blob'), false)
  await act(async () => { resolveRun({ id: 'late-run', status: 'running' } as PiRun); await pending })
  assert.equal(blobs.size, 0)
})

test('published Pi files remain available until their owning session is deleted', async () => {
  const id = await session()
  api.create = async () => ({ id: 'completed-run', status: 'completed', session_id: id, seq: 1,
    created_at: 1, config: { model: 'fixture' }, request: { message: 'upload', client_request_id: 'fixture-key' }, state: {} } as PiRun)
  await act(async () => { await pi.sendMessage('upload', [], id, [audio()], undefined, undefined, ['published-blob']) })
  assert.equal(blobs.has('published-blob'), true)
  assert.equal(store.getState().getSessionById(id)!.messages[0].attachments?.[0].id, 'published-blob')
  await act(async () => { await store.getState().deleteSession(id) })
  assert.equal(blobs.has('published-blob'), false)
})

test('legacy deletion reclaims pending files and image previews without starting a stream', async () => {
  const id = await session()
  heldIds.add('late-audio')
  let pending!: Promise<void>
  await act(async () => {
    pending = legacy.sendMessage('upload', [], id, [picture(), audio()], undefined, undefined, ['picture', 'late-audio'])
  })
  assert.equal(previews.length, 1)
  await act(async () => { await store.getState().deleteSession(id) })
  await act(async () => { releases.get('late-audio')!(); await pending })
  assert.equal(blobs.size, 0)
  assert.deepEqual(revoked, previews)
  assert.equal(legacy.hasActiveStream, false)
})

test('a preparation failure waits for sibling writes before reclaiming every unpublished file', async () => {
  const id = await session()
  heldIds.add('late-audio')
  let calls = 0, pending!: Promise<void>
  URL.createObjectURL = () => {
    if (++calls === 2) throw new Error('fixture preview failure')
    previews.push('blob:first'); return 'blob:first'
  }
  await act(async () => {
    pending = legacy.sendMessage('upload', [], id, [picture(), picture(), audio()], undefined, undefined,
      ['first-picture', 'broken-picture', 'late-audio'])
  })
  await act(async () => {
    const rejected = assert.rejects(pending, /fixture preview failure/)
    releases.get('late-audio')!()
    await rejected
  })
  assert.equal(blobs.size, 0)
  assert.deepEqual(revoked, ['blob:first'])
  assert.equal(store.getState().getSessionById(id)!.messages.length, 0)
})
