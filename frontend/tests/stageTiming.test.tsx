import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { advanceThinking } from '../src/lib/thinkingState'
import { freezeStageTimings, mergeStageTimings, stageElapsedMs } from '../src/lib/stageTiming'
import { ThinkingCapsule } from '../src/components/chat/ThinkingCapsule'
import type { StageTiming } from '../src/types/sse'
import type { ThinkingState } from '../src/store/useChatStore'

const initial = (): ThinkingState => ({ currentStage: 'intent', progress: 0,
  stages: { intent: 'processing', routing: 'idle', retrieval: 'idle', generation: 'idle' } })
const timing = (duration_ms: number, status: StageTiming['status'] = 'completed'): StageTiming => ({
  started_at: 1000, duration_ms, status,
})

test('partial stream events preserve earlier durations and server completion freezes clocks', () => {
  let state = initial()
  for (const [phase, payload] of [
    ['intent', { stage_status: 'completed', stage_timing: timing(1250) }],
    ['routing', { stage_status: 'processing', stage_timing: timing(0, 'processing') }],
    ['routing', { target_kbs: [], stage_status: 'processing' }],
    ['routing', { stage_status: 'completed', stage_timing: timing(250) }],
    ['generation', { stage_timings: { generation: timing(2000) }, status: 'completed' }],
  ] as const) state = { ...state, ...advanceThinking(state, phase, payload) }
  assert.equal(state.thoughtData?.stage_timings?.intent?.duration_ms, 1250)
  assert.equal(state.thoughtData?.stage_timings?.routing?.duration_ms, 250)
  assert.equal(state.stages.generation, 'completed')
  assert.equal(state.stages.retrieval, 'idle')
  const html = renderToStaticMarkup(<ThinkingCapsule {...state} />)
  assert.match(html, /意图解析耗时 1.3s/)
  assert.match(html, /智能路由耗时 0.3s/)
  assert.match(html, /生成回答耗时 2.0s/)
  assert.doesNotMatch(html, /thinking-spinner/)
})

test('live elapsed uses local monotonic receipt time, not server/browser wall clock skew', () => {
  const merged = mergeStageTimings(undefined, { retrieval: timing(200, 'processing') }, undefined, undefined, 100)
  assert.equal(stageElapsedMs(merged!.retrieval!, true, 1000), 1100)
  assert.equal(stageElapsedMs(merged!.retrieval!, false, 100000), 200)
  const frozen = mergeStageTimings(merged, { retrieval: timing(980) }, undefined, undefined, 1100)
  assert.equal(stageElapsedMs(frozen!.retrieval!, true, 100000), 980)
})

test('failure and user cancellation freeze only the running stage', () => {
  const stages = mergeStageTimings(undefined, { intent: timing(100), routing: timing(200, 'processing') }, undefined, undefined, 1000)
  for (const status of ['failed', 'cancelled'] as const) {
    const frozen = freezeStageTimings(stages, status, 1500)
    assert.equal(frozen!.intent!.status, 'completed')
    assert.equal(frozen!.routing!.status, status)
    assert.equal(frozen!.routing!.duration_ms, 700)
    assert.equal(stageElapsedMs(frozen!.routing!, true, 10000), 700)
  }
})

test('persisted history shows durations and substeps without restarting timers; old history has no fake durations', () => {
  const thoughtData = JSON.parse(JSON.stringify({ _generation_completed: true, stage_timings: {
    intent: { ...timing(2500), substage_durations_ms: { intent: 500, rewrite: 1900 } },
    routing: timing(600), retrieval: timing(4500), generation: timing(10300),
  } }))
  const html = renderToStaticMarkup(<ThinkingCapsule thoughtData={thoughtData} />)
  for (const label of ['意图解析', '智能路由', '检索策略', '生成回答']) assert.match(html, new RegExp(`${label}耗时`))
  assert.match(html, /查询改写/)
  assert.doesNotMatch(html, /thinking-spinner|已用 /)
  const old = renderToStaticMarkup(<ThinkingCapsule thoughtData={{ intent_type: 'analysis', _generation_completed: true }} />)
  assert.doesNotMatch(old, /耗时|0.0s/)
})

test('server history loader retains saved thinking and authoritative timings', async () => {
  const { chatApi } = await import('../src/services/api_client')
  const { useChatStore } = await import('../src/store/useChatStore')
  const original = chatApi.getChatHistory
  const stages = { intent: timing(550), generation: timing(1700) }
  chatApi.getChatHistory = async () => ({ success: true, messages: [{ role: 'assistant', content: '回答',
    thinking: { intent_type: 'greeting', _generation_completed: true }, stage_timings: stages }] })
  try {
    const sid = useChatStore.getState().createSession()
    await useChatStore.getState().loadSessionHistory(sid)
    const restored = useChatStore.getState().getSessionById(sid)!.messages[0]
    assert.deepEqual(restored.thinking, { intent_type: 'greeting', _generation_completed: true, stage_timings: stages })
  } finally { chatApi.getChatHistory = original }
})

test('cancelled direct retrieval preserves completed stages and announces the stopped stage', () => {
  const html = renderToStaticMarkup(<ThinkingCapsule thoughtData={{
    _generation_cancelled: true,
    stage_timings: { intent: timing(150), routing: timing(200), retrieval: timing(2500, 'cancelled') },
  }} />)
  assert.match(html, /aria-busy="false"/)
  assert.match(html, /意图解析 ✓ · 智能路由 ✓ · 检索 已停止 · 已停止/)
  assert.match(html, /aria-label="检索策略阶段，已停止"/)
  assert.match(html, /aria-label="生成回答阶段，已停止"/)
  assert.doesNotMatch(html, /检索 ✓|生成 ✓|thinking-spinner|thinking-activity-rail/)
})

test('cancelling an Agent round does not mark its queries or evidence as completed', () => {
  const round = {
    round: 1, action: 'search' as const, status: 'processing' as const, queries: ['茶叶驯化史'],
    reason: '查找资料', result_count: 0, new_evidence_count: 0, total_evidence_count: 0,
    target_kbs: [], duration_seconds: 0,
  }
  const html = renderToStaticMarkup(<ThinkingCapsule thoughtData={{
    agent_mode: true, agent_status: 'searching', _generation_cancelled: true, agent_rounds: [round],
  }} />)
  assert.match(html, /Agent 已停止/)
  assert.match(html, /aria-label="Agent 第 1 轮，已停止"/)
  assert.doesNotMatch(html, /已完成|本轮证据已汇总|thinking-spinner|thinking-activity-rail/)

  const withCompletedRound = renderToStaticMarkup(<ThinkingCapsule thoughtData={{
    agent_mode: true, agent_status: 'searching', _generation_cancelled: true,
    agent_rounds: [{ ...round, status: 'completed' }, { ...round, round: 2 }],
  }} />)
  assert.match(withCompletedRound, /aria-label="Agent 第 1 轮，已完成"/)
  assert.match(withCompletedRound, /aria-label="Agent 第 2 轮，已停止"/)
  assert.equal((withCompletedRound.match(/本轮证据已汇总/g) ?? []).length, 1)
})
