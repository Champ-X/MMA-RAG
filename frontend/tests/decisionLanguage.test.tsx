import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DecisionRecord } from '../src/components/chat/DecisionRecord'
import { citationStatement, citationStatus, decisionSummary, intentOutcome } from '../src/lib/decisionDiagnostics'
import { setLanguage } from '../src/i18n'
import type { DecisionDiagnostics, DecisionIntentRecord } from '../src/types/decision'

afterEach(() => setLanguage('zh-CN'))

test('switching language preserves abstention, fallback and skipped diagnostic branches', () => {
  const cases: [DecisionIntentRecord, string, string, string, string][] = [
    [{ status: 'abstained', reason: 'uncertain_or_complex' }, '已弃权', 'Abstained', '意图沿用原规划', 'Original intent plan retained'],
    [{ status: 'fallback', reason: 'timeout' }, '已回退', 'Fallback used', '部分判断已回退', 'Some decisions used fallback'],
    [{ status: 'skipped', reason: 'query_outside_bounds' }, '已跳过', 'Skipped', '部分判断已跳过', 'Some decisions skipped'],
  ]
  for (const [record, zhOutcome, enOutcome, zhSummary, enSummary] of cases) {
    const data: DecisionDiagnostics = { retrieval: { runs: [{ jev_decision: record }] } }
    setLanguage('en-US')
    assert.equal(intentOutcome(record), enOutcome)
    assert.deepEqual(decisionSummary(data), [enSummary])
    setLanguage('zh-CN')
    assert.equal(intentOutcome(record), zhOutcome)
    assert.deepEqual(decisionSummary(data), [zhSummary])
  }
})

test('English Decision records translate labels and numeric sentences while retaining original evidence', () => {
  const sourceSpan = '请保留这段用户原话'
  const fileName = '来源文件.pdf'
  const snippet = '原始证据的中文内容。'
  const claim = '这条声明必须保持原文。[1]'
  const data: DecisionDiagnostics = {
    retrieval: {
      jev_config: { provider: 'bailian', model: 'decision-model', intent_mode: 'adaptive', rerank_mode: 'assist', citation_mode: 'shadow' },
      runs: [{
        jev_decision: { strategy: 'plan_first', status: 'ok', plan: {
          baseline_plan_preserved: true, request_count: 1, proposed_count: 2, scheduled_count: 1,
          actions: [{ action: 'require', target: { modality: 'audio', scope: 'global' }, source_span: sourceSpan,
            status: 'evaluated', applied: true, changed: true, verified_signal: .99,
            profile: { threshold: .57 }, before: 'unnecessary', after: 'explicit_demand' }],
        } },
        reranking_scorer: { mode: 'assist', status: 'ok', evaluated_count: 2, skipped_count: 1,
          skip_reasons: { document_too_long: 1 }, comparison: { baseline: [{ file_name: fileName, snippet }], added: [] } },
      }, {
        preplanned_query: true,
        jev_decision: { status: 'abstained', requirements: { planning: { status: 'uncertain' }, modalities: {
          image: { status: 'uncertain', action: 'abstained', effective_intent: 'implicit_enrichment' },
        } }, blockers: [{ field: 'image', reason: 'uncertain' }] },
      }],
      decision_coverage: { grounding: { signal_state: 'positive' }, scope: { kb_ids: ['kb'] }, modalities: {
        image: { requirement: 'required', searched: true, candidate_count: 3, retained_count: 2, status: 'retained' },
      } },
      context_checkpoint: { mode: 'assist', status: 'ok', attempted_count: 1, evaluated_count: 1,
        requests: [{ status: 'evaluated', candidate_count: 1 }], added_ids: ['a'], threshold: .8,
        skip_reasons: { visible_duplicate: 1 }, candidate_decisions: [{ id: 'a', role: 'answer', probability: .9,
          span_start: 0, span_end: 10, source_chars: 20, partial_source: true, accepted: true }] },
    },
    jev_citation_audit: { strategy: 'batch_choice', coverage: { cited_units: 1, evaluated_units: 1 }, units: [{
      statement: claim, citation_ids: ['1'], evidence_basis: 'derived_text', source_modalities: ['image', 'audio'],
      result: { status: 'evaluated', answers: { relation: { choice: 'contradicted' } } },
    }] },
  }
  const original = JSON.stringify(data)
  setLanguage('en-US')
  const english = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer={claim} />)
  for (const phrase of ['2 source actions; 1 need verification.', 'Verification signal 0.99', 'Purpose threshold 0.57',
    'Require Audio', 'Retrieval required', 'Supplementary retrieval', 'Retrieved 3 · Retained 2 · In context Not recorded',
    'Body characters 1–10 / 20', 'descriptions / transcripts of Image, Audio', sourceSpan, fileName, snippet, claim]) {
    assert.ok(english.includes(phrase), phrase)
  }
  const uiOnly = [sourceSpan, fileName, snippet, claim].reduce((text, source) => text.replaceAll(source, ''), english)
  assert.doesNotMatch(uiOnly, /\p{Script=Han}/u)
  assert.equal(JSON.stringify(data), original)
  const unit = data.jev_citation_audit!.units![0]
  assert.equal(citationStatement('changed', unit), claim)
  assert.equal(citationStatus(unit).review, true)
  assert.equal(citationStatus(unit).tone, 'review')
  setLanguage('zh-CN')
  const chinese = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer={claim} />)
  for (const phrase of ['来源动作 2 项，需核验 1 项。', '核验信号 0.99', '该用途门槛 0.57', '上下文 未记录', sourceSpan, snippet, claim]) {
    assert.ok(chinese.includes(phrase), phrase)
  }
  assert.equal(citationStatus(unit).review, true)
  assert.equal(citationStatus(unit).tone, 'review')
})
