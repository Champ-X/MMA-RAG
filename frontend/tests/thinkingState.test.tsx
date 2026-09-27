import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { advanceThinking } from '../src/lib/thinkingState'
import { ThinkingCapsule } from '../src/components/chat/ThinkingCapsule'
import type { ThinkingState, ThoughtData } from '../src/store/useChatStore'

const initial = (): ThinkingState => ({ currentStage: 'intent', progress: 0,
  stages: { intent: 'processing', routing: 'idle', retrieval: 'idle', generation: 'idle' } })
const render = (state: ThinkingState) => renderToStaticMarkup(<ThinkingCapsule {...state} />)

test('auto mode metadata does not prematurely complete intent analysis', () => {
  const state = { ...initial(), ...advanceThinking(initial(), 'intent', { agent_mode_auto: true, agent_mode_selected: 'direct' }) }
  assert.equal(state.stages.intent, 'processing')
  assert.equal(state.currentStage, 'intent')
})

test('partial intent, routing and query data keep expanded running indicators visible', () => {
  for (const [phase, data] of [
    ['intent', { original_query: '已有问题', intent_type: 'analysis' }],
    ['routing', { target_kbs: [{ id: 'kb', name: '资料库', score: 1 }] }],
    ['retrieval', { sparse_keywords: ['关键词'], sub_queries: ['分解问题'] }],
  ] as const) {
    const state = { ...initial(), ...advanceThinking(initial(), phase, { ...data, stage_status: 'processing' }) }
    assert.equal(state.stages[phase], 'processing')
    assert.equal(state.currentStage, phase)
    const html = render(state)
    assert.match(html, /aria-busy="true"/)
    assert.match(html, /thinking-spinner/)
    assert.match(html, /thinking-activity-rail/)
    assert.match(html, /进行中/)
  }
})

test('reranking updates do not complete retrieval; generation has no idle gap', () => {
  let state = { ...initial(), ...advanceThinking(initial(), 'routing', { stage_status: 'completed' }) }
  state = { ...state, ...advanceThinking(state, 'retrieval', { stage_status: 'processing', message: '正在重排' }) }
  assert.equal(state.stages.retrieval, 'processing')
  state = { ...state, ...advanceThinking(state, 'retrieval', { stage_status: 'completed', total_found: 3 }) }
  assert.equal(state.stages.generation, 'processing')
  assert.equal(state.currentStage, 'generation')
  assert.match(render(state), /aria-busy="true"/)
})

test('agent planning after a completed round keeps activity but not a fake running round', () => {
  const round = { round: 1, action: 'search' as const, status: 'completed' as const, queries: ['query'],
    reason: '查找证据', result_count: 3, new_evidence_count: 3, total_evidence_count: 3, target_kbs: [], duration_seconds: 1 }
  const data: ThoughtData = { agent_mode: true, agent_status: 'planning', agent_rounds: [round] }
  const state = { ...initial(), ...advanceThinking(initial(), 'intent', data as Record<string, unknown>) }
  assert.equal(state.currentStage, 'agent')
  const html = render(state)
  assert.match(html, /规划中/)
  assert.match(html, /第 1 轮，已完成/)
  assert.match(html, /aria-busy="true"/)
  const history = renderToStaticMarkup(<ThinkingCapsule thoughtData={{ ...data, _generation_completed: true }} />)
  assert.match(history, /aria-busy="false"/)
  assert.doesNotMatch(history, /thinking-spinner|thinking-activity-rail|规划中/)
})

test('legacy generation statuses remain active until explicit completion', () => {
  for (const status of ['preparing', 'building_context', 'preparing_prompt', 'generating', undefined]) {
    const state = { ...initial(), ...advanceThinking(initial(), 'generation', { status }) }
    assert.equal(state.stages.generation, 'processing')
  }
  const state = { ...initial(), ...advanceThinking(initial(), 'generation', { status: 'completed' }) }
  assert.equal(state.stages.generation, 'completed')
  assert.doesNotMatch(render(state), /thinking-spinner|thinking-activity-rail/)
})
