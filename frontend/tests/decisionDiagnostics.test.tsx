import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DecisionRecord } from '../src/components/chat/DecisionRecord'
import { checkpointOutcome, citationStatement, citationStatus, decisionReason, decisionSummary, intentOutcome, readDecisionDiagnostics } from '../src/lib/decisionDiagnostics'
import type { DecisionConfig, DecisionDiagnostics } from '../src/types/decision'

const config: DecisionConfig = { provider: 'openrouter', model: 'openai/gpt-6-luna-decisions', intent_mode: 'adaptive',
  rerank_mode: 'assist', citation_mode: 'shadow', citation_strategy: 'batch_choice' }
const diagnostics: DecisionDiagnostics = {
  retrieval: { jev_config: config, runs: [{
    jev_decision: { mode: 'adaptive', accepted: true, route: 'openrouter', provider: 'OpenAI', model: 'openai/gpt-6-luna-decisions-20261006' },
    reranking_scorer: { mode: 'assist', status: 'ok', added_ids: ['added'], evaluated_count: 3, comparison: {
      baseline: [{ id: 'kept', file_name: '额度规则.pdf', snippet: '原方案每天允许 600 次。', rank: 1 }],
      added: [{ id: 'added', file_name: '例外说明.pdf', snippet: '管理员可以调整上限。', rank: 2 }],
    } },
  }] },
  jev_citation_audit: { strategy: 'batch_choice', coverage: { cited_units: 2, evaluated_units: 1, not_evaluated_units: 1, unattributed_spans: 3 },
    units: [
      { statement: '额度是 300 次。[1]', citation_ids: ['1'], result: { status: 'evaluated', answers: { relation: { choice: 'contradicted' } } } },
      { statement: '附件可以说明例外。[2]', citation_ids: ['2'], result: { status: 'not_evaluated', reason: 'non_text_source' } },
    ] },
}

test('current and legacy history diagnostics restore without fabricating older records', () => {
  assert.equal(readDecisionDiagnostics({ diagnostics }), diagnostics)
  assert.deepEqual(readDecisionDiagnostics({ retrieval_diagnostics: diagnostics.retrieval, jev_citation_audit: diagnostics.jev_citation_audit }), diagnostics)
  assert.deepEqual(readDecisionDiagnostics({ metadata: { retrieval_diagnostics: diagnostics.retrieval,
    jev_citation_audit: diagnostics.jev_citation_audit } }), diagnostics)
  for (const value of [undefined, null, {}, { diagnostics: [] }, { metadata: {} }]) assert.equal(readDecisionDiagnostics(value), undefined)
  assert.equal(renderToStaticMarkup(<DecisionRecord answer="旧回答" />), '')
})

test('answer record distinguishes actual adoption, additive evidence and partial citation conflicts', () => {
  assert.deepEqual(decisionSummary(diagnostics), ['意图已接管', '补充 1 条证据', '引用需复核'])
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={diagnostics} answer="额度是 300 次。[1]" />)
  for (const text of ['Decision 记录', 'OpenAI', '20261006', '原排序保留', '额度规则.pdf', '例外说明.pdf',
    '来源存在冲突', '未诊断', '1 / 2', '3 处正文', '不代表整份答案正确']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /正确率|整份答案已验证|"probabilities"/)
  assert.match(html, /^<details class="decision-record">/, 'native disclosure is initially closed')
  assert.doesNotMatch(html, /<summary[^>]*>[^]*?<h[1-6]/)
})

test('shadow results are labelled comparison and never described as adopted evidence', () => {
  const shadow: DecisionDiagnostics = { retrieval: { jev_config: { ...config, rerank_mode: 'shadow' }, runs: [{
    jev_decision: { mode: 'adaptive', accepted: false, reason: 'context_requires_generative_handler' },
    reranking_scorer: { mode: 'shadow', status: 'ok', comparison: { baseline: [{ file_name: '实际使用.pdf' }], proposed: [{ file_name: '对照.pdf' }] } },
  }] } }
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={shadow} answer="正文" />)
  assert.deepEqual(decisionSummary(shadow), ['重排仅作对照', '部分判断已跳过'])
  assert.match(html, /已跳过/)
  assert.match(html, /历史对话或附件/)
  assert.match(html, /本次回答仍使用原排序/)
  assert.match(html, /对照.pdf/)
  assert.doesNotMatch(html, /补充 1 条|已采用排序/)
})

test('Agent summary uses final retained additions, never the sum of child candidates', () => {
  const run = { reranking_scorer: { mode: 'assist' as const, status: 'ok', added_ids: ['a', 'b'] } }
  const data: DecisionDiagnostics = { retrieval: { runs: [run, run], final_added_ids: ['a'] } }
  assert.deepEqual(decisionSummary(data), ['补充 1 条证据'])
  delete data.retrieval!.final_added_ids
  assert.deepEqual(decisionSummary(data), ['曾补充候选证据'])
  data.retrieval!.final_added_ids = []
  assert.ok(!decisionSummary(data).join('').includes('补充'))
})

test('strict errors preserve reason without inventing an actual provider call', () => {
  const failure: DecisionDiagnostics = { code: 'jev_required_failed', stage: 'intent', reason: 'context_outside_bounds', fallback_used: false }
  assert.deepEqual(readDecisionDiagnostics({ diagnostics: failure }), failure)
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={failure} answer="" />)
  assert.match(html, /未回退到其他模型/)
  assert.match(html, /12 条消息或 8,000 字符/)
  assert.doesNotMatch(html, /OpenRouter|TypeSafe/)
})

test('citation excerpts use Python codepoint offsets and prefer the saved full statement', () => {
  const answer = '🙂前言。额度是600次。[1] 后续。'
  const points = Array.from(answer)
  const start = points.indexOf('额')
  const end = points.indexOf(']') + 1
  assert.equal(citationStatement(answer, { start, end }), '额度是600次。[1]')
  assert.equal(citationStatement('changed', { start, end, statement: '原始声明。[1]' }), '原始声明。[1]')
  assert.equal(citationStatus({ result: { status: 'evaluated', answers: { relation: { choice: 'supported' } }, choice_support_signal: false } }).review, true)
  assert.equal(citationStatus({ result: { status: 'not_evaluated', reason: 'timeout' } }).label, '未诊断')
})

test('partial requirements show field actions without claiming full intent takeover', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: { ...config, provider: 'bailian', model: 'decision-model-preview' }, runs: [{
    jev_decision: { mode: 'adaptive', accepted: false, partially_applied: true, applied_modalities: ['audio'], reason: 'partial_requirements',
      route: 'bailian', provider: 'Alibaba Cloud Bailian', model: 'decision-model-preview',
      requirements: { planning: { status: 'needs_planning' }, modalities: {
        image: { status: 'conflict', action: 'conflict_retained_baseline', effective_intent: 'explicit_demand' },
        audio: { status: 'required', action: 'added_required', effective_intent: 'explicit_demand' },
        video: { status: 'uncertain', action: 'abstained', effective_intent: 'unnecessary' },
      } },
    },
  }] } }
  assert.equal(intentOutcome(data.retrieval!.runs![0].jev_decision), '部分采用')
  assert.deepEqual(decisionSummary(data), ['意图部分采用'])
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  for (const phrase of ['需要查询规划', '信号冲突', '冲突，保留原规划', '补充检索需求', '弃权，未改写规划', '阿里云百炼', '不把概率等同于判断正确率']) assert.ok(html.includes(phrase), phrase)
  assert.doesNotMatch(html, /意图已接管|TypeSafe/)
})

test('plan-first zero-proposal records retain the planner without inventing an abstention or model call', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, runs: [{ jev_decision: {
    strategy: 'plan_first', mode: 'adaptive', accepted: false, status: 'skipped', reason: 'no_proposals',
    plan: { baseline_plan_preserved: true, request_count: 0, actions: [], applied_ids: [] },
  } }] } }
  assert.equal(intentOutcome(data.retrieval!.runs![0].jev_decision), '保留原规划')
  assert.deepEqual(decisionSummary(data), ['原规划已保留'])
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  for (const phrase of ['规划与来源动作', '保留原模型的查询规划', '本次规划检查未调用 Decision 模型']) assert.ok(html.includes(phrase), phrase)
  assert.doesNotMatch(html, /已接管|已弃权|规划需求未记录|本次判断满足采用条件/)
})

test('plan-first separates verified constraints from changes and rejects unbound object actions', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, runs: [{ jev_decision: {
    strategy: 'plan_first', mode: 'adaptive', accepted: false, partially_applied: true, status: 'ok', reason: 'verified_actions',
    plan: { baseline_plan_preserved: true, request_count: 1, applied_ids: ['images', 'audio'], actions: [
      { id: 'images', target: { modality: 'image', scope: 'global' }, action: 'forbid', source_span: '不要使用图片', status: 'evaluated', decision: 'verified', applied: true, changed: false, before: 'unnecessary', after: 'unnecessary' },
      { id: 'audio', target: { modality: 'audio', scope: 'global' }, action: 'require', source_span: '请找录音', status: 'evaluated', decision: 'verified', applied: true, changed: true, before: 'unnecessary', after: 'explicit_demand' },
      { id: 'object', target: { modality: 'video', scope: 'object' }, action: 'forbid', source_span: '<script>example</script>', status: 'not_evaluated', reason: 'object_scope_not_executable', applied: false },
    ] },
  } }] } }
  assert.deepEqual(decisionSummary(data), ['原规划已保留', '来源约束已核验'])
  assert.equal(intentOutcome(data.retrieval!.runs![0].jev_decision), '来源约束已调整')
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  for (const phrase of ['查看来源动作', '不要使用图片', '请找录音', '已确认，原设置一致', '已应用并调整来源', '仅限指定对象', '未核验，未应用']) assert.ok(html.includes(phrase), phrase)
  assert.match(html, /&lt;script&gt;example&lt;\/script&gt;/)
  assert.doesNotMatch(html, /意图已接管|意图部分采用|<script>/)
})

test('plan-first verification failure does not imply that previously returned signals were applied', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, runs: [{ jev_decision: {
    strategy: 'plan_first', mode: 'adaptive', accepted: false, status: 'fallback', reason: 'http_503',
    plan: { baseline_plan_preserved: true, request_count: 1, applied_ids: [], actions: [
      { id: 'audio', target: { modality: 'audio', scope: 'global' }, action: 'require', status: 'not_evaluated', decision: 'verified', applied: false, changed: true, reason: 'http_503' },
    ] },
  } }] } }
  assert.deepEqual(decisionSummary(data), ['原规划已保留', '部分判断已回退'])
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  assert.match(html, /检查失败，保留规划/)
  assert.match(html, /未核验，未应用/)
  assert.doesNotMatch(html, /已应用并调整来源|来源约束已核验/)
})

test('model-purpose profile gates stay distinct from high signals and actual action adoption', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, runs: [{ jev_decision: {
    strategy: 'plan_first', mode: 'adaptive', accepted: false, status: 'ok', reason: 'observe_only',
    plan: { baseline_plan_preserved: true, request_count: 1, threshold: null, threshold_policy: 'model_and_purpose_profile', applied_ids: [], actions: [
      { id: 'audio', target: { modality: 'audio', scope: 'global' }, action: 'require', source_span: '请提供录音', status: 'evaluated', decision: 'verified', verified_signal: .99,
        meets_profile_threshold: true, profile: { purpose: 'source_require', threshold: .57, execution: 'observe_only', status: 'holdout_pending' }, applied: false, reason: 'profile_observe_only' },
    ] },
  } }] } }
  assert.deepEqual(decisionSummary(data), ['原规划已保留', '来源动作仅作记录'])
  assert.equal(intentOutcome(data.retrieval!.runs![0].jev_decision), '仅观察，保留规划')
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  for (const phrase of ['仅观察，未获准应用', '核验信号 0.99', '该用途门槛 0.57', '尚未获准的动作仅记录判断']) assert.ok(html.includes(phrase), phrase)
  assert.doesNotMatch(html, /来源约束已核验|已应用并调整来源|0\.85|本次动作采用门槛/)
})

test('one final context checkpoint follows Agent runs and distinguishes accepted spans from actual additions', () => {
  const run = { preplanned_query: true, reranking_scorer: { mode: 'assist' as const, status: 'deferred', reason: 'awaiting_final_context' } }
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, runs: [run, run], final_added_ids: ['old-incorrect-total'], context_checkpoint: {
    policy_version: 'visible-evidence-checkpoint-v1', mode: 'assist', status: 'ok', reason: 'added_evidence',
    candidate_count: 3, attempted_count: 3, evaluated_count: 3, requests: [{ status: 'evaluated', candidate_count: 3 }],
    comparison_scope: 'actual_visible_text_only', global_novelty: 'not_evaluated', accepted_ids: ['tail', 'limited'], added_ids: ['tail'],
    candidate_decisions: [
      { id: 'tail', role: 'qualification', probability: .94, accepted: true, span_start: 700, span_end: 800, source_chars: 1000, partial_source: true },
      { id: 'limited', role: 'counterevidence', probability: .96, accepted: true, span_start: 0, span_end: 100, source_chars: 100, partial_source: false },
      { id: 'wrong', role: 'inapplicable', probability: .91, accepted: false, partial_source: false },
    ],
  } } }
  assert.deepEqual(decisionSummary(data), ['补充 1 条证据'])
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  assert.equal(html.split('最终上下文补证检查').length - 1, 1)
  for (const phrase of ['Agent 多轮合并后也只检查一次', '仅检查原文局部片段', '701–800 / 1000', '条件或例外', '纠正或反证', '已追加到上下文', '满足条件，最终未追加', '未满足采用条件', '未核验全局信息增量']) assert.ok(html.includes(phrase), phrase)
  assert.doesNotMatch(html, /部分判断已跳过|判断了 0 条|相较原证据的信息增量/)
})

test('a context checkpoint with no eligible candidates explicitly records zero calls', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, context_checkpoint: {
    mode: 'assist', status: 'skipped', reason: 'no_eligible_candidates', candidate_count: 0,
    attempted_count: 0, evaluated_count: 0, requests: [], added_ids: [], skip_reasons: { visible_duplicate: 2, non_text_source: 1 },
  } } }
  assert.deepEqual(decisionSummary(data), ['补证未调用模型'])
  assert.equal(checkpointOutcome(data.retrieval!.context_checkpoint!), '无需模型调用')
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  for (const phrase of ['本次补证未调用模型', '实际可见上下文', '此类媒体来源未纳入文本补证检查']) assert.ok(html.includes(phrase), phrase)
  assert.doesNotMatch(html, /此条消息未保留|这条旧记录未对媒体引用|已追加到上下文/)
})

test('selected evidence is not reported as inserted when formatting retained the baseline', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, context_checkpoint: {
    mode: 'assist', status: 'ok', reason: 'added_evidence', attempted_count: 1, evaluated_count: 1,
    requests: [{ status: 'evaluated', candidate_count: 1 }], accepted_ids: ['a'], selected_ids: ['a'], added_ids: [], applied_count: 0,
    candidate_decisions: [{ id: 'a', role: 'answer', accepted: true }],
  } } }
  assert.deepEqual(decisionSummary(data), ['上下文未追加'])
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  assert.match(html, /候选已通过判断，但最终未追加到回答上下文/)
  assert.match(html, /满足条件，最终未追加/)
  assert.doesNotMatch(html, /已将核验通过的候选片段追加|已追加到上下文|补充 1 条证据/)
})

test('checkpoint shadow and atomic failure do not turn accepted candidates into appended evidence', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, context_checkpoint: {
    mode: 'shadow', status: 'ok', reason: 'shadow_only', attempted_count: 1, evaluated_count: 1,
    requests: [{ status: 'evaluated', candidate_count: 1 }], added_ids: [], accepted_ids: ['a'], proposed_ids: ['a'],
    candidate_decisions: [{ id: 'a', role: 'answer', accepted: true, partial_source: true }],
  } } }
  assert.deepEqual(decisionSummary(data), ['补证仅作记录'])
  let html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  assert.match(html, /仅作记录，未追加/)
  assert.doesNotMatch(html, /已追加到上下文|补充 1 条证据/)
  data.retrieval!.context_checkpoint = { mode: 'assist', status: 'fallback', reason: 'timeout', attempted_count: 2, evaluated_count: 0, requests: [{ status: 'failed', candidate_count: 2 }], added_ids: [], accepted_ids: [], candidate_decisions: [] }
  assert.deepEqual(decisionSummary(data), ['部分判断已回退'])
  html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  assert.match(html, /检查失败，保留上下文/)
  assert.doesNotMatch(html, /本次补证未调用模型|已追加到上下文/)
})

test('coverage distinguishes not searched, filtered and context unrecorded from no available material', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, decision_coverage: {
    scope: { kb_ids: ['one', 'two'], file_ids: [] }, grounding: { signal_state: 'positive' }, modalities: {
      image: { requirement: 'required', searched: true, candidate_count: 20, retained_count: 10, context_count: 5, status: 'included' },
      audio: { requirement: 'required', searched: false, candidate_count: 0, retained_count: 0, context_count: 0, status: 'not_searched' },
      video: { requirement: 'helpful', searched: true, candidate_count: 6, retained_count: 0, context_count: null, status: 'filtered' },
    },
  } } }
  assert.ok(decisionSummary(data).includes('部分证据需求未覆盖'))
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  for (const phrase of ['已进入上下文', '未执行检索', '筛选后未保留', '上下文 未记录', '未检索不代表库中没有资料', '不等于最终引用或回答充分', '2 个知识库']) assert.ok(html.includes(phrase), phrase)
  assert.doesNotMatch(html, /库中无音频|来源验证通过/)
})

test('strict uncertainty stops without hiding the abstention reason or implying forced adoption', () => {
  const data: DecisionDiagnostics = { code: 'jev_required_failed', stage: 'intent', reason: 'uncertain_decision', fallback_used: false,
    retrieval: { runs: [{ jev_decision: { mode: 'force', accepted: false, status: 'abstained', reason: 'uncertain_decision', requirements: { planning: { status: 'uncertain' } } } }] } }
  assert.deepEqual(decisionSummary(data), ['判断不确定，严格模式已停止'])
  assert.equal(intentOutcome(data.retrieval!.runs![0].jev_decision), '已弃权')
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="" />)
  assert.match(html, /未强制采纳/)
  assert.match(html, /本次请求已停止，未回退到其他模型/)
  assert.doesNotMatch(html, /严格模式采用本次判断/)
})

test('media citation support is explicitly limited to provided descriptions and transcripts', () => {
  const unit = { statement: '现场有两位参与者。[1]', citation_ids: ['1'], evidence_basis: 'derived_text' as const,
    source_modalities: ['image' as const, 'audio' as const], limitations: ['derived_text_only', 'original_media_not_checked'],
    result: { status: 'evaluated', answers: { relation: { choice: 'supported' } }, choice_support_signal: true } }
  assert.equal(citationStatus(unit).label, '描述 / 转写支持此声明')
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={{ jev_citation_audit: { units: [unit] } }} answer="回答" />)
  for (const phrase of ['图片、音频', '未检查原始媒体', '描述缺少细节不代表原媒体没有该细节']) assert.ok(html.includes(phrase), phrase)
  assert.doesNotMatch(html, /来源支持此声明|原图已验证|音频已验证/)
})

test('an empty audit is never summarized as successful validation and all-off remains hidden', () => {
  const data: DecisionDiagnostics = { jev_citation_audit: { units: [], coverage: { cited_units: 0, evaluated_units: 0 } } }
  assert.deepEqual(decisionSummary(data), ['无可诊断声明'])
  assert.doesNotMatch(renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="问候" />), /已记录引用诊断|诊断通过/)
  data.retrieval = { jev_config: { ...config, intent_mode: 'off', rerank_mode: 'off', citation_mode: 'off' } }
  assert.equal(renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="问候" />), '')
})

test('incremental supplement signals distinguish threshold acceptance from final retained additions', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, final_added_ids: [], runs: [{ reranking_scorer: {
    mode: 'assist', status: 'ok', policy_version: 'incremental-evidence-v2', added_ids: [],
    candidate_decisions: [
      { id: 'new', file_name: '补充规则.pdf', signals: { direct_usefulness: .95, incremental_information: .91 }, accepted: true },
      { id: 'copy', file_name: '重复说明.pdf', signals: { direct_usefulness: .99, incremental_information: .04 }, accepted: false },
    ],
  } }] } }
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  for (const phrase of ['直接回答价值', '信息增量', '补充规则.pdf', '重复说明.pdf', '0.95 / 0.91', '0.99 / 0.04', '满足补充条件', '最终追加结果以补充证据记录为准']) assert.ok(html.includes(phrase), phrase)
  assert.ok(!decisionSummary(data).join('').includes('补充 1 条'))
  assert.doesNotMatch(html, /置信度通过|模型正确率/)
})

test('partial batch failure reports returned judgments without claiming evidence was adopted', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, runs: [{ reranking_scorer: {
    mode: 'assist', status: 'fallback', reason: 'http_503', evaluated_count: 0, attempted_count: 4, added_ids: [],
    requests: [{ status: 'evaluated', candidate_ids: ['a', 'b'] }, { status: 'failed', candidate_ids: ['c', 'd'] }],
  } }] } }
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  assert.ok(html.includes('已返回有效判断 2 条'))
  assert.ok(html.includes('尝试判断 4 条候选'))
  assert.ok(html.includes('本阶段未采用补证'))
  assert.ok(!html.includes('判断了 0 条候选'))
})

test('source binding and grounding retain model signals while exposing actual policy and retrieval errors', () => {
  const data: DecisionDiagnostics = { retrieval: { jev_config: config, decision_coverage: { warnings: ['query_embedding_failed'] }, runs: [{
    jev_decision: { accepted: false, requirements: { modalities: {
      image: { status: 'uncertain', action: 'source_binding', effective_intent: 'explicit_demand' },
      video: { status: 'not_needed', action: 'source_grounding', effective_intent: 'implicit_enrichment' },
    } } },
  }] } }
  assert.ok(decisionSummary(data).includes('检索存在异常'))
  const html = renderToStaticMarkup(<DecisionRecord diagnostics={data} answer="回答" />)
  for (const text of ['信号不确定', '遵循指定来源', '未识别需求', '补充背景来源', '辅助检索', '部分查询向量化失败，本轮召回可能不完整']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /模型已确认需要视频|库内无资料/)
})

test('disabled Decision leaves ordinary answers uncluttered and successful assist reasons stay positive', () => {
  assert.equal(renderToStaticMarkup(<DecisionRecord answer="ordinary answer" diagnostics={{ retrieval: { jev_config: {
    ...config, intent_mode: 'off', rerank_mode: 'off', citation_mode: 'off',
  }, runs: [{ jev_decision: { mode: 'off' }, reranking_scorer: { mode: 'off' } }] } }} />), '')
  assert.match(decisionReason('added_evidence'), /已将符合条件/)
  for (const reason of ['added_evidence','no_strong_signal','empty_baseline','document_too_long','candidate_limit','input_budget','empty_or_invalid_text','unexpected_error']) {
    assert.doesNotMatch(decisionReason(reason), /未提供可显示/)
  }
})

test('actual store persists Decision data and reloads current plus legacy server histories', async () => {
  const values = new Map<string, string>()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const localStorage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { localStorage }) })
  const { useChatStore } = await import('../src/store/useChatStore')
  const { chatApi } = await import('../src/services/api_client')
  const original = chatApi.getChatHistory
  try {
    const store = useChatStore.getState()
    const sessionId = store.createSession()
    store.addMessage(sessionId, { role: 'assistant', content: 'answer', diagnostics })
    assert.deepEqual(JSON.parse(values.get('chat-store')!).state.sessions[0].messages[0].diagnostics, diagnostics)
    for (const record of [{ diagnostics }, { retrieval_diagnostics: diagnostics.retrieval, jev_citation_audit: diagnostics.jev_citation_audit }, { metadata: { retrieval_diagnostics: diagnostics.retrieval, jev_citation_audit: diagnostics.jev_citation_audit } }]) {
      chatApi.getChatHistory = async () => ({ success: true, messages: [{ role: 'assistant', content: 'answer', ...record }] })
      await store.loadSessionHistory(sessionId)
      assert.deepEqual(store.getSessionById(sessionId)!.messages[0].diagnostics, diagnostics)
    }
    chatApi.getChatHistory = async () => ({ success: true, messages: [{ role: 'assistant', content: 'old answer' }] })
    await store.loadSessionHistory(sessionId)
    assert.equal(store.getSessionById(sessionId)!.messages[0].diagnostics, undefined)
  } finally {
    chatApi.getChatHistory = original
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
