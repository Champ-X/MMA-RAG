import { getLanguage, translate as tr, useTranslation } from '@/i18n'
import { ChevronDown, GitCompareArrows, ListPlus, ScanLine, SlidersHorizontal } from 'lucide-react'
import type { DecisionContextCheckpoint, DecisionCoverage, DecisionDiagnostics, DecisionEvidence, DecisionModelRecord, DecisionModality, DecisionPlanRecord, DecisionRequirements, DecisionRerankRecord } from '@/types/decision'
import { checkpointOutcome, citationStatement, citationStatus, coverageStatus, decisionModel, decisionProviderName, decisionReason, decisionSummary, intentBlockerLabel, intentOutcome, planActionOutcome, requirementAction, requirementLabel, rerankOutcome } from '@/lib/decisionDiagnostics'

const modalityLabels: Record<DecisionModality, string> = { image: '图片', audio: '音频', video: '视频' }
const modalities: DecisionModality[] = ['image', 'audio', 'video']
const intentLabels: Record<string, string> = { explicit_demand: '需要检索', implicit_enrichment: '辅助检索', unnecessary: '未启用' }

function ModelUsed({ record }: { record?: DecisionModelRecord }) {
  useTranslation()
  const label = decisionModel(record)
  return label ? <p className="decision-record-model">{label}</p> : null
}

function EvidenceList({ title, items }: { title: string; items: DecisionEvidence[] }) {
  useTranslation()
  return <div className="decision-evidence-column">
    <p className="decision-evidence-title">{title}</p>
    {items.length ? <ol>{items.map((item, index) => <li key={`${item.id ?? 'evidence'}-${index}`}>
      <span className="decision-evidence-name">{item.file_name || tr("来源未命名")}</span>
      {item.snippet ? <p>{item.snippet}</p> : <p className="decision-record-muted">{tr("未保留证据摘要")}</p>}
    </li>)}</ol> : <p className="decision-record-muted">{tr("没有条目")}</p>}
  </div>
}

function RequirementsDetails({ requirements }: { requirements?: DecisionRequirements }) {
  useTranslation()
  if (!requirements) return null
  const planning: Record<string, string> = { simple: tr("可直接处理"), needs_planning: tr("需要查询规划"), unresolved_context: tr("上下文指代未解决"), uncertain: tr("规划需求不确定") }
  return <div className="decision-requirements">
    <p className="decision-record-note">{tr("{{planning}}；各类来源独立判断，弱信号不强制关闭检索。", { planning: planning[requirements.planning?.status ?? ''] ?? tr("规划需求未记录") })}</p>
    <table className="decision-requirements-table">
      <caption className="sr-only">{tr("Decision 对各类证据需求的判断与实际采用情况")}</caption>
      <thead><tr><th scope="col">{tr("来源")}</th><th scope="col">{tr("判断")}</th><th scope="col">{tr("实际采用")}</th></tr></thead>
      <tbody>{modalities.map(modality => {
        const record = requirements.modalities?.[modality]
        return record ? <tr key={modality}><th scope="row">{tr(modalityLabels[modality])}</th><td>{requirementLabel(record.status)}</td><td>{requirementAction(record)}
          {record.effective_intent && <small>{tr(intentLabels[record.effective_intent] ?? "检索方式未记录")}</small>}
        </td></tr> : null
      })}</tbody>
    </table>
    <p className="decision-record-muted">{tr("这里显示模型信号与采用策略，不把概率等同于判断正确率。")}</p>
  </div>
}

function PlanDetails({ plan }: { plan?: DecisionPlanRecord }) {
  useTranslation()
  if (!plan) return null
  return <div className="decision-requirements">
    {plan.baseline_plan_preserved === true && <p className="decision-record-note">{tr("保留原模型的查询规划、改写与问题分解；Decision 只核验有用户原话依据的来源动作。")}</p>}
    {typeof plan.request_count === 'number' && <p className="decision-record-muted">{plan.request_count === 0
      ? tr("本次规划检查未调用 Decision 模型。")
      : tr("本次规划检查尝试调用 Decision {{v0}} 次。", { v0: plan.request_count })}</p>}
    {typeof plan.proposed_count === 'number' && typeof plan.scheduled_count === 'number' && <p className="decision-record-muted">{tr("来源动作 {{proposed}} 项，需核验 {{scheduled}} 项。", { proposed: plan.proposed_count, scheduled: plan.scheduled_count })}</p>}
    {typeof plan.threshold === 'number' && <p className="decision-record-muted">{tr("本次动作采用门槛 {{value}}；模型信号不代表正确率。", { value: plan.threshold.toFixed(2) })}</p>}
    {plan.threshold_policy === 'model_and_purpose_profile' && <p className="decision-record-muted">{typeof plan.scheduled_count === 'number'
      ? tr("各模型按具体动作用途验证应用条件；已知未获准的用途在调用前跳过，返回版本未获准时仅保留观察。")
      : tr("各模型按具体动作用途验证应用条件；尚未获准的动作仅记录判断。")}</p>}
    {!!plan.actions?.length && <details className="decision-comparison">
      <summary><ScanLine aria-hidden />{tr("查看来源动作")}<ChevronDown aria-hidden /></summary>
      <table className="decision-requirements-table decision-actions-table">
        <caption className="sr-only">{tr("规划中的来源动作、用户原话与实际应用")}</caption>
        <thead><tr><th scope="col">{tr("来源动作")}</th><th scope="col">{tr("用户原话")}</th><th scope="col">{tr("实际应用")}</th></tr></thead>
        <tbody>{plan.actions.map((action, index) => <tr key={`${action.id ?? 'action'}-${index}`}>
          <th scope="row">{tr(action.action === 'require' ? "要求使用{{source}}" : action.action === 'forbid' ? "排除使用{{source}}" : "动作未记录{{source}}", { source: tr(action.target?.modality ? modalityLabels[action.target.modality] : "来源") })}
            {action.target?.scope === 'object' && <small>{tr("仅限指定对象")}</small>}
          </th>
          <td>{action.source_span || tr("没有可定位的当前用户原话")}</td>
          <td>{planActionOutcome(action)}
            {typeof action.verified_signal === 'number' && <small>{tr("核验信号 {{value}}", { value: action.verified_signal.toFixed(2) })}</small>}
            {typeof action.profile?.threshold === 'number' && <small>{tr("该用途门槛 {{value}}", { value: action.profile.threshold.toFixed(2) })}</small>}
            {action.applied && action.before && action.after && <small>{tr(intentLabels[action.before] ?? "原设置未记录")} → {tr(intentLabels[action.after] ?? "当前设置未记录")}</small>}
            {!action.applied && action.reason && <small>{decisionReason(action.reason)}</small>}
          </td>
        </tr>)}</tbody>
      </table>
      <p className="decision-record-muted">{tr("模型核验通过与实际改变检索是两件事；原设置已一致时只确认约束。")}</p>
    </details>}
  </div>
}

function ContextCheckpointDetails({ record }: { record: DecisionContextCheckpoint }) {
  useTranslation()
  const roles: Record<string, string> = { answer: tr("回答信息"), qualification: tr("条件或例外"), counterevidence: tr("纠正或反证"), inapplicable: tr("适用范围不符"), irrelevant: tr("无关"), uncertain: tr("不确定") }
  const added = new Set(record.added_ids ?? [])
  const zeroCalls = record.attempted_count === 0 && record.requests?.length === 0
  return <div className="decision-record-citations">
    <p className="decision-record-stage-heading"><strong>{tr("最终上下文补证检查")}</strong><span>{checkpointOutcome(record)}</span></p>
    <ModelUsed record={record} />
    <p className="decision-record-note">{tr("在原上下文构建和压缩后统一检查，Agent 多轮合并后也只检查一次；最多追加 2 段证据。")}</p>
    <p className="decision-record-muted">{tr("按实际可见文字排除重复片段，模型判断候选片段的用途；未核验全局信息增量。")}</p>
    {typeof record.threshold === 'number' && <p className="decision-record-muted">{tr("本次补证采用门槛 {{value}}；以本次记录的策略为准。", { value: record.threshold.toFixed(2) })}</p>}
    {record.reason && <p className="decision-record-note">{record.reason === 'added_evidence'
      ? added.size ? tr("已将核验通过的候选片段追加到回答上下文。") : tr("候选已通过判断，但最终未追加到回答上下文。")
      : decisionReason(record.reason)}</p>}
    {zeroCalls ? <p className="decision-record-muted">{tr("本次补证未调用模型，原上下文保持不变。")}</p> : <p className="decision-record-muted">
      {tr("模型请求 {{requests}} 次 · 尝试 {{attempted}} 段 · 完成判断 {{evaluated}} 段 · 实际追加 {{added}} 段。", { requests: record.requests?.length ?? tr("未记录"), attempted: record.attempted_count ?? tr("未记录"), evaluated: record.evaluated_count ?? tr("未记录"), added: record.added_ids?.length ?? tr("未记录") })}</p>}
    {record.skip_reasons && Object.keys(record.skip_reasons).length > 0 && <ul className="decision-record-reasons">
      {Object.entries(record.skip_reasons).map(([reason, count]) => <li key={reason}>{tr("{{reason}}（{{count}} 项）", { reason: reason === 'non_text_source' ? tr("此类媒体来源未纳入文本补证检查。") : decisionReason(reason), count })}</li>)}
    </ul>}
    {!!record.candidate_decisions?.length && <details className="decision-comparison">
      <summary><ScanLine aria-hidden />{tr("查看片段判断与追加结果")}<ChevronDown aria-hidden /></summary>
      <table className="decision-requirements-table decision-spans-table">
        <caption className="sr-only">{tr("候选片段的检查范围、模型判断与实际追加情况")}</caption>
        <thead><tr><th scope="col">{tr("候选与检查范围")}</th><th scope="col">{tr("模型判断")}</th><th scope="col">{tr("实际追加")}</th></tr></thead>
        <tbody>{record.candidate_decisions.map((candidate, index) => <tr key={`${candidate.id ?? 'span'}-${index}`}>
          <th scope="row">{candidate.file_name || tr("候选片段 {{v0}}", { v0: index + 1 })}
            <small>{candidate.partial_source === true ? tr("仅检查原文局部片段") : candidate.partial_source === false ? tr("检查完整候选文本") : tr("片段范围未记录")}</small>
            {typeof candidate.span_start === 'number' && typeof candidate.span_end === 'number' && <small>{tr("正文字符 {{range}}", { range: `${candidate.span_start + 1}–${candidate.span_end}${typeof candidate.source_chars === 'number' ? ` / ${candidate.source_chars}` : ''}` })}</small>}
          </th>
          <td>{roles[candidate.role ?? ''] ?? tr("未记录")}{typeof candidate.probability === 'number' && <small>{tr("模型信号 {{value}}", { value: candidate.probability.toFixed(2) })}</small>}</td>
          <td>{record.mode === 'shadow' ? tr("仅作记录，未追加") : candidate.id !== undefined && added.has(candidate.id) ? tr("已追加到上下文") : candidate.accepted ? tr("满足条件，最终未追加") : tr("未满足采用条件")}</td>
        </tr>)}</tbody>
      </table>
      <p className="decision-record-muted">{tr("模型信号不是正确率；局部段落检查不能证明全文或其他来源没有相关信息。")}</p>
    </details>}
  </div>
}

function CoverageDetails({ coverage, final = false }: { coverage?: DecisionCoverage; final?: boolean }) {
  useTranslation()
  if (!coverage) return null
  const grounding: Record<string, string> = { positive: tr("已识别事实依据需求。"), negative: tr("未识别事实依据需求。"), uncertain: tr("事实依据需求尚不确定。") }
  const count = (value: number | null | undefined) => typeof value === 'number' ? String(value) : tr("未记录")
  return <div className="decision-coverage">
    <p className="decision-record-stage-heading"><strong>{final ? tr("本轮证据覆盖") : tr("此轮检索覆盖")}</strong><span>{tr("实际执行")}</span></p>
    <p className="decision-record-muted">{tr("限于本次检索范围{{scope}}。未检索不代表库中没有资料。", { scope: `${coverage.scope?.kb_ids?.length ? tr(" · {{v0}} 个知识库", { v0: coverage.scope.kb_ids.length }) : ''}${coverage.scope?.file_ids?.length ? tr(" · {{v0}} 个指定文件", { v0: coverage.scope.file_ids.length }) : ''}` })}</p>
    {!!coverage.warnings?.length && <p className="decision-coverage-warning">{coverage.warnings.includes('query_embedding_failed')
      ? tr("部分查询向量化失败，本轮召回可能不完整。") : tr("检索过程出现异常，本轮证据覆盖可能不完整。")}</p>}
    {grounding[coverage.grounding?.signal_state ?? ''] && <p className="decision-record-note">{tr("{{grounding}}是否获得充分依据，仍需核对实际来源。", { grounding: grounding[coverage.grounding!.signal_state!] })}</p>}
    <ul className="decision-coverage-list">{modalities.map(modality => {
      const row = coverage.modalities?.[modality]
      return row ? <li key={modality}>
        <div><strong>{tr(modalityLabels[modality])}</strong><span>{coverageStatus(row.status)}</span></div>
        <p>{requirementLabel(row.requirement)} · {row.searched === true ? tr("已执行检索") : row.searched === false ? tr("未执行检索") : tr("检索执行未记录")}</p>
        <p className="decision-coverage-counts">{tr("召回 {{candidates}} · 保留 {{retained}} · 上下文 {{context}}", { candidates: count(row.candidate_count), retained: count(row.retained_count), context: count(row.context_count) })}</p>
      </li> : null
    })}</ul>
    <p className="decision-record-muted">{tr("进入上下文表示回答模型可用，不等于最终引用或回答充分。")}</p>
  </div>
}

function RankingDetails({ record }: { record: DecisionRerankRecord }) {
  useTranslation()
  if (['awaiting_final_context', 'deferred_to_context_checkpoint'].includes(record.reason ?? '')) return null
  const comparison = record.comparison
  const assist = record.mode === 'assist'
  const partialFallback = assist && record.status === 'fallback' && !!record.requests?.length
  const returnedCandidates = record.requests?.reduce((count, request) => count + (
    request.status === 'evaluated' ? request.candidate_ids?.length ?? 0 : 0), 0) ?? 0
  return <>
    {record.mode === 'shadow' && <p className="decision-record-note">{tr("Decision 只记录对照；本次回答仍使用原排序。")}</p>}
    {assist && <p className="decision-record-note">{tr("本次检索保留原证据及顺序，最多追加 2 条；Agent 会在多轮检索后合并筛选。")}</p>}
    {assist && record.policy_version === 'incremental-evidence-v2' && <p className="decision-record-note">{tr("同时检查直接回答价值与相较原证据的信息增量，减少重复补入。")}</p>}
    {partialFallback && <p className="decision-record-muted">
      {tr("本阶段未采用补证；已返回有效判断 {{returned}} 条，尝试判断 {{attempted}} 条候选。部分请求完成不代表整批采用。", { returned: returnedCandidates, attempted: record.attempted_count ?? tr("未记录") })}</p>}
    {!partialFallback && typeof record.evaluated_count === 'number' && <p className="decision-record-muted">
      {tr("判断了 {{count}} 条候选{{extra}}。", { count: record.evaluated_count, extra: record.skipped_count ? tr("，另有 {{v0}} 条未判断", { v0: record.skipped_count }) : '' })}
    </p>}
    {!!record.skipped_count && record.skip_reasons && <ul className="decision-record-reasons">
      {Object.entries(record.skip_reasons).map(([reason, count]) => <li key={reason}>{tr("{{reason}}（{{count}} 条）", { reason: decisionReason(reason), count })}</li>)}
    </ul>}
    {!!record.candidate_decisions?.length && <details className="decision-comparison">
      <summary><ScanLine aria-hidden />{tr("查看补证判断")}<ChevronDown aria-hidden /></summary>
      <table className="decision-requirements-table decision-signals-table">
        <caption className="sr-only">{tr("候选补充证据的模型信号与门槛判断")}</caption>
        <thead><tr><th scope="col">{tr("候选")}</th><th scope="col">{tr("回答价值 / 信息增量")}</th><th scope="col">{tr("条件判断")}</th></tr></thead>
        <tbody>{record.candidate_decisions!.map((candidate, index) => <tr key={`${candidate.id ?? index}`}><th scope="row">{candidate.file_name || tr("候选 {{v0}}", { v0: index + 1 })}</th>
          <td>{typeof candidate.signals?.direct_usefulness === 'number' ? candidate.signals.direct_usefulness.toFixed(2) : tr("未记录")} / {typeof candidate.signals?.incremental_information === 'number' ? candidate.signals.incremental_information.toFixed(2) : tr("未记录")}</td>
          <td>{candidate.accepted ? tr("满足补充条件") : tr("未满足补充条件")}</td>
        </tr>)}</tbody>
      </table>
      <p className="decision-record-muted">{tr("数值是模型信号，不等同于正确率。最终追加结果以补充证据记录为准。")}</p>
    </details>}
    {comparison && <details className="decision-comparison">
      <summary><GitCompareArrows aria-hidden />{assist ? tr("查看原证据与补充项") : tr("查看排序对照")}<ChevronDown aria-hidden /></summary>
      <div className="decision-evidence-grid">
        <EvidenceList title={tr("原排序保留")} items={comparison.baseline ?? []} />
        <EvidenceList title={assist ? tr("Decision 补充") : tr("Decision 对照排序")} items={(assist ? comparison.added : comparison.proposed) ?? []} />
      </div>
    </details>}
    {!comparison && record.mode === 'shadow' && record.proposed_ids?.length ? <p className="decision-record-muted">{tr("此条历史只保留了对照标识，未记录来源摘要。")}</p> : null}
  </>
}

export function DecisionRecord({ diagnostics, answer }: { diagnostics?: DecisionDiagnostics; answer: string }) {
  useTranslation()
  if (!diagnostics) return null
  const runs = diagnostics.retrieval?.runs ?? []
  const config = diagnostics.retrieval?.jev_config
  const audit = diagnostics.jev_citation_audit
  const checkpoint = diagnostics.retrieval?.context_checkpoint
  const summary = decisionSummary(diagnostics)
  const units = audit?.units ?? []
  const coverage = audit?.coverage
  const failed = diagnostics.code === 'jev_required_failed'
  if (!failed && config?.intent_mode === 'off' && config.rerank_mode === 'off' && config.citation_mode === 'off') return null
  return <details className="decision-record">
    <summary className="decision-record-summary">
      <SlidersHorizontal aria-hidden className="decision-record-symbol" />
      <span className="decision-record-title">{tr("Decision 记录")}</span>
      <span className="decision-record-summary-copy">{summary.join(' · ')}</span>
      <ChevronDown aria-hidden className="decision-record-chevron" />
    </summary>
    <div className="decision-record-body">
      {failed && <p className="decision-record-failure">{tr("{{stage}}未完成，本次请求已停止，未回退到其他模型。{{reason}}", { stage: diagnostics.stage === 'rerank' ? tr("证据判断") : tr("意图判断"), reason: decisionReason(diagnostics.reason) })}</p>}
      {runs.map((run, index) => <div className="decision-record-run" key={index}>
        {runs.length > 1 && <p className="decision-record-run-label">{tr("检索记录 {{index}}{{extra}}", { index: index + 1, extra: run.preplanned_query ? tr(" · Agent 子问题") : '' })}</p>}
        {run.fast_path && <p className="decision-record-note">{decisionReason(run.fast_path)}</p>}
        <div className="decision-record-stage">
          <ScanLine aria-hidden />
          <div><p className="decision-record-stage-heading"><strong>{run.jev_decision?.strategy === 'plan_first' ? tr("规划与来源动作") : tr("意图识别")}</strong><span>{intentOutcome(run.jev_decision)}</span></p>
            <ModelUsed record={run.jev_decision} />
            {run.jev_decision?.reason && <p className="decision-record-note">{decisionReason(run.jev_decision.reason)}</p>}
            {run.jev_decision?.strategy === 'plan_first' ? <PlanDetails plan={run.jev_decision.plan} /> : <>
              {run.jev_decision?.accepted && <p className="decision-record-note">{run.jev_decision.forced ? tr("严格模式通过采用条件后使用本次判断；查询改写仍使用原模型。") : tr("本次判断满足采用条件，查询改写仍使用原模型。")}</p>}
              <RequirementsDetails requirements={run.jev_decision?.requirements} />
              {!!run.jev_decision?.blockers?.length && <ul className="decision-record-reasons" aria-label={tr("未通过的独立采用条件")}>
                {run.jev_decision.blockers.map(blocker => <li key={blocker.field}>{intentBlockerLabel(blocker)}</li>)}
              </ul>}
            </>}
          </div>
        </div>
        <div className="decision-record-stage">
          <ListPlus aria-hidden />
          <div><p className="decision-record-stage-heading"><strong>{tr("检索证据")}</strong><span>{rerankOutcome(run.reranking_scorer)}</span></p>
            <ModelUsed record={run.reranking_scorer} />
            {run.reranking_scorer?.reason && <p className="decision-record-note">{decisionReason(run.reranking_scorer.reason)}</p>}
            {run.reranking_scorer && <RankingDetails record={run.reranking_scorer} />}
          </div>
        </div>
        {(runs.length > 1 || !diagnostics.retrieval?.decision_coverage) && <CoverageDetails coverage={run.decision_coverage} />}
      </div>)}
      {checkpoint && <ContextCheckpointDetails record={checkpoint} />}
      <CoverageDetails coverage={diagnostics.retrieval?.decision_coverage} final />
      {audit && <div className="decision-record-citations">
        <p className="decision-record-stage-heading"><strong>{tr("引用诊断")}</strong><span>{audit.strategy === 'batch_choice' ? tr("批量判断") : tr("逐条判断")}</span></p>
        <ModelUsed record={audit.batch_metadata} />
        {coverage && <p className="decision-record-note">{tr("已诊断 {{evaluated}} / {{cited}} 条带引用声明{{extra}}。", { evaluated: coverage.evaluated_units ?? 0, cited: coverage.cited_units ?? units.length, extra: coverage.unattributed_spans ? tr("；另有 {{v0}} 处正文未纳入诊断", { v0: coverage.unattributed_spans }) : '' })}</p>}
        {audit.reason && <p className="decision-record-note">{decisionReason(audit.reason)}</p>}
        <p className="decision-record-muted">{tr("仅核对已列声明与提供的来源文本，不代表整份答案正确。媒体引用使用已有描述或转写，不核对原始图片、音频或视频。")}</p>
        {!!units.length && <ol className="decision-citation-units">{units.map((unit, index) => {
          const status = citationStatus(unit)
          return <li key={`${unit.start ?? index}-${unit.end ?? index}`} className={`decision-citation-unit is-${status.tone}`}>
            <div className="decision-citation-unit-heading"><span>{status.label}</span><span>{unit.citation_ids?.map(id => `[${id}]`).join(' ')}</span></div>
            <blockquote>{citationStatement(answer, unit)}</blockquote>
            {unit.evidence_basis === 'derived_text' && <p className="decision-citation-basis">{tr("依据：{{sources}}的已有描述 / 转写。未检查原始媒体；描述缺少细节不代表原媒体没有该细节。", { sources: unit.source_modalities?.map(modality => tr(modality === 'doc' ? "文档" : modalityLabels[modality])).join(getLanguage() === 'en-US' ? ', ' : '、') || tr("媒体") })}</p>}
            {unit.evidence_basis === 'source_text' && <p className="decision-record-muted">{tr("依据：引用来源正文。")}</p>}
            <ModelUsed record={unit.result?.metadata} />
            {unit.result?.reason && <p className="decision-record-note">{decisionReason(unit.result.reason)}</p>}
          </li>
        })}</ol>}
        {!units.length && <p className="decision-record-muted">{tr("没有可展示的声明诊断记录。")}</p>}
      </div>}
      {!runs.length && !audit && !checkpoint && !failed && <p className="decision-record-note">{tr("此条消息未保留各环节的执行记录。")}</p>}
      {config?.model && <p className="decision-record-config">{tr("本次请求的配置：{{provider}} · {{model}}。实际调用以各环节记录为准。", { provider: decisionProviderName(config.provider) ?? '', model: config.model })}</p>}
    </div>
  </details>
}
