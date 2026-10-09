import type { DecisionCitationUnit, DecisionContextCheckpoint, DecisionCoverage, DecisionDiagnostics, DecisionIntentBlocker, DecisionIntentRecord, DecisionModelRecord, DecisionModalityRequirement, DecisionPlanAction, DecisionRerankRecord } from '@/types/decision'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Current terminal/history contract plus the metadata layout used by older API turns. */
export function readDecisionDiagnostics(value: unknown): DecisionDiagnostics | undefined {
  if (!object(value)) return undefined
  const current = value.diagnostics
  if (object(current) && (object(current.retrieval) || object(current.jev_citation_audit) || current.code === 'jev_required_failed')) {
    return current as DecisionDiagnostics
  }
  const metadata = object(value.metadata) ? value.metadata : {}
  const retrieval = value.retrieval_diagnostics ?? metadata.retrieval_diagnostics
  const audit = value.jev_citation_audit ?? metadata.jev_citation_audit
  if (!object(retrieval) && !object(audit)) return undefined
  return {
    ...(object(retrieval) ? { retrieval: retrieval as DecisionDiagnostics['retrieval'] } : {}),
    ...(object(audit) ? { jev_citation_audit: audit as DecisionDiagnostics['jev_citation_audit'] } : {}),
  }
}

const reasons: Record<string, string> = {
  selected_evidence_not_rendered: '候选已被选中，但未能加入实际上下文；保留原证据。',
  context_requires_generative_handler: '本轮包含历史对话或附件，由原意图模型处理。',
  query_outside_bounds: '问题为空或超过 4,000 字符的处理范围。',
  context_outside_bounds: '上下文超过 12 条消息或 8,000 字符的处理范围。',
  invalid_context: '上下文格式不符合此判断模型的要求。',
  uncertain_or_complex: '判断不够确定或问题较复杂，已采用原意图模型。',
  partial_requirements: '沿用原模型的查询规划，仅补充已确定的独立证据需求。',
  verified_actions: '保留原查询规划，已核验的来源约束按记录应用。',
  no_verified_actions: '没有动作通过核验，保留原查询规划。',
  no_proposals: '原规划没有提出需要核验的来源动作，未调用 Decision。',
  no_executable_proposals: '没有可执行的来源动作，未调用 Decision。',
  no_actionable_changes: '来源动作已在原规划中，或当前模型未通过该用途验证，未增加 Decision 调用。',
  already_planned: '原规划已明确开启此类来源，保留原规划，无需重复判断。',
  equivalent_action: '已合并相同依据的重复动作，只核验一次。',
  model_purpose_not_admitted: '当前模型尚未通过此类来源动作验证，保留原规划，未调用 Decision。',
  verified_action: '此来源动作通过核验。',
  profile_observe_only: '当前模型在此类动作上仅记录核验结果，未据此修改检索。',
  observe_only: '当前模型的相关来源动作仅作观察，保留原查询规划。',
  not_verified: '此动作未通过核验，未据此修改规划。',
  invalid_proposal: '规划中的动作格式不完整，未作核验。',
  invalid_target: '规划中的动作目标不完整，未作核验。',
  non_current_user_provenance: '动作没有绑定当前用户请求，未作核验。',
  ungrounded_source_span: '动作依据无法定位到当前用户原话，未作核验。',
  object_scope_not_executable: '此动作仅针对局部对象，未用于改变整类来源检索。',
  duplicate_proposal_id: '动作标识重复，未作核验。',
  conflicting_global_proposals: '同类来源动作相互冲突，保留原规划。',
  deferred_to_context_checkpoint: '本轮沿用原排序；补证在最终上下文构建后统一检查。',
  awaiting_final_context: '本轮沿用原排序；补证在最终上下文构建后统一检查。',
  uncertain_decision: '判断存在不确定、冲突或仍需规划，未强制采纳；严格模式下停止本次请求。',
  input_incomplete: '本次判断不能覆盖完整输入，未使用截断内容作出决定。',
  timeout: '判断模型调用超时。',
  circuit_open: '服务暂时不可用，正在等待恢复。',
  budget_exhausted: '本进程的 Decision 调用额度已用完。',
  missing_key: '服务端尚未配置所选服务商的密钥。',
  model_mismatch: '返回模型与所选模型不一致。',
  incomplete_answers: '判断模型未返回完整结果。',
  invalid_response_or_transport: '判断结果无效或连接异常。',
  invalid_probabilities: '返回的判断数值格式无效。',
  no_candidates: '没有需要判断的候选证据。',
  no_excluded_candidates: '原策略已保留所有可用证据。',
  no_eligible_candidates: '没有符合补充条件的证据。',
  no_suitable_candidates: '没有符合补充条件的证据。',
  no_additional_evidence: '没有找到需要补充的证据。',
  added_evidence: '已将符合条件的补充证据追加到原结果之后。',
  no_accepted_evidence: '候选片段未达到采用条件，原上下文保持不变。',
  shadow_only: '仅记录候选判断，未向回答上下文追加证据。',
  visible_duplicate: '片段已出现在实际可见上下文中，未重复判断。',
  duplicate_candidate_span: '候选片段重复，未重复判断。',
  no_unseen_bounded_paragraph: '未找到可完整检查且未展示的有界段落。',
  candidate_scan_limit: '超过本次候选扫描上限，未作检查。',
  source_text_unavailable: '来源缺少可读取的文本，未作检查。',
  invalid_candidate: '候选来源的标识或结构不完整，未作检查。',
  disabled_by_limit: '本次检查限额为零，未调用模型。',
  context_insertion_failed: '候选未能追加到回答上下文，保留原上下文。',
  baseline_text_unavailable: '原证据缺少完整可比较文本，旧补证策略未执行。',
  baseline_outside_bounds: '完整原证据超过旧补证策略的比较范围，未作判断。',
  duplicate_text: '候选与已比较文本重复，未重复判断。',
  contained_duplicate: '候选正文已包含在比较文本中，未重复判断。',
  no_incremental_evidence: '旧策略未找到满足信息增量门槛的候选，保留原证据。',
  no_strong_signal: '候选证据未达到补充条件，保留原结果。',
  empty_baseline: '原检索策略没有返回证据，本次未作补充。',
  document_too_long: '证据过长，未纳入本次补充判断。',
  candidate_limit: '超过本次候选数量上限，未作判断。',
  input_budget: '超过本次输入预算，未作判断。',
  empty_or_invalid_text: '证据正文为空或无法读取，未作判断。',
  unexpected_error: '判断环节遇到异常。',
  all_candidates_skipped: '候选证据均不在本次判断范围内。',
  standalone_greeting: '本轮是独立问候，已跳过检索判断。',
  empty_index: '当前索引为空，已跳过检索判断。',
  fast_path: '本轮无需完整检索，已跳过此环节。',
  preplanned: 'Agent 已规划此子问题，复用原问题的判断。',
  not_recorded: '此条历史未记录该环节的执行情况。',
  generation_not_completed: '回答尚未完成，未进行引用诊断。',
  upstream_failed: '前序意图识别失败，未执行重排。',
  unit_limit: '超出本次引用诊断的条数上限。',
  answer_deadline: '超过本次引用诊断的总等待时间。',
  non_text_source: '这条旧记录未对媒体引用进行诊断。',
  unsupported_source_type: '此类引用来源暂不支持诊断。',
  invalid_claim: '声明为空或超出诊断长度范围。',
  invalid_citation_ids: '引用标识缺失或超出诊断范围。',
  answer_too_large_or_invalid: '回答内容无效或超过诊断长度范围。',
  no_cited_units: '没有可诊断的带引用声明。',
  missing_reference: '缺少对应引用来源。',
  empty_source: '引用来源没有可供判断的正文。',
  source_too_large: '引用来源超出判断长度限制。',
  request_too_large: '本次内容超出判断请求的大小限制。',
  diagnostic_error: '本次诊断未完成。',
  unsupported_markdown: '表格、标题或引用块暂未纳入诊断。',
  uncited_prose: '这段正文没有可归属的引用。',
  code_fence: '代码块暂未纳入诊断。',
  ambiguous_sentence_boundary: '语句边界不明确，未作判断。',
  ambiguous_citation_position: '引用归属不明确，未作判断。',
  ambiguous_line_boundary: '跨行语句的引用归属不明确，未作判断。',
}

export function decisionReason(reason?: string): string {
  if (!reason) return ''
  if (/^http_\d{3}$/.test(reason)) return `判断服务返回错误（${reason.slice(5)}）。`
  return reasons[reason] ?? '此环节未完成；具体原因未提供可显示的说明。'
}

export function intentBlockerLabel(blocker: DecisionIntentBlocker): string {
  if (blocker.field === 'intent_type') return '任务类型尚不确定，需要原模型处理。'
  if (blocker.field === 'planning') return ({
    needs_planning: '问题需要分解与查询规划。',
    unresolved_context: '缺少可确定指代的历史或附件。',
    uncertain: '是否需要复杂规划尚不确定。',
  } as Record<string, string>)[blocker.reason] ?? '需要原模型完成查询规划。'
  const label = ({ image: '图片', audio: '音频', video: '视频' } as Record<string, string>)[blocker.field] ?? '来源'
  return `${label}来源的判断${blocker.reason === 'conflict' ? '存在冲突' : '尚不确定'}。`
}

export function decisionModel(record?: DecisionModelRecord): string | undefined {
  if (!record?.model) return undefined
  const route = decisionProviderName(record.route)
  const upstream = decisionProviderName(record.provider ?? undefined)
  const provider = upstream && upstream !== route ? upstream : undefined
  return [route, provider, record.model].filter(Boolean).join(' · ')
}

export function decisionProviderName(provider?: string): string | undefined {
  return provider === 'openrouter' ? 'OpenRouter' : provider === 'typesafe' ? 'TypeSafe' : provider === 'bailian' || provider === 'Alibaba Cloud Bailian' ? '阿里云百炼' : provider
}

export function intentOutcome(record?: DecisionIntentRecord): string {
  if (!record || record.status === 'unavailable') return '未记录'
  if (record.status === 'failed') return '已终止'
  if (record.mode === 'off' || record.status === 'disabled') return '沿用原模型'
  if (record.strategy === 'plan_first') {
    if (record.status === 'fallback') return '检查失败，保留规划'
    if (record.plan?.actions?.some(action => action.applied && action.changed)) return '来源约束已调整'
    if (record.plan?.actions?.some(action => action.applied)) return '来源约束已确认'
    if (record.plan?.actions?.some(action => action.profile?.execution === 'observe_only')) return '仅观察，保留规划'
    return '保留原规划'
  }
  if (record.partially_applied) return '部分采用'
  if (record.accepted) return '已接管'
  if (record.status === 'skipped' || record.reason === 'context_requires_generative_handler' || record.reason === 'query_outside_bounds') return '已跳过'
  if (record.status === 'abstained' || record.requirements) return '已弃权'
  return record.reason ? '已回退' : '未记录'
}

export function planActionOutcome(action: DecisionPlanAction): string {
  if (action.applied) return action.changed ? '已应用并调整来源' : '已确认，原设置一致'
  if (action.reason === 'already_planned') return '原规划已包含，未重复调用'
  if (action.reason === 'model_purpose_not_admitted') return '用途未通过验证，未调用'
  if (action.reason === 'equivalent_action') return '合并重复核验'
  if (action.profile?.execution === 'observe_only') return '仅观察，未获准应用'
  if (action.status !== 'evaluated') return '未核验，未应用'
  if (action.decision === 'contradicted') return '与请求不符，未应用'
  return '未满足核验条件，未应用'
}

export function checkpointOutcome(record: DecisionContextCheckpoint): string {
  if (record.mode === 'off' || record.reason === 'disabled') return '未启用'
  if (record.status === 'fallback') return '检查失败，保留上下文'
  if (record.mode === 'shadow') return '仅记录候选'
  if (record.added_ids?.length) return `追加 ${record.added_ids.length} 段证据`
  if (record.status === 'skipped' && record.attempted_count === 0 && record.requests?.length === 0) return '无需模型调用'
  return record.status === 'ok' ? '未追加证据' : '检查未完成'
}

export function requirementLabel(status?: string): string {
  return ({ required: '明确需要', helpful: '可能有帮助', forbidden: '明确排除', not_needed: '未识别需求', uncertain: '信号不确定', conflict: '信号冲突' } as Record<string, string>)[status ?? ''] ?? '未记录'
}

export function requirementAction(record: DecisionModalityRequirement): string {
  const actions: Record<string, string> = { adopted: '已采用', added_required: '补充检索需求', retained_baseline: '沿用原规划', conflict_retained_baseline: '冲突，保留原规划', abstained: '弃权，未改写规划', source_binding: '遵循指定来源', source_grounding: '补充背景来源' }
  return actions[record.action ?? ''] ?? '执行情况未记录'
}

export function coverageStatus(status?: string): string {
  return ({ not_searched: '未检索', no_candidates: '本次未召回', filtered: '筛选后未保留', retained: '已保留，待确认上下文', included: '已进入上下文', not_in_context: '未进入上下文' } as Record<string, string>)[status ?? ''] ?? '执行阶段未记录'
}

export function hasCoverageGap(coverage?: DecisionCoverage): boolean {
  return Object.values(coverage?.modalities ?? {}).some(item => item?.requirement === 'required'
    && ['not_searched', 'no_candidates', 'filtered', 'not_in_context'].includes(item.status ?? ''))
}

export function rerankOutcome(record?: DecisionRerankRecord): string {
  if (!record || record.status === 'unavailable') return '未记录'
  if (record.status === 'failed') return '已终止'
  if (record.mode === 'off' || record.status === 'disabled') return '沿用原排序'
  if (['deferred_to_context_checkpoint', 'awaiting_final_context'].includes(record.reason ?? '')) return '沿用原排序'
  if (record.status === 'fallback') return '已回退'
  if (record.status === 'skipped') return '已跳过'
  if (record.mode === 'shadow') return '仅作对照'
  if (record.mode === 'assist') return record.added_ids?.length ? `补充 ${record.added_ids.length} 条证据` : '保留原证据'
  return record.status === 'ok' ? '已采用排序' : '未记录'
}

export function citationStatus(unit: DecisionCitationUnit): { label: string; review: boolean; tone: 'quiet' | 'review' } {
  const result = unit.result
  if (result?.status !== 'evaluated') return { label: '未诊断', review: true, tone: 'quiet' }
  const relation = result.answers?.relation?.choice
  const source = unit.evidence_basis === 'derived_text' ? '描述 / 转写' : '来源'
  if (relation === 'contradicted') return { label: `${source}存在冲突`, review: true, tone: 'review' }
  if (relation === 'insufficient') return { label: `${source}支持不足`, review: true, tone: 'review' }
  if (relation === 'supported') {
    const review = result.choice_support_signal === false || result.factorized_support_signal === false
    return { label: review ? '支持信号较弱' : `${source}支持此声明`, review, tone: review ? 'review' : 'quiet' }
  }
  return { label: '判断结果未记录', review: true, tone: 'quiet' }
}

/** Older offsets are Python Unicode code points, not JavaScript UTF-16 units. */
export function citationStatement(answer: string, unit: DecisionCitationUnit): string {
  if (typeof unit.statement === 'string' && unit.statement.trim()) return unit.statement.trim()
  if (Number.isInteger(unit.start) && Number.isInteger(unit.end) && unit.start! >= 0 && unit.end! > unit.start!) {
    return Array.from(answer).slice(unit.start, unit.end).join('').trim()
  }
  return '这条历史未保留对应声明。'
}

export function decisionSummary(diagnostics: DecisionDiagnostics): string[] {
  if (diagnostics.code === 'jev_required_failed') return [diagnostics.reason === 'uncertain_decision' ? '判断不确定，严格模式已停止' : '严格判断未完成']
  const runs = diagnostics.retrieval?.runs ?? []
  const checkpoint = diagnostics.retrieval?.context_checkpoint
  const labels: string[] = []
  const plans = runs.filter(run => run.jev_decision?.strategy === 'plan_first').map(run => run.jev_decision!)
  if (plans.length) {
    labels.push(plans.every(record => record.plan?.baseline_plan_preserved) ? '原规划已保留' : '已记录规划检查')
    const applied = plans.some(record => record.plan?.actions?.some(action => action.applied))
    if (applied) labels.push('来源约束已核验')
    if (plans.some(record => record.plan?.actions?.some(action => action.profile?.execution === 'observe_only'))) labels.push(applied ? '部分来源动作仅作记录' : '来源动作仅作记录')
  } else if (runs.some(run => run.jev_decision?.partially_applied)) labels.push('意图部分采用')
  else if (runs.some(run => run.jev_decision?.accepted)) labels.push('意图已接管')
  else if (runs.some(run => intentOutcome(run.jev_decision) === '已弃权')) labels.push('意图沿用原规划')
  if (hasCoverageGap(diagnostics.retrieval?.decision_coverage)) labels.push('部分证据需求未覆盖')
  if (diagnostics.retrieval?.decision_coverage?.warnings?.length) labels.push('检索存在异常')
  const finalAdded = checkpoint ? checkpoint.added_ids : diagnostics.retrieval?.final_added_ids
  if (Array.isArray(finalAdded)) {
    if (finalAdded.length) labels.push(`补充 ${finalAdded.length} 条证据`)
  } else if (!checkpoint && runs.some(run => run.reranking_scorer?.added_ids?.length)) {
    labels.push(runs.length === 1 ? `补充 ${runs[0].reranking_scorer!.added_ids!.length} 条证据` : '曾补充候选证据')
  }
  if (checkpoint?.mode === 'shadow') labels.push('补证仅作记录')
  else if (checkpoint?.status === 'skipped' && checkpoint.attempted_count === 0 && checkpoint.requests?.length === 0) labels.push('补证未调用模型')
  else if (checkpoint?.status === 'ok' && !checkpoint.added_ids?.length) labels.push('上下文未追加')
  if (runs.some(run => run.reranking_scorer?.mode === 'shadow' && run.reranking_scorer.status === 'ok')) labels.push('重排仅作对照')
  if (runs.some(run => ['replace','force'].includes(run.reranking_scorer?.mode ?? '') && run.reranking_scorer?.status === 'ok')) labels.push('已采用排序')
  if (checkpoint?.status === 'fallback' || runs.some(run => run.jev_decision?.status === 'fallback' || intentOutcome(run.jev_decision) === '已回退' || run.reranking_scorer?.status === 'fallback')) labels.push('部分判断已回退')
  if (runs.some(run => intentOutcome(run.jev_decision) === '已跳过' || (run.reranking_scorer?.status === 'skipped' && !['deferred_to_context_checkpoint', 'awaiting_final_context'].includes(run.reranking_scorer.reason ?? '')))) labels.push('部分判断已跳过')
  const audit = diagnostics.jev_citation_audit
  if (audit) {
    if (!audit.units?.length) labels.push(audit.status === 'not_evaluated' || audit.reason ? '引用未诊断' : '无可诊断声明')
    else if (audit.units.some(unit => citationStatus(unit).tone === 'review')) labels.push('引用需复核')
    else if (audit.status === 'not_evaluated' || audit.units?.some(unit => unit.result?.status !== 'evaluated')) labels.push('引用部分未诊断')
    else labels.push('已记录引用诊断')
  }
  if (!labels.length) {
    const config = diagnostics.retrieval?.jev_config
    labels.push(config && [config.intent_mode, config.rerank_mode, config.citation_mode].every(mode => !mode || mode === 'off') ? '未启用' : '本轮未接管')
  }
  return labels
}
