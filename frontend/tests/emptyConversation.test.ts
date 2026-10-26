import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import type { ChatSession } from '../src/store/useChatStore'

const values = new Map<string, string>()
const storage: Storage = {
  get length() { return values.size },
  clear: () => values.clear(),
  getItem: key => values.get(key) ?? null,
  key: index => [...values.keys()][index] ?? null,
  removeItem: key => { values.delete(key) },
  setItem: (key, value) => { values.set(key, value) },
}
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'window', {
  configurable: true, value: Object.assign(new EventTarget(), { localStorage: storage }),
})
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

// Install storage before import so hydration exercises the actual persist middleware.
const { useChatStore } = await import('../src/store/useChatStore')
const { chatApi } = await import('../src/services/api_client')
const originalCreate = chatApi.createSession
const originalHistory = chatApi.getChatHistory
const state = () => useChatStore.getState()
const emptyIds = () => state().sessions.filter(session => session.messages.length === 0).map(session => session.id)

function session(id: string, updatedAt: number, overrides: Partial<ChatSession> = {}): ChatSession {
  return { id, title: id, messages: [], knowledgeBaseIds: [], createdAt: 1, updatedAt, isActive: false, ...overrides }
}

function history(id: string): ChatSession {
  return session(id, 10, { messages: [{ id: `${id}-message`, role: 'user', content: '保留历史', timestamp: 1 }] })
}

function deferredResponse() {
  let resolve!: (value: { success: boolean; sessionId: string }) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<{ success: boolean; sessionId: string }>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  useChatStore.setState({ sessions: [], activeSessionId: null, streamingSessionId: null, isLoading: false, error: null })
  // Clear both browser storage and the persistence helper's pending/latest caches.
  useChatStore.persist.clearStorage()
})

afterEach(() => {
  chatApi.createSession = originalCreate
  chatApi.getChatHistory = originalHistory
})
after(() => {
  useChatStore.persist.clearStorage()
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

test('repeated new-conversation actions reuse the current empty conversation without changing its identity or settings', async () => {
  const id = state().createSession({ title: '准备讨论', knowledgeBaseIds: ['kb-one'] })
  state().updateSessionTitle(id, '保留这个名称')
  state().toggleSessionPinned(id)
  state().updateSessionKnowledgeBases(id, ['kb-one'], 'manual')
  state().updateSessionAgentMode(id, 'agent')
  state().updateSessionPiMode(id, true)
  state().updateSessionPiModel(id, 'chosen-model')
  const previous = structuredClone(state().getSessionById(id))
  let requests = 0
  chatApi.createSession = async () => { requests++; throw new Error('reuse must not contact the server') }

  for (let index = 0; index < 5; index++) assert.equal(state().createSession(), id)
  assert.equal(await state().createSessionFromApi(), id)

  assert.equal(requests, 0)
  assert.deepEqual(state().getSessionById(id), previous)
  assert.deepEqual(emptyIds(), [id])
  assert.equal(state().activeSessionId, id)
})

test('creation prefers the active empty conversation and removes only redundant empty records', () => {
  const active = session('active-empty', 5, { isActive: true })
  const saved = history('saved')
  useChatStore.setState({ sessions: [session('newer-empty', 100), saved, active], activeSessionId: active.id })

  assert.equal(state().createSession(), active.id)
  assert.deepEqual(emptyIds(), [active.id])
  assert.deepEqual(state().getSessionById(saved.id), saved)
  assert.equal(state().sessions.filter(item => item.isActive).length, 1)
})

test('creation from a history conversation opens the most recently updated empty conversation', () => {
  const saved = history('saved')
  useChatStore.setState({ sessions: [session('old-empty', 2), saved, session('latest-empty', 50)], activeSessionId: saved.id })

  assert.equal(state().createSession(), 'latest-empty')
  assert.deepEqual(emptyIds(), ['latest-empty'])
  assert.equal(state().activeSessionId, 'latest-empty')
  assert.deepEqual(state().getSessionById(saved.id), saved)
})

test('a sent message permits one new empty conversation while attachment-only and empty assistant messages are preserved', () => {
  const first = state().createSession()
  state().addMessage(first, { role: 'user', content: '第一条消息' })
  const attachmentOnly = session('attachment-only', 3, { messages: [{
    id: 'attachment-message', role: 'user', content: '', timestamp: 1,
    attachments: [{ id: 'attachment', kind: 'image', name: '原图.png', size: 10 }],
  }] })
  const placeholder = session('assistant-placeholder', 4, { messages: [{
    id: 'assistant-message', role: 'assistant', content: '', timestamp: 1,
  }] })
  useChatStore.setState({ sessions: [...state().sessions, attachmentOnly, placeholder] })

  const next = state().createSession()
  assert.notEqual(next, first)
  assert.equal(state().createSession(), next)
  assert.deepEqual(emptyIds(), [next])
  assert.equal(state().getSessionById(first)!.messages[0].content, '第一条消息')
  assert.deepEqual(state().getSessionById(attachmentOnly.id), attachmentOnly)
  assert.deepEqual(state().getSessionById(placeholder.id), placeholder)
})

test('concurrent API creation requests produce one server request and one empty conversation', async () => {
  const pending = deferredResponse()
  let requests = 0
  chatApi.createSession = () => { requests++; return pending.promise }
  const actions = Array.from({ length: 8 }, () => state().createSessionFromApi())
  await Promise.resolve()
  assert.equal(requests, 1)
  pending.resolve({ success: true, sessionId: 'server-empty' })

  assert.deepEqual(await Promise.all(actions), Array(8).fill('server-empty'))
  assert.deepEqual(emptyIds(), ['server-empty'])
  assert.equal(state().activeSessionId, 'server-empty')
})

test('failed concurrent API creation shares one local fallback and releases the request for a later conversation', async () => {
  const pending = deferredResponse()
  let requests = 0
  chatApi.createSession = () => { requests++; return pending.promise }
  const first = state().createSessionFromApi()
  const repeated = state().createSessionFromApi()
  pending.reject(new Error('offline'))
  const [firstId, repeatedId] = await Promise.all([first, repeated])

  assert.equal(requests, 1)
  assert.equal(firstId, repeatedId)
  assert.deepEqual(emptyIds(), [firstId])
  state().addMessage(firstId, { role: 'user', content: '继续聊天' })
  chatApi.createSession = async () => { requests++; return { success: true, sessionId: 'after-recovery' } }
  assert.equal(await state().createSessionFromApi(), 'after-recovery')
  assert.equal(requests, 2)
  assert.deepEqual(emptyIds(), ['after-recovery'])
})

for (const outcome of ['success', 'failure'] as const) {
  test(`API ${outcome} reuses an empty conversation created locally while the request was pending`, async () => {
    const pending = deferredResponse()
    chatApi.createSession = () => pending.promise
    const request = state().createSessionFromApi()
    const localId = state().createSession({ title: '请求期间的草稿' })
    state().updateSessionPiModel(localId, 'draft-model')
    const previous = structuredClone(state().getSessionById(localId))
    if (outcome === 'success') pending.resolve({ success: true, sessionId: 'late-server-empty' })
    else pending.reject(new Error('request failed'))

    assert.equal(await request, localId)
    assert.deepEqual(emptyIds(), [localId])
    assert.equal(state().getSessionById('late-server-empty'), null)
    assert.deepEqual(state().getSessionById(localId), previous)
  })
}

test('rehydration keeps the active empty conversation even when a newer empty record exists', async () => {
  const active = session('active-empty', 5, { isActive: true, titleEdited: true, title: '我的草稿', piModel: 'saved-model' })
  const saved = history('saved')
  storage.setItem('chat-store', JSON.stringify({ version: 0, state: {
    sessions: [session('newer-empty', 100), active, saved], activeSessionId: active.id,
  } }))

  await useChatStore.persist.rehydrate()

  assert.deepEqual(emptyIds(), [active.id])
  assert.equal(state().activeSessionId, active.id)
  assert.deepEqual(state().getSessionById(active.id), active)
  assert.deepEqual(state().getSessionById(saved.id), saved)
})

test('rehydration keeps the newest empty conversation and preserves the selected history conversation', async () => {
  const saved = { ...history('saved'), isActive: true }
  const newest = session('newest-empty', 90, { titleEdited: true, title: '待讨论', isPinned: true })
  storage.setItem('chat-store', JSON.stringify({ version: 0, state: {
    sessions: [session('old-empty', 3), newest, saved], activeSessionId: saved.id,
  } }))

  await useChatStore.persist.rehydrate()

  assert.deepEqual(emptyIds(), [newest.id])
  assert.equal(state().activeSessionId, saved.id)
  assert.deepEqual(state().getSessionById(newest.id), newest)
  assert.deepEqual(state().getSessionById(saved.id), saved)
  assert.equal(state().createSession(), newest.id)
})

test('loading an empty server history preserves the active empty conversation and other saved messages', async () => {
  const active = session('active-draft', 5, { isActive: true, piModel: 'draft-model' })
  const loaded = history('loaded-history')
  const saved = history('saved-history')
  useChatStore.setState({ sessions: [active, loaded, saved], activeSessionId: active.id })
  chatApi.getChatHistory = async () => ({ success: true, messages: [] })

  await state().loadSessionHistory(loaded.id)

  assert.deepEqual(emptyIds(), [active.id])
  assert.equal(state().activeSessionId, active.id)
  assert.deepEqual(state().getSessionById(active.id), active)
  assert.deepEqual(state().getSessionById(saved.id), saved)
  assert.equal(state().getSessionById(loaded.id), null)
})
