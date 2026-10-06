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

test('registered requirements replay once as context and remain visible in cancelled history', () => {
  const requirements = { ...event(3, 'answer.requirements', {
    max_characters: 250, length_quote: '正文不超过250字', required_points: ['比较两种方法', '说明适用条件'],
  }), span_id: 'requirements', parent_span_id: 'tool:register' }
  const events = [event(1, 'run.running'),
    { ...event(2, 'tool.started', { name: 'set_answer_requirements' }), span_id: 'tool:register' },
    requirements,
    { ...event(4, 'tool.completed', { name: 'set_answer_requirements', duration_ms: 12 }), span_id: 'tool:register' },
    event(5, 'run.cancelled', { message: '已取消' })]
  let live = events.slice(0, 3).reduce(applyPiEvent, initialPiTrace(run))
  assert.strictEqual(applyPiEvent(live, requirements), live)
  const registered = live.steps[1]
  assert.equal(registered.kind, 'context')
  assert.equal(registered.parentId, 'tool:register')
  assert.equal(registered.status, 'completed')
  assert.match(registered.text!, /正文上限 250 字符/)
  assert.match(registered.text!, /比较两种方法；说明适用条件/)
  assert.match(registered.text!, /用户原句：正文不超过250字/)
  assert.match(registered.text!, /Pi 对用户要求的理解/)
  assert.equal(live.evidence.length, 0)
  assert.equal(live.answer, undefined)
  live = events.slice(3).reduce(applyPiEvent, live)
  const history = restorePiMessages([], [{ ...run, status: 'cancelled' }])[1].pi!
  assert.deepEqual(events.reduce(applyPiEvent, history), live)
  assert.equal(live.steps[1].text, registered.text)
  assert.strictEqual(applyPiEvent(live, { ...requirements, seq: 6 }), live)
})

test('absence of a registered cap is not presented as proof the user set no limit', () => {
  const trace = applyPiEvent(initialPiTrace(run), event(1, 'answer.requirements', {
    max_characters: null, length_quote: null, required_points: ['回答问题'],
  }))
  assert.match(trace.steps[0].text!, /未登记正文字符上限/)
  assert.doesNotMatch(trace.steps[0].text!, /用户没有|已核实/)
})

test('archiving superseded drafts preserves failed attempts and replays without publishing an answer', () => {
  const events = [event(1, 'run.running'),
    { ...event(2, 'tool.started', { name: 'submit_answer', args: { answer: '原始被拒草稿[99]' } }), span_id: 'tool:old' },
    { ...event(3, 'tool.failed', { name: 'submit_answer', message: '引用不一致' }), span_id: 'tool:old' },
    event(4, 'context.compacted', { archived_tool_results: 0, archived_answer_attempts: 1, archived_answer_spans: ['tool:old'] }),
    event(5, 'run.failed', { message: '未提交有效回答' })]
  let live = events.slice(0, 3).reduce(applyPiEvent, initialPiTrace(run))
  const failed = live.steps[0]
  live = applyPiEvent(live, events[3])
  assert.strictEqual(live.steps[0], failed)
  assert.deepEqual(failed.args, { answer: '原始被拒草稿[99]' })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.text, '引用不一致')
  assert.match(live.steps[1].text!, /1 次被拒草稿/)
  assert.match(live.steps[1].text!, /最新草稿和反馈/)
  assert.doesNotMatch(live.steps[1].text!, /已核实|可继续读取原始证据/)
  assert.strictEqual(applyPiEvent(live, events[3]), live)
  live = applyPiEvent(live, events[4])
  const history = restorePiMessages([], [{ ...run, status: 'failed' }])[1].pi!
  assert.deepEqual(events.reduce(applyPiEvent, history), live)
  assert.equal(live.answer, undefined)
  assert.deepEqual(live.citations, [])
})

test('source preparation and resource waiting replay as distinct context steps with real duration', () => {
  let trace = initialPiTrace(run)
  trace = applyPiEvent(trace, event(1, 'run.running'))
  trace = applyPiEvent(trace, { ...event(2, 'sources.started', { message: '正在确认来源' }), span_id: 'sources' })
  trace = applyPiEvent(trace, { ...event(3, 'resource.waiting', { message: '等待检索资源' }), span_id: 'wait-1', parent_span_id: 'sources' })
  assert.deepEqual(trace.steps.map(step => [step.id, step.kind, step.status]), [
    ['sources', 'context', 'running'], ['wait-1', 'context', 'running'],
  ])
  assert.equal(trace.steps[1].parentId, 'sources')
  trace = applyPiEvent(trace, { ...event(4, 'resource.resumed', { duration_ms: 1234 }), span_id: 'wait-1', parent_span_id: 'sources' })
  trace = applyPiEvent(trace, { ...event(5, 'sources.completed', { message: '来源范围已确认，可读取 2 项资料。', duration_ms: 2345 }), span_id: 'sources' })
  assert.equal(trace.steps.length, 2)
  assert.equal(trace.steps[0].label, '准备检索资料')
  assert.equal(trace.steps[0].status, 'completed')
  assert.equal(trace.steps[0].startedAt, 2000)
  assert.equal(trace.steps[0].durationMs, 2345)
  assert.equal(trace.steps[1].durationMs, 1234)
  assert.equal(trace.answer, undefined)
})

test('cancellation during preparation preserves its trace without publishing an answer', () => {
  let trace = initialPiTrace(run)
  trace = applyPiEvent(trace, event(1, 'run.running'))
  trace = applyPiEvent(trace, { ...event(2, 'sources.started'), span_id: 'sources' })
  trace = applyPiEvent(trace, { ...event(3, 'resource.waiting'), span_id: 'wait-1', parent_span_id: 'sources' })
  trace = applyPiEvent(trace, event(4, 'run.cancelled', { message: '已取消' }))
  assert.equal(trace.status, 'cancelled')
  assert.deepEqual(trace.steps.map(step => step.status), ['cancelled', 'cancelled'])
  assert.equal(trace.answer, undefined)
  assert.deepEqual(trace.citations, [])
  assert.strictEqual(applyPiEvent(trace, { ...event(5, 'sources.completed'), span_id: 'sources' }), trace)
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
