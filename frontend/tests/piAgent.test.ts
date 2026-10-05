import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyPiEvent, initialPiTrace } from '../src/lib/piTrace'
import type { PiEvent, PiRun } from '../src/types/pi'
import { piApi, piOriginalUrl, watchPiRun } from '../src/services/piAgent'
import { useChatStore } from '../src/store/useChatStore'
import type { Message } from '../src/store/useChatStore'
import { mixedModeContext } from '../src/lib/mixedModeContext'
import { restorePiMessages } from '../src/lib/piHistory'
import { activePiRun } from '../src/lib/piSession'
import type { CitationReference } from '../src/types/sse'

const run: PiRun = { id: 'run-1', status: 'queued', seq: 1, session_id: 's', created_at: 1, config: { model: 'pi-model' },
  request: { client_request_id: 'request-1', message: '问题' }, state: {} }
const event = (seq: number, type: string, data: Record<string, unknown> = {}): PiEvent => ({ protocol_version: 1,
  run_id: 'run-1', event_id: `run-1:${seq}`, seq, type, timestamp: seq, data })

test('background Pi work cannot disable another session or become its cancellation target', () => {
  const message: Message = { id: 'message-a', role: 'assistant', content: '', timestamp: 1, pi: initialPiTrace(run) }
  const sessions = [{ id: 'a', messages: [message] }, { id: 'b', messages: [] as Message[] }]
  assert.equal(activePiRun(sessions, 'b'), undefined)
  assert.equal(activePiRun(sessions, null), undefined)
  sessions[1].messages.push({ ...message, id: 'message-b', pi: { ...message.pi!, runId: 'run-b' } })
  assert.equal(activePiRun(sessions, 'b')?.pi.runId, 'run-b')
  assert.equal(activePiRun(sessions, 'a')?.pi.runId, 'run-1')
  sessions[1].messages[0].pi!.status = 'completed'
  assert.equal(activePiRun(sessions, 'b'), undefined)
  assert.equal(activePiRun(sessions, 'a')?.pi.runId, 'run-1')
})

test('mixed context carries completed Pi turns but leaves legacy-only requests unchanged', () => {
  const old: Message = { id: 'old', role: 'user', content: '先前问题', timestamp: 0 }
  assert.equal(mixedModeContext([old]), undefined)
  const answer: Message = { id: 'pi', role: 'assistant', content: '已确认答案', timestamp: 2,
    pi: { ...initialPiTrace(run), status: 'completed' } }
  const draft: Message = { ...answer, id: 'draft', content: '未确认', pi: initialPiTrace(run) }
  assert.deepEqual(mixedModeContext([old, answer, draft]), [
    { role: 'user', content: '先前问题' }, { role: 'assistant', content: '已确认答案' },
  ])
})

test('server history recovers Pi turns in order and never overwrites newer local events', () => {
  const old: Message = { id: 'old', role: 'user', content: '旧模式问题', timestamp: 0 }
  const completed = { ...run, status: 'completed' as const, state: { answer: '答案' } }
  const restored = restorePiMessages([old], [completed, completed])
  assert.equal(restored.length, 3)
  assert.equal(restored[0].id, 'old')
  assert.equal(restored[1].content, '问题')
  assert.equal(restored[2].content, '答案')
  assert.equal(restored[2].pi?.seq, 0, 'trace is recovered by replay, never by rerunning a model')
  restored[2].pi = { ...restored[2].pi!, seq: 50, status: 'completed' }
  assert.strictEqual(restorePiMessages(restored, [completed]), restored)
  assert.equal(restored[2].pi.seq, 50)
})

test('durable Pi attachment previews require a source URL bound to the cited run', () => {
  const reference: CitationReference = { id: 1, type: 'image', source: 'attachment', attachment_id: 'att',
    file_name: '原图.png', content: '观察', pi_run_id: 'run-1', file_path: '/api/pi/runs/run-1/sources/src_1/content' }
  assert.equal(piOriginalUrl(reference), '/api/pi/runs/run-1/sources/src_1/content')
  assert.equal(piOriginalUrl({ ...reference, pi_run_id: 'run-2' }), undefined)
  assert.equal(piOriginalUrl({ ...reference, pi_run_id: undefined }), undefined)
  assert.equal(piOriginalUrl({ ...reference, file_path: 'https://untrusted.test/file.png' }), undefined)
})

test('Pi event replay deduplicates, detects gaps and never publishes a provisional answer', () => {
  let trace = initialPiTrace(run)
  trace = applyPiEvent(trace, event(1, 'run.running', { status: 'running' }))
  trace = applyPiEvent(trace, event(2, 'answer.delta', { delta: '待确认[99]' }))
  assert.equal(trace.draft, '待确认[99]')
  assert.equal(trace.answer, undefined)
  assert.strictEqual(applyPiEvent(trace, event(2, 'answer.delta', { delta: 'duplicate' })), trace)
  assert.throws(() => applyPiEvent(trace, event(4, 'answer.delta')), /缺口/)
  trace = applyPiEvent(trace, event(3, 'answer.reset'))
  assert.equal(trace.draft, '')
  trace = applyPiEvent(trace, event(4, 'run.completed', { status: 'completed', answer: '已确认[1]', citations: [{ id: 1 }] }))
  assert.equal(trace.answer, '已确认[1]')
  assert.strictEqual(applyPiEvent(trace, event(5, 'answer.delta', { delta: 'late' })), trace)
})

test('cancellation preserves successful evidence and freezes outstanding work', () => {
  let trace = initialPiTrace(run)
  trace = applyPiEvent(trace, event(1, 'tool.started', { tool_call_id: 'call', name: 'search' }))
  trace = applyPiEvent(trace, event(2, 'evidence.added', { id: 1, file_name: '原文.pdf' }))
  trace = applyPiEvent(trace, event(3, 'run.cancelled', { status: 'cancelled' }))
  assert.equal(trace.steps[0].status, 'cancelled')
  assert.equal(trace.evidence[0].file_name, '原文.pdf')
  assert.deepEqual(trace.citations, [])
})

test('Pi toggle and model configuration leave existing mode and messages intact', () => {
  const store = useChatStore.getState()
  const id = store.createSession()
  store.updateSessionAgentMode(id, 'direct')
  store.addMessage(id, { role: 'user', content: '保留消息' })
  store.updateSessionPiMode(id, true)
  store.updateSessionPiModel(id, 'independent-model')
  assert.equal(store.getSessionById(id)?.agentMode, 'direct')
  store.updateSessionPiMode(id, false)
  const current = store.getSessionById(id)!
  assert.equal(current.executionEngine, 'existing')
  assert.equal(current.agentMode, 'direct')
  assert.equal(current.piModel, 'independent-model')
  assert.equal(current.messages[0].content, '保留消息')
})

test('multipart Pi request preserves exact UTF-16 mentions and separates reference material from search scope', async () => {
  const originalFetch = globalThis.fetch
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
  let received: FormData | undefined, attempts = 0
  globalThis.fetch = async (_url, init) => {
    if (++attempts === 1) throw new TypeError('response lost')
    const request = new Request('http://localhost/api/pi/runs', init)
    received = await new Response(await request.arrayBuffer(), { headers: { 'Content-Type': request.headers.get('Content-Type')! } }).formData()
    return Response.json(run)
  }
  try {
    const message = '🖼️对比@photo.png\n继续查找'
    await piApi.create({ requestId: 'same-key', sessionId: 's', message, history: [], knowledgeBaseIds: ['search-kb'],
      mentions: [{ source: 'knowledge', kbId: 'input-kb', fileId: 'photo', name: 'photo.png', type: 'image', start: 5, end: 15 }],
      files: [new File(['data'], 'local.png')], attachmentIds: ['local-1'] })
    const spec = JSON.parse(String(received!.get('request')))
    assert.equal(spec.message, message)
    assert.equal(spec.client_request_id, 'same-key')
    assert.deepEqual(spec.knowledge_base_ids, ['search-kb'])
    assert.deepEqual(spec.selected_files, [])
    assert.equal(spec.reference_files[0].kb_id, 'input-kb')
    assert.equal(spec.mentions[0].start, 5)
    assert.equal(received!.get('attachment_ids'), '["local-1"]')
  } finally {
    globalThis.fetch = originalFetch
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('separate Pi transport reconstructs fragmented Unicode events without legacy delta fallback', async () => {
  const originalFetch = globalThis.fetch
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
  const bytes = new TextEncoder().encode([event(1, 'action.delta', { delta: '正在阅读🖼️' }), event(2, 'run.completed', { answer: '答案' })]
    .map(e => `id: ${e.event_id}\nevent: pi\ndata: ${JSON.stringify(e)}\n\n`).join(''))
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3))
    controller.close()
  } }))
  try {
    const events: PiEvent[] = []
    await watchPiRun('run-1', () => events.length, e => events.push(e), new AbortController().signal)
    assert.equal(events[0].type, 'action.delta')
    assert.equal(events[0].data.delta, '正在阅读🖼️')
    assert.equal(events[1].data.answer, '答案')
  } finally {
    globalThis.fetch = originalFetch
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
