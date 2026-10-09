import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { StorageValue } from 'zustand/middleware'
import { createChatPersistence } from '../src/lib/chatPersistence'

function fixture() {
  const values = new Map<string, string>()
  let writes = 0
  let serializations = 0
  let streaming = true
  let failWrite = false
  const target = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      writes++
      if (failWrite) throw new Error('QuotaExceededError')
      values.set(name, value)
    },
    removeItem: (name: string) => { values.delete(name) },
  }
  const persistence = createChatPersistence<{ content: string }>({
    isStreaming: () => streaming,
    equals: (left, right) => left.content === right.content,
    getStorage: () => target,
    serialize: (value) => { serializations++; return JSON.stringify(value) },
  })
  return {
    ...persistence, values, target,
    write(content: string) { persistence.storage.setItem('chat-store', { state: { content }, version: 0 }) },
    stop() { streaming = false },
    fail() { failWrite = true },
    recover() { failWrite = false },
    get writes() { return writes },
    get serializations() { return serializations },
  }
}

test('stream checkpoints serialize the latest value once per 500 ms, not once per delta', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const chat = fixture()
  context.after(() => chat.dispose())
  for (let checkpoint = 0; checkpoint < 4; checkpoint++) {
    for (let delta = 0; delta < 250; delta++) chat.write(`${checkpoint}:${delta}`)
    assert.equal(chat.serializations, checkpoint)
    context.mock.timers.tick(499)
    assert.equal(chat.writes, checkpoint)
    context.mock.timers.tick(1)
    assert.equal(chat.serializations, checkpoint + 1)
    assert.equal(chat.writes, checkpoint + 1)
    assert.equal(JSON.parse(chat.values.get('chat-store')!).state.content, `${checkpoint}:249`)
  }
})

test('pending reads see the latest content and terminal state flushes even unchanged persisted fields', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const chat = fixture()
  context.after(() => chat.dispose())
  chat.write('first')
  chat.write('complete answer')
  assert.deepEqual(chat.storage.getItem('chat-store'), { state: { content: 'complete answer' }, version: 0 })
  assert.equal(chat.serializations, 0)
  chat.stop()
  chat.write('complete answer')
  assert.equal(chat.writes, 1)
  assert.equal(chat.serializations, 1)
  context.mock.timers.tick(1000)
  assert.equal(chat.writes, 1, 'terminal flush cancels the trailing checkpoint')
  chat.write('renamed outside stream')
  assert.equal(chat.writes, 2, 'ordinary edits save synchronously')
  chat.write('renamed outside stream')
  assert.equal(chat.writes, 2, 'transient-only store updates do not serialize')
})

test('storage failures preserve live content and allow the next checkpoint to retry', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const chat = fixture()
  context.after(() => chat.dispose())
  chat.fail()
  chat.write('partial')
  assert.doesNotThrow(() => context.mock.timers.tick(500))
  assert.deepEqual(chat.storage.getItem('chat-store'), { state: { content: 'partial' }, version: 0 })
  chat.write('all tokens still arrive')
  chat.stop()
  assert.doesNotThrow(() => chat.write('all tokens still arrive'))
  chat.recover()
  chat.flush()
  assert.equal(JSON.parse(chat.values.get('chat-store')!).state.content, 'all tokens still arrive')
})

test('removing storage cancels queued saves and cannot resurrect deleted data', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const chat = fixture()
  context.after(() => chat.dispose())
  chat.write('pending answer')
  chat.storage.removeItem('chat-store')
  context.mock.timers.tick(1000)
  chat.flush()
  assert.equal(chat.storage.getItem('chat-store'), null)
  assert.equal(chat.writes, 0)
  assert.equal(chat.serializations, 0)
})

test('missing browser storage, inaccessible storage and invalid saved JSON never throw', () => {
  for (const getStorage of [
    () => undefined,
    () => { throw new Error('SecurityError') },
    () => ({ getItem: () => '{invalid', setItem: () => {}, removeItem: () => { throw new Error('denied') } }),
  ]) {
    const chat = createChatPersistence({ isStreaming: () => false, equals: Object.is, getStorage })
    assert.equal(chat.storage.getItem('chat-store'), null)
    assert.doesNotThrow(() => chat.storage.setItem('chat-store', { state: 'answer', version: 0 }))
    assert.doesNotThrow(() => chat.storage.removeItem('chat-store'))
    chat.dispose()
  }
  // The default getter also works when rendered without a window.
  const server = createChatPersistence({ isStreaming: () => false, equals: Object.is })
  assert.doesNotThrow(() => server.storage.setItem('chat-store', { state: 'server', version: 0 }))
  server.dispose()
})

test('pagehide and hidden visibility checkpoint without waiting for the timer', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const page = Object.assign(new EventTarget(), { document })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: page })
  const chat = fixture()
  context.after(() => {
    chat.dispose()
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  chat.write('before hiding')
  document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(chat.writes, 0)
  document.visibilityState = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(chat.writes, 1)
  chat.write('before leaving')
  page.dispatchEvent(new Event('pagehide'))
  assert.equal(chat.writes, 2)
  context.mock.timers.tick(1000)
  assert.equal(chat.writes, 2)
})

test('the real chat store preserves its schema and attachment metadata while batching only stream writes', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const values = new Map<string, string>()
  let writes = 0
  let failWrite = false
  const localStorage = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      if (failWrite) throw new Error('QuotaExceededError')
      writes++
      values.set(name, value)
    },
    removeItem: (name: string) => { values.delete(name) },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const page = Object.assign(new EventTarget(), { localStorage })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: page })
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const { useChatStore } = await import('../src/store/useChatStore')
  const store = useChatStore.getState()
  const sessionId = store.createSession({ title: 'streaming test' })
  store.addMessage(sessionId, { role: 'assistant', content: '', attachments: [
    { id: 'image', name: 'poster.png', kind: 'image', size: 42, previewUrl: 'blob:current', thumbDataUrl: 'data:image/jpeg;base64,a' },
  ] })
  const messageId = store.getSessionById(sessionId)!.messages[0].id
  const beforeStream = writes
  store.setStreamingSessionId(sessionId)
  for (let index = 0; index < 900; index++) {
    store.updateMessage(sessionId, messageId, { content: `answer ${index}` })
    store.setThinking({ progress: index / 9 })
  }
  assert.equal(writes, beforeStream)
  context.mock.timers.tick(500)
  assert.equal(writes, beforeStream + 1)
  for (let index = 0; index < 100; index++) store.setThinking({ progress: index })
  context.mock.timers.tick(500)
  assert.equal(writes, beforeStream + 1, 'thinking-only updates reuse unchanged persisted state')
  store.updateMessage(sessionId, messageId, { content: 'final answer' })
  store.setStreamingSessionId(null)
  assert.equal(writes, beforeStream + 2)
  const saved = JSON.parse(values.get('chat-store')!) as StorageValue<{ sessions: Array<{ messages: Array<{ content: string, attachments: unknown[] }> }> }>
  assert.equal(saved.version, 0)
  assert.deepEqual(Object.keys(saved.state).sort(), ['activeSessionId', 'sessions'])
  assert.equal(saved.state.sessions[0].messages[0].content, 'final answer')
  assert.deepEqual(saved.state.sessions[0].messages[0].attachments, [
    { id: 'image', name: 'poster.png', kind: 'image', size: 42, thumbDataUrl: 'data:image/jpeg;base64,a' },
  ])
  assert.equal(store.getSessionById(sessionId)!.messages[0].attachments![0].previewUrl, 'blob:current')
  failWrite = true
  assert.doesNotThrow(() => store.updateMessage(sessionId, messageId, { content: 'still receiving' }))
  assert.equal(store.getSessionById(sessionId)!.messages[0].content, 'still receiving')
  failWrite = false
  store.setStreamingSessionId(null)
  assert.equal(JSON.parse(values.get('chat-store')!).state.sessions[0].messages[0].content, 'still receiving')
  store.setStreamingSessionId(sessionId)
  store.updateMessage(sessionId, messageId, { content: 'discard pending' })
  useChatStore.persist.clearStorage()
  context.mock.timers.tick(500)
  assert.equal(values.has('chat-store'), false)
  store.setStreamingSessionId(null)
  useChatStore.persist.clearStorage()
})
