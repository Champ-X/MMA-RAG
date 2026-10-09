import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DecisionRecord } from '../src/components/chat/DecisionRecord'
import { decisionReason, planActionOutcome } from '../src/lib/decisionDiagnostics'
import type { DecisionIntentTestResponse } from '../src/types/decision'

const observation: DecisionIntentTestResponse = {
  success: true, diagnostic_only: true, provider: 'bailian', requested_model: 'decision-model-preview',
  model: 'decision-model-preview', duration_s: .28,
  decision: { eligible: false, blockers: [{ field: 'planning', reason: 'uncertain' },
    { field: 'audio', reason: 'uncertain' }, { field: 'video', reason: 'uncertain' }],
  requirements: { modalities: {
    image: { status: 'required', signals: { required: .97, forbidden: .01, helpful: .92 } },
    audio: { status: 'uncertain', signals: { required: .95, forbidden: .01, helpful: .73 } },
    video: { status: 'uncertain', signals: { required: .42, forbidden: .02, helpful: .19 } },
  } }, thresholds: { positive: .85, negative: .15, selected_probability: .75 } },
}

test('legacy strict chat errors retain independently actionable gate explanations', () => {
  const html = renderToStaticMarkup(<DecisionRecord answer="" diagnostics={{ code: 'jev_required_failed', stage: 'intent',
    reason: 'uncertain_decision', fallback_used: false,
    retrieval: { runs: [{ jev_decision: { ...observation.decision, mode: 'force', status: 'failed' } }] } }} />)
  assert.match(html, /未通过的独立采用条件/)
  assert.match(html, /音频来源的判断尚不确定/)
  assert.match(html, /是否需要复杂规划尚不确定/)
})

test('skipped preflight actions never claim a paid verification or applied constraint', () => {
  assert.equal(planActionOutcome({ reason: 'already_planned' }), '原规划已包含，未重复调用')
  assert.equal(planActionOutcome({ reason: 'model_purpose_not_admitted' }), '用途未通过验证，未调用')
  assert.match(decisionReason('model_purpose_not_admitted'), /保留原规划，未调用/)
  assert.match(decisionReason('equivalent_action'), /只核验一次/)
  const html = renderToStaticMarkup(<DecisionRecord answer="answer" diagnostics={{ retrieval: { runs: [{
    jev_decision: { mode: 'adaptive', strategy: 'plan_first', plan: { request_count: 0,
      proposed_count: 2, scheduled_count: 0, threshold_policy: 'model_and_purpose_profile' } },
  }] } }} />)
  assert.match(html, /来源动作 2 项，需核验 0 项/)
  assert.match(html, /已知未获准的用途在调用前跳过/)
})
