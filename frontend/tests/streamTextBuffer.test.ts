import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStreamTextBuffer, subscribeStreamTextLifecycle, type StreamTextScheduler } from '../src/lib/streamTextBuffer'
import { createChatPersistence } from '../src/lib/chatPersistence'
import { createChatStream } from '../src/services/sse_stream'

function manualScheduler() {
  let now = 0
  const frames = new Set<() => void>()
  const timers = new Map<() => void, number>()
  const requestedFrames: Array<() => void> = []
  const scheduler: StreamTextScheduler = {
    requestFrame(callback) {
      frames.add(callback)
      requestedFrames.push(callback)
      return () => { frames.delete(callback) }
    },
    setTimeout(callback, delay) {
      timers.set(callback, now + delay)
      return () => { timers.delete(callback) }
    },
  }
  return {
    scheduler,
    requestedFrames,
    pending: () => ({ frames: frames.size, timers: timers.size }),
    frame() {
      const due = [...frames]
      frames.clear()
      due.forEach(callback => callback())
    },
    advance(ms: number) {
      now += ms
      const due = [...timers].filter(([, at]) => at <= now)
      due.forEach(([callback]) => { timers.delete(callback); callback() })
    },
  }
}

test('a burst of received tokens commits once on the next frame without artificial typing', () => {
  const clock = manualScheduler()
  const commits: string[] = []
  const buffer = createStreamTextBuffer(text => commits.push(text), { scheduler: clock.scheduler })
  const deltas = Array.from({ length: 862 }, (_, index) => `${index}浴血🖼️`)
  deltas.forEach(delta => buffer.append(delta))
  assert.deepEqual(commits, [], 'updates wait only until the next paint')
  assert.deepEqual(clock.pending(), { frames: 1, timers: 1 })
  clock.frame()
  assert.deepEqual(commits, [deltas.join('')], 'the entire received burst is rendered together')
  assert.deepEqual(clock.pending(), { frames: 0, timers: 0 })
  buffer.close()
  assert.equal(commits.length, 1, 'completion never duplicates an already painted update')
})

test('separated network deltas advance before completion and preserve exact Unicode text', () => {
  const clock = manualScheduler()
  const commits: string[] = []
  const buffer = createStreamTextBuffer(text => commits.push(text), { scheduler: clock.scheduler })
  buffer.append('海报：')
  clock.frame()
  assert.deepEqual(commits, ['海报：'])
  buffer.append('\ud83d')
  buffer.append('\uddbc\ufe0f\n')
  buffer.append('主题曲 [2]')
  clock.frame()
  assert.deepEqual(commits, ['海报：', '海报：🖼️\n主题曲 [2]'])
  buffer.close()
})

test('background tabs flush on the fallback deadline and ignore their stale animation frame', () => {
  const clock = manualScheduler()
  const commits: string[] = []
  const buffer = createStreamTextBuffer(text => commits.push(text), { scheduler: clock.scheduler })
  buffer.append('第一段')
  const staleFrame = clock.requestedFrames[0]
  clock.advance(99)
  assert.deepEqual(commits, [])
  clock.advance(1)
  assert.deepEqual(commits, ['第一段'])
  buffer.append('第二段')
  staleFrame()
  assert.equal(commits.length, 1, 'a late cancelled callback cannot consume a newer batch')
  clock.frame()
  assert.deepEqual(commits, ['第一段', '第一段第二段'])
  buffer.close()
})

test('terminal close synchronously commits pending text and cancels every later write', () => {
  const clock = manualScheduler()
  const commits: string[] = []
  const buffer = createStreamTextBuffer(text => commits.push(text), { scheduler: clock.scheduler })
  buffer.append('保留尾字')
  const lateFrame = clock.requestedFrames[0]
  buffer.close()
  assert.deepEqual(commits, ['保留尾字'])
  assert.deepEqual(clock.pending(), { frames: 0, timers: 0 })
  buffer.append('已取消请求的滞后内容')
  lateFrame()
  clock.advance(100)
  buffer.flush()
  buffer.close()
  assert.equal(commits.length, 1)
})

test('environments without animation frames still publish text on the fallback timer', () => {
  const clock = manualScheduler()
  const commits: string[] = []
  const buffer = createStreamTextBuffer(text => commits.push(text), {
    scheduler: { ...clock.scheduler, requestFrame: () => undefined },
  })
  buffer.append('定时刷新')
  assert.deepEqual(clock.pending(), { frames: 0, timers: 1 })
  clock.advance(100)
  assert.deepEqual(commits, ['定时刷新'])
  buffer.close()
})

test('stopping and starting another response never carries text or callbacks into the new response', () => {
  const clock = manualScheduler()
  const messages = { first: '', second: '' }
  const first = createStreamTextBuffer(text => { messages.first = text }, { scheduler: clock.scheduler })
  first.append('保留已收到的部分')
  const staleFrame = clock.requestedFrames[0]
  first.close()
  const second = createStreamTextBuffer(text => { messages.second = text }, { scheduler: clock.scheduler })
  second.append('新的回答')
  staleFrame()
  first.append('旧回答不能复活')
  assert.deepEqual(messages, { first: '保留已收到的部分', second: '' })
  clock.frame()
  assert.deepEqual(messages, { first: '保留已收到的部分', second: '新的回答' })
  second.close()
})

test('empty events do not schedule work and an explicit flush preserves subsequent streaming', () => {
  const clock = manualScheduler()
  const commits: string[] = []
  const buffer = createStreamTextBuffer(text => commits.push(text), { scheduler: clock.scheduler })
  buffer.append('')
  buffer.flush()
  assert.deepEqual(clock.pending(), { frames: 0, timers: 0 })
  buffer.append('先到')
  buffer.flush()
  buffer.append('后到')
  clock.frame()
  assert.deepEqual(commits, ['先到', '先到后到'])
  buffer.close()
})

test('page lifecycle saves unpainted text after the earlier persistence listener and keeps streaming alive', () => {
  const clock = manualScheduler()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const page = Object.assign(new EventTarget(), { document })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: page })
  const saved = new Map<string, string>()
  // Production registers this listener at store import time, before the hook mounts.
  const persistence = createChatPersistence<{ content: string }>({
    isStreaming: () => true,
    equals: (left, right) => left.content === right.content,
    getStorage: () => ({
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => { saved.set(key, value) },
      removeItem: (key) => { saved.delete(key) },
    }),
  })
  const buffer = createStreamTextBuffer(content => {
    persistence.storage.setItem('chat-store', { state: { content }, version: 0 })
  }, { scheduler: clock.scheduler })
  const unsubscribe = subscribeStreamTextLifecycle(buffer.flush, persistence.flush, page as unknown as Window)
  const savedText = () => JSON.parse(saved.get('chat-store')!).state.content
  try {
    persistence.storage.setItem('chat-store', { state: { content: '上一次绘制内容' }, version: 0 })
    buffer.append('尚未绘制的尾字')
    page.dispatchEvent(new Event('pagehide'))
    assert.equal(savedText(), '尚未绘制的尾字', 'the second ordered flush must include the unpainted tail')
    assert.deepEqual(clock.pending(), { frames: 0, timers: 0 })

    buffer.append('，继续收到')
    document.dispatchEvent(new Event('visibilitychange'))
    assert.equal(savedText(), '尚未绘制的尾字', 'visible transitions do not force a checkpoint')
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    assert.equal(savedText(), '尚未绘制的尾字，继续收到')

    buffer.append('，后台仍然输出')
    clock.frame()
    persistence.flush()
    assert.equal(savedText(), '尚未绘制的尾字，继续收到，后台仍然输出', 'hiding must not close the text stream')
  } finally {
    unsubscribe()
    buffer.close()
    persistence.dispose()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('a real SSE reader displays an earlier network block before the next block and flushes its completion tail', async () => {
  const clock = manualScheduler()
  const commits: string[] = []
  const buffer = createStreamTextBuffer(text => commits.push(text), { scheduler: clock.scheduler })
  const originalFetch = globalThis.fetch
  let source!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const delta = (text: string) => `data: ${JSON.stringify({ type: 'message', data: { delta: text } })}\n\n`
  const received: Array<() => void> = []
  const firstReceived = new Promise<void>(resolve => received.push(resolve))
  const secondReceived = new Promise<void>(resolve => received.push(resolve))
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller } }))
  let stream: ReturnType<typeof createChatStream> | undefined
  try {
    const complete = new Promise<void>((resolve, reject) => {
      stream = createChatStream('逐步输出', {
        onMessage(event) { buffer.append(event.delta); received.shift()?.() },
        onComplete() { buffer.close(); resolve() },
        onError: reject,
      }, { conversationContext: [] })
    })
    source.enqueue(encoder.encode(delta('首段已到')))
    await firstReceived
    clock.frame()
    assert.deepEqual(commits, ['首段已到'], 'the connection is still open and later text has not arrived')
    source.enqueue(encoder.encode(delta('，结束前的尾字') + 'data: {"type":"complete"}\n\n'))
    await secondReceived
    await complete
    assert.deepEqual(commits, ['首段已到', '首段已到，结束前的尾字'])
    assert.deepEqual(clock.pending(), { frames: 0, timers: 0 })
    source.close()
  } finally {
    stream?.close()
    buffer.close()
    globalThis.fetch = originalFetch
  }
})
