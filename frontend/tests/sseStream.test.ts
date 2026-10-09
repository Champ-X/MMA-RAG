import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createChatStream, sseStreamManager } from '../src/services/sse_stream'
import { createStreamTextBuffer } from '../src/lib/streamTextBuffer'

class TestEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  readyState = TestEventSource.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closeCount = 0
  constructor(readonly url: string) {}
  close() { this.readyState = TestEventSource.CLOSED; this.closeCount++ }
  emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }) }
}

function eventSourceFixture(context: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  const sources: TestEventSource[] = []
  class Source extends TestEventSource {
    constructor(url: string) { super(url); sources.push(this) }
  }
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: Source })
  context.after(() => {
    sseStreamManager.close()
    if (previous) Object.defineProperty(globalThis, 'EventSource', previous)
    else Reflect.deleteProperty(globalThis, 'EventSource')
  })
  return sources
}

test('a native connection interrupted in CONNECTING closes and reports once without replaying the chat', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const sources = eventSourceFixture(context)
  const errors: unknown[] = []
  const stream = createChatStream('one expensive query', { onError: error => errors.push(error) }, { sessionId: 'first' })
  const disconnected = sources[0].onerror!
  disconnected()
  disconnected()
  assert.equal(stream.isClosed, true)
  assert.equal(sources[0].closeCount, 1, 'close cancels the browser native reconnect')
  assert.equal(errors.length, 1)
  assert.match((errors[0] as Error).message, /连接.*中断.*重试/)
  context.mock.timers.tick(60_000)
  assert.equal(sources.length, 1, 'no timer may restart a non-resumable chat')
})

test('a permanently closed connection also reports its failure once', context => {
  const sources = eventSourceFixture(context)
  let errors = 0
  const stream = createChatStream('query', { onError: () => { errors++ } })
  const fail = sources[0].onerror!
  sources[0].readyState = TestEventSource.CLOSED
  fail()
  fail()
  assert.equal(stream.isClosed, true)
  assert.equal(errors, 1)
})

test('a stopped handle and queued old events cannot close or update a newer native request', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const sources = eventSourceFixture(context)
  const oldEvents: unknown[] = []
  const currentEvents: string[] = []
  const old = createChatStream('old', {
    onMessage: event => oldEvents.push(event.delta),
    onError: error => oldEvents.push(error),
    onComplete: () => oldEvents.push('complete'),
  }, { sessionId: 'old' })
  const oldMessage = sources[0].onmessage!
  const oldError = sources[0].onerror!
  const current = createChatStream('new', { onMessage: event => currentEvents.push(event.delta) }, { sessionId: 'new' })
  old.close()
  oldMessage({ data: JSON.stringify({ type: 'message', data: { delta: 'stale' } }) })
  oldMessage({ data: JSON.stringify({ type: 'complete' }) })
  oldError()
  context.mock.timers.tick(60_000)
  sources[1].readyState = TestEventSource.OPEN
  sources[1].emit({ type: 'message', data: { delta: 'current' } })
  assert.equal(old.isClosed, true)
  assert.equal(current.isClosed, false)
  assert.equal(sources[1].closeCount, 0)
  assert.equal(sources.length, 2)
  assert.deepEqual(oldEvents, [])
  assert.deepEqual(currentEvents, ['current'])
})

test('complete and done close their own source before delivering the terminal callback', context => {
  const sources = eventSourceFixture(context)
  for (const type of ['complete', 'done']) {
    const deltas: string[] = []
    let completed = 0
    let errors = 0
    const stream = createChatStream('query', {
      onMessage: event => deltas.push(event.delta),
      onComplete: () => { assert.equal(stream.isClosed, true); completed++ },
      onError: () => { errors++ },
    })
    const source = sources[sources.length - 1]
    const queuedError = source.onerror!
    const queuedMessage = source.onmessage!
    source.emit({ type: 'message', data: { delta: '正文' } })
    source.emit({ type })
    queuedError()
    queuedMessage({ data: JSON.stringify({ type }) })
    assert.deepEqual(deltas, ['正文'])
    assert.equal(completed, 1)
    assert.equal(errors, 0)
  }
})

test('transport failure notifies the consumer while its received final frame can still be saved', context => {
  const sources = eventSourceFixture(context)
  let saved = ''
  let failed = false
  const text = createStreamTextBuffer(content => { saved = content }, {
    scheduler: { requestFrame: () => () => {}, setTimeout: () => () => {} },
  })
  createChatStream('query', {
    onMessage: event => text.append(event.delta),
    onError: () => { text.close(); failed = true },
  })
  sources[0].emit({ type: 'message', data: { delta: '已收到但还未绘制的尾字' } })
  assert.equal(saved, '')
  sources[0].onerror!()
  assert.equal(saved, '已收到但还未绘制的尾字')
  assert.equal(failed, true)
})

test('application error and malformed native frames close and report exactly once', context => {
  const sources = eventSourceFixture(context)
  for (const data of ['{"type":"error","message":"provider failed"}', '{broken', 'null']) {
    const errors: unknown[] = []
    const stream = createChatStream('query', { onError: error => errors.push(error) })
    const source = sources[sources.length - 1]
    const queuedMessage = source.onmessage!
    const queuedError = source.onerror!
    queuedMessage({ data })
    queuedMessage({ data })
    queuedError()
    assert.equal(stream.isClosed, true)
    assert.equal(errors.length, 1)
    if (data.includes('provider')) assert.equal((errors[0] as { message: string }).message, 'provider failed')
  }
})

test('explicit stop is silent and an old native handle cannot abort a newer multipart stream', async context => {
  const sources = eventSourceFixture(context)
  let errors = 0
  const old = createChatStream('old', { onError: () => { errors++ } })
  const queuedError = sources[0].onerror!
  old.close()
  queuedError()
  assert.equal(errors, 0)

  const originalFetch = globalThis.fetch
  let signal: AbortSignal | undefined
  let controller!: ReadableStreamDefaultController<Uint8Array>
  globalThis.fetch = async (_url, init) => {
    signal = init?.signal as AbortSignal
    return new Response(new ReadableStream<Uint8Array>({ start(source) { controller = source } }))
  }
  let current: ReturnType<typeof createChatStream> | undefined
  try {
    current = createChatStream('multipart', { onError: () => { errors++ } }, { conversationContext: [] })
    old.close()
    assert.equal(signal?.aborted, false)
    assert.equal(current.isClosed, false)
    current.close()
    assert.equal(signal?.aborted, true)
    controller.close()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(errors, 0)
  } finally {
    current?.close()
    globalThis.fetch = originalFetch
  }
})
