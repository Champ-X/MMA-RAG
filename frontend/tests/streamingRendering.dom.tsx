/**
 * React DOM/SSE integration replay, with no production dependency additions.
 * From frontend/:
 * npm install --prefix /tmp/tessmora-sidebar-dom-tests --no-package-lock --no-save jsdom@26.1.0
 * ./node_modules/.bin/esbuild tests/streamingRendering.dom.tsx --bundle --platform=node --format=cjs --external:react '--external:react/*' --external:react-dom '--external:react-dom/*' --external:jsdom --loader:.css=empty --outfile=/tmp/tessmora-sidebar-dom-tests/streaming-tests.cjs
 * NODE_PATH="$PWD/node_modules:/tmp/tessmora-sidebar-dom-tests/node_modules" node --test /tmp/tessmora-sidebar-dom-tests/streaming-tests.cjs
 *
 * These measurements describe React/jsdom execution, not browser paint/FPS.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React, { Profiler } from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { Message } from '../src/store/useChatStore'
import type { CitationReference } from '../src/types/sse'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3001', pretendToBeVisual: true,
})
for (const key of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement',
  'Element', 'Node', 'NodeFilter', 'MutationObserver', 'Event', 'KeyboardEvent', 'CustomEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, {
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  // A long act() scope would batch the entire network replay and hide real commits.
  IS_REACT_ACT_ENVIRONMENT: false,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const outputDirectory = resolve(process.cwd(), '../logs/stream-smoothing-20261009')
const sourcePath = resolve(outputDirectory, 'reported-session.json')
const useRecordedAnswer = existsSync(sourcePath)
// Keep the regression runnable in a fresh checkout without private log artifacts.
const fallbackAnswer = ('## 海报封面推荐\n\n- **主角海报**：冷色烟雾与人物剪影适合呈现剧情的紧张气氛。[1]\n\n'
  + '- **群像海报**：家族成员并列的构图体现权力关系。[2]\n\n## 主题曲推荐\n\n'
  + '- 吉他与鼓点可以强调角色行动的节奏。[5]\n\n- 低沉的旋律呼应人物的内心冲突。[7]\n\n'
  + '推荐依据：海报应突出人物关系，音乐应呼应剧情情绪，具体选择以素材为准。\n\n'.repeat(40)).slice(0, 1352)
const answer = useRecordedAnswer
  ? (JSON.parse(readFileSync(sourcePath, 'utf8')) as { messages: Message[] }).messages.find(message => message.role === 'assistant')!.content
  : fallbackAnswer
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII='
const references: CitationReference[] = [1, 2, 5, 7].map(id => ({
  id, type: id < 3 ? 'image' : 'doc', file_name: `fixture-${id}.png`,
  file_path: `fixture/${id}.png`, content: `回放证据 ${id}`,
  ...(id < 3 ? { img_url: png } : {}),
}))
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean, timeout = 1500) {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error('Timed out waiting for streamed DOM/state')
    await delay(2)
  }
}

let root: Root | undefined
let container: HTMLDivElement
let hook: ReturnType<typeof import('../src/hooks/useThinkingChain').useThinkingChain>
let useStore: typeof import('../src/store/useChatStore').useChatStore
let sessionId: string
let network: { emit: (events: unknown[]) => void; aborted: boolean } | undefined
let unsubscribe: (() => void) | undefined
let observer: MutationObserver | undefined
let heartbeat: ReturnType<typeof setInterval> | undefined
const originalFetch = globalThis.fetch
const originalSetItem = dom.window.Storage.prototype.setItem
const frame = globalThis.requestAnimationFrame
const cancelFrame = globalThis.cancelAnimationFrame

interface ReplayMetrics {
  started: number
  firstReceived: number | null
  firstDomText: number | null
  terminalAt: number | null
  receivedChunks: number
  received: string
  contentFlushes: number
  reactCommits: number
  reactRenderMs: number[]
  storageWrites: number
  storageBytes: number[]
  domGrowth: Array<{ elapsedMs: number; chars: number; complete: boolean }>
  heartbeatGaps: number[]
  imageNodes: Set<Element>
  loadedImages: WeakSet<Element>
}
let metrics: ReplayMetrics

function relativeNow() { return performance.now() - metrics.started }
function lastAssistant() { return useStore.getState().getSessionById(sessionId)!.messages.findLast(message => message.role === 'assistant')! }
function persistedAssistant() {
  const saved = JSON.parse(localStorage.getItem('chat-store')!)
  return saved.state.sessions.find((session: { id: string }) => session.id === sessionId).messages.findLast((message: Message) => message.role === 'assistant')
}

async function mount() {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { flushSync } = requireFrontend('react-dom') as typeof import('react-dom')
  useStore = (await import('../src/store/useChatStore')).useChatStore
  const { useThinkingChain } = await import('../src/hooks/useThinkingChain')
  const { MessageBubble } = await import('../src/components/chat/MessageBubble')
  useStore.getState().setStreamingSessionId(null)
  useStore.setState({ sessions: [], activeSessionId: null })
  sessionId = useStore.getState().createSession({ title: 'DOM integration replay' })
  metrics = {
    started: performance.now(), firstReceived: null, firstDomText: null, terminalAt: null,
    receivedChunks: 0, received: '', contentFlushes: 0, reactCommits: 0, reactRenderMs: [],
    storageWrites: 0, storageBytes: [], domGrowth: [], heartbeatGaps: [],
    imageNodes: new Set(), loadedImages: new WeakSet(),
  }
  function Harness() {
    hook = useThinkingChain({
      onMessage(event) {
        metrics.firstReceived ??= relativeNow()
        metrics.receivedChunks++
        metrics.received += event.delta
      },
      onComplete() { metrics.terminalAt = relativeNow() },
      onError() { metrics.terminalAt = relativeNow() },
    })
    const session = useStore(state => state.sessions.find(item => item.id === sessionId))
    const thinking = useStore(state => state.thinking)
    const message = session?.messages.findLast(item => item.role === 'assistant')
    return <Profiler id="answer" onRender={(_id, _phase, duration) => {
      metrics.reactCommits++
      metrics.reactRenderMs.push(duration)
    }}>
      {message && <MessageBubble message={{ ...message, type: 'assistant', timestamp: String(message.timestamp) }}
        isStreaming={hook.isStreaming}
        liveThinking={{ thoughtData: thinking.thoughtData, stages: thinking.stages, currentStage: thinking.currentStage }} />}
    </Profiler>
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  flushSync(() => root!.render(<Harness />))
  await delay(20)

  let previousContent = ''
  unsubscribe = useStore.subscribe(() => {
    const content = useStore.getState().getSessionById(sessionId)?.messages.findLast(message => message.role === 'assistant')?.content ?? ''
    if (content !== previousContent) { metrics.contentFlushes++; previousContent = content }
  })
  let lastChars = 0
  observer = new MutationObserver(() => {
    const chars = container.querySelector('.rag-markdown')?.textContent?.length ?? 0
    if (chars > 0) metrics.firstDomText ??= relativeNow()
    if (chars > lastChars) {
      metrics.domGrowth.push({ elapsedMs: relativeNow(), chars, complete: metrics.terminalAt !== null })
    }
    lastChars = chars
    for (const image of container.querySelectorAll('img[src^="data:"]')) {
      metrics.imageNodes.add(image)
      if (!metrics.loadedImages.has(image)) {
        metrics.loadedImages.add(image)
        image.dispatchEvent(new Event('load'))
      }
    }
  })
  observer.observe(container, { subtree: true, childList: true, characterData: true })
  dom.window.Storage.prototype.setItem = function(name, value) {
    if (name === 'chat-store') { metrics.storageWrites++; metrics.storageBytes.push(value.length) }
    return originalSetItem.call(this, name, value)
  }
  let heartbeatAt = performance.now()
  heartbeat = setInterval(() => {
    const now = performance.now()
    metrics.heartbeatGaps.push(now - heartbeatAt)
    heartbeatAt = now
  }, 10)

  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), '/api/chat/stream', 'the fixture must never request remote media or APIs')
    assert.equal(options?.method, 'POST')
    let controller: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    network = {
      aborted: false,
      emit(events) {
        assert.equal(network!.aborted, false)
        const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
        // Exercise the production TextDecoder and SSE parser across byte boundaries.
        const split = Math.max(1, Math.floor(bytes.length / 2))
        controller.enqueue(bytes.subarray(0, split))
        controller.enqueue(bytes.subarray(split))
      },
    }
    options?.signal?.addEventListener('abort', () => {
      if (!network!.aborted) { network!.aborted = true; controller.close() }
    }, { once: true })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  await hook.sendMessage('结合剧情挑选海报与主题曲', undefined, sessionId, undefined,
    [{ kbId: 'fixture', fileId: 'fixture', name: 'fixture.md' }])
  await until(() => !!network)
  network!.emit([
    { type: 'connected' },
    { type: 'thought', data: { type: 'generation', data: { message: '正在生成回答...', status: 'generating' } } },
    { type: 'citation', data: { references } },
  ])
  await delay(30)
}

function saveReport(name: string, extra: Record<string, unknown> = {}) {
  const beforeComplete = metrics.domGrowth.filter(sample => !sample.complete)
  const gaps = metrics.heartbeatGaps.slice().sort((a, b) => a - b)
  const report = {
    environment: 'React 18 + jsdom 26, Node event loop; not browser paint or FPS',
    input: `${useRecordedAnswer ? 'reported-session.json assistant body' : 'deterministic Markdown fixture'}; synthesized chunk boundaries/timing; local data image references`,
    receivedChunks: metrics.receivedChunks,
    receivedCharacters: metrics.received.length,
    firstReceivedMs: metrics.firstReceived,
    firstDomTextMs: metrics.firstDomText,
    firstReceivedToDomMs: metrics.firstDomText! - metrics.firstReceived!,
    terminalMs: metrics.terminalAt,
    contentFlushes: metrics.contentFlushes,
    reactCommits: metrics.reactCommits,
    maxReactRenderMs: Math.max(0, ...metrics.reactRenderMs),
    storageWrites: metrics.storageWrites,
    maxStorageCharacters: Math.max(0, ...metrics.storageBytes),
    domGrowthBeforeComplete: beforeComplete.length,
    distinctDataImageNodes: metrics.imageNodes.size,
    maxHeartbeatGapMs: Math.max(0, ...gaps),
    p95HeartbeatGapMs: gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))],
    networkEqualsStore: metrics.received === lastAssistant().content,
    storeEqualsPersistence: lastAssistant().content === persistedAssistant().content,
    domGrowth: metrics.domGrowth,
    ...extra,
  }
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(resolve(outputDirectory, `dom-${name}.json`), JSON.stringify(report, null, 2), { mode: 0o600 })
}

afterEach(async () => {
  clearInterval(heartbeat)
  observer?.disconnect()
  unsubscribe?.()
  root?.unmount()
  await delay(20)
  container?.remove()
  root = undefined
  network = undefined
  globalThis.fetch = originalFetch
  globalThis.requestAnimationFrame = frame
  globalThis.cancelAnimationFrame = cancelFrame
  dom.window.Storage.prototype.setItem = originalSetItem
})

test('862 small SSE deltas progressively update the real Markdown DOM before complete', async () => {
  await mount()
  const points = Array.from(answer)
  const chunks = Array.from({ length: 862 }, (_, index) => points.slice(
    Math.floor(index * points.length / 862), Math.floor((index + 1) * points.length / 862),
  ).join(''))
  assert.equal(chunks.join(''), answer)
  for (let start = 0; start < chunks.length; start += 5) {
    network!.emit(chunks.slice(start, start + 5).map(delta => ({ type: 'message', data: { delta } })))
    await delay(20)
  }
  await until(() => lastAssistant().content === answer)
  await delay(20)
  const imagesBeforeComplete = [...container.querySelectorAll('img[src^="data:"]')]
  network!.emit([{ type: 'citation', data: { references, replace: true } }, { type: 'complete', sessionId }])
  await until(() => metrics.terminalAt !== null && useStore.getState().streamingSessionId === null)
  await delay(40)
  const imagesAfterComplete = [...container.querySelectorAll('img[src^="data:"]')]
  const completionPreservesImages = imagesBeforeComplete.length === 2
    && imagesBeforeComplete.every((image, index) => image === imagesAfterComplete[index])
  saveReport('complete', {
    expectedCharacters: answer.length, expectedChunks: chunks.length, completionPreservesImages,
    mediaBoundary: 'Incomplete Markdown can change a tight list into a loose list and replace an image ancestor once.',
  })
  assert.equal(metrics.receivedChunks, 862)
  assert.equal(metrics.received, answer)
  assert.equal(lastAssistant().content, answer)
  assert.equal(persistedAssistant().content, answer)
  assert.ok(metrics.domGrowth.filter(sample => !sample.complete).length >= 30)
  assert.ok(metrics.firstDomText! < metrics.terminalAt! / 3, 'first visible text must precede completion substantially')
  assert.ok(metrics.firstDomText! - metrics.firstReceived! < 500, 'received text must appear promptly')
  assert.ok(metrics.contentFlushes < 400, 'multiple deltas must coalesce into each state update')
  assert.ok(metrics.storageWrites < 30, 'stream persistence must checkpoint, not write per delta')
  assert.ok(metrics.imageNodes.size <= 4, 'citation images must not remount for each text update')
  assert.equal(completionPreservesImages, true, 'completion must retain the already rendered media nodes')
  assert.ok(container.querySelectorAll('.rag-markdown h2').length >= 2)
})

async function preparePendingTail() {
  await mount()
  network!.emit([{ type: 'message', data: { delta: '先保留已经显示的正文。' } }])
  await until(() => !!container.querySelector('.rag-markdown')?.textContent?.includes('正文'))
  await delay(30)
  // Prevent the next animation frame so stop/error must explicitly drain its tail.
  globalThis.requestAnimationFrame = () => 123
  globalThis.cancelAnimationFrame = () => {}
}

test('stopping immediately after receiving a pending tail preserves it in DOM, store and storage', async () => {
  await preparePendingTail()
  const prefix = lastAssistant().content
  network!.emit([{ type: 'message', data: { delta: '停止前的最后尾字' } }])
  await until(() => metrics.received.endsWith('最后尾字'))
  assert.equal(lastAssistant().content, prefix, 'the final delta is still waiting for its animation frame')
  hook.stopStreaming()
  metrics.terminalAt = relativeNow()
  await until(() => !!container.querySelector('.rag-markdown')?.textContent?.includes('最后尾字'))
  saveReport('stop')
  assert.equal(lastAssistant().content, metrics.received)
  assert.equal(persistedAssistant().content, metrics.received)
  assert.equal(useStore.getState().streamingSessionId, null)
  assert.equal(network!.aborted, true)
})

test('an SSE error in the final delta packet keeps all received text and ends the stream', async () => {
  await preparePendingTail()
  network!.emit([
    { type: 'message', data: { delta: '错误前的最后尾字' } },
    { type: 'error', message: 'fixture interrupted' },
  ])
  await until(() => metrics.terminalAt !== null && !!container.querySelector('.rag-markdown')?.textContent?.includes('最后尾字'))
  saveReport('error')
  assert.equal(lastAssistant().content, metrics.received)
  assert.equal(persistedAssistant().content, metrics.received)
  assert.equal(lastAssistant().error, 'fixture interrupted')
  assert.equal(useStore.getState().streamingSessionId, null)
  assert.equal(network!.aborted, true)
})
