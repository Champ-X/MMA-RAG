import { useId, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Check, AlertCircle, Loader2, ArrowUpRight, RotateCcw, ArrowUp, ArrowDown,
  Search, Files, FileText, ScanEye, Table2, MessageCircle, Sparkles, Braces, Cpu, Clock3,
  Layers, ListChecks, Archive, Image, Music2, Video, type LucideIcon } from 'lucide-react'
import { piStatusLabel, piTerminal, type PiTrace, type PiStep } from '@/types/pi'
import { piApi } from '@/services/piAgent'
import { useChatStore } from '@/store/useChatStore'
import { submissionFeedback } from '@/lib/piTrace'
import { isRoutinePiModel, piModelDisplayName, piStepFocus } from '@/lib/piTraceView'
import './piAgent.css'
import './piProcess.css'

const toolLabels: Record<string, string> = {
  set_answer_requirements: '登记回答要求',
  list_sources: '发现来源', search: '检索材料', read_source: '阅读材料', expand_context: '核对上下文',
  recall_evidence: '回看证据', inspect_media: '查看媒体', query_table: '读取与计算表格',
  check_answer: '核对草稿', submit_answer: '提交回答', ask_user: '请求补充信息',
}
const toolIcons: Record<string, LucideIcon> = {
  list_sources: Files, search: Search, read_source: FileText, expand_context: Layers,
  recall_evidence: Archive, inspect_media: ScanEye, query_table: Table2,
  set_answer_requirements: ListChecks, check_answer: ListChecks, submit_answer: Check, ask_user: MessageCircle,
}
const observationLabels: Record<string, string> = {
  parsed_text: '解析文本', caption: '索引描述', transcript: '转写', media_observation: '媒体观察', calculation: '表格计算',
}
const modalityLabels: Record<string, string> = { doc: '文档', image: '图片', audio: '音频', video: '视频' }
const modalityIcons: Record<string, LucideIcon> = { doc: FileText, image: Image, audio: Music2, video: Video }
const stepStatusLabels: Record<PiStep['status'], string> = {
  running: '进行中', completed: '完成', failed: '未完成', cancelled: '已取消',
}
interface EvidenceSelection {
  id: number
  loading: boolean
  content: string
  sourceId?: string
  error?: boolean
}

function stepLabel(step: PiStep): string {
  return toolLabels[step.label] || (step.kind === 'model' ? '模型 · ' + piModelDisplayName(step.label) : step.label)
}

function EvidenceList({ trace, selection, onSelect }: {
  trace: PiTrace; selection?: EvidenceSelection; onSelect: (id: number) => void
}) {
  const selected = trace.evidence.find(evidence => evidence.id === selection?.id)
  return <div className="pi-evidence-body">
    <div className="pi-evidence-sources">{trace.evidence.map(evidence => {
      const EvidenceIcon = modalityIcons[evidence.modality] || FileText
      return <button type="button" key={evidence.id} data-modality={evidence.modality}
      aria-label={'查看' + (modalityLabels[evidence.modality] || '') + '证据 ' + evidence.id + '：' + evidence.file_name}
      aria-pressed={selection?.id === evidence.id} onClick={() => onSelect(evidence.id)}>
      <span className="pi-evidence-number"><EvidenceIcon size={14} strokeWidth={1.75} aria-hidden />{evidence.id}</span>
      <span className="pi-evidence-source-name"><span>{evidence.file_name}</span>
        <small>{modalityLabels[evidence.modality] || '资料'} · {observationLabels[evidence.observation] || evidence.observation}</small></span>
      <ChevronRight size={13} aria-hidden />
    </button>})}</div>
    {selection && <div className="pi-evidence-content" aria-busy={selection.loading}>
      <div className="pi-evidence-content-heading" data-modality={selected?.modality}><strong>证据 [{selection.id}]</strong><span>{selected?.file_name}</span>
        {selection.sourceId && <a href={piApi.sourceUrl(trace.runId, selection.sourceId)} target="_blank" rel="noreferrer">
          原文件 <ArrowUpRight size={12} aria-hidden /></a>}</div>
      {selection.loading ? <p role="status">读取原始记录…</p>
        : <p className="pi-evidence-excerpt" tabIndex={0} role={selection.error ? 'alert' : undefined}>{selection.content}</p>}
    </div>}
  </div>
}

function Step({ step, runId, evidence, selectedEvidenceId, onEvidenceSelect }: {
  step: PiStep; runId: string; evidence: PiTrace['evidence']; selectedEvidenceId?: number; onEvidenceSelect: (id: number) => void
}) {
  const [result, setResult] = useState<string>(), [loading, setLoading] = useState(false)
  const [resultError, setResultError] = useState(false)
  const feedback = submissionFeedback(step)
  const focus = piStepFocus(step)
  const modalities = Array.isArray(step.args?.modalities)
    ? step.args.modalities.filter((value): value is string => typeof value === 'string') : []
  const Icon = step.kind === 'action' ? Sparkles : step.kind === 'model' ? Cpu
    : step.kind === 'tool' ? toolIcons[step.label] || Braces : Layers
  const loadResult = () => {
    if (result != null && !resultError) { setResult(undefined); return }
    if (!step.artifactId) return
    setLoading(true); setResultError(false)
    void piApi.artifact(runId, step.artifactId).then(value => setResult(JSON.stringify(value, null, 2)))
      .catch(error => { setResult(error instanceof Error ? error.message : '结果读取失败'); setResultError(true) })
      .finally(() => setLoading(false))
  }
  return <li className={'pi-step pi-step--' + step.status} data-kind={step.kind} data-step-id={step.id}>
    <span className="pi-step-node" aria-hidden>{step.status === 'running'
      ? <Loader2 size={15} className="pi-spin" /> : step.status === 'failed' ? <AlertCircle size={15} /> : <Icon size={15} />}</span>
    <div className="pi-step-card">
      <div className="pi-step-heading"><strong>{stepLabel(step)}</strong>
        <span className="pi-step-meta"><span className="pi-step-status">
          {step.status === 'completed' && <Check size={11} aria-hidden />}{stepStatusLabels[step.status]}</span>
          {step.durationMs != null && <span className="pi-step-duration">{(step.durationMs / 1000).toFixed(1)}s</span>}
        </span>
      </div>
      {focus && <p className="pi-step-focus">{focus}</p>}
      {modalities.length > 0 && <div className="pi-step-modalities">{modalities.map((value, index) =>
        <span key={value + '-' + index}>{modalityLabels[value] || value}</span>)}</div>}
      {feedback ? <>
        <p className="pi-step-text">{feedback.summary}</p>
        <details className="pi-step-details"><summary><ChevronRight size={12} aria-hidden />校验详情</summary>
          <pre tabIndex={0}><code>{feedback.detail}</code></pre></details>
      </> : step.text && <p className="pi-step-text">{step.text}</p>}
      {!!step.evidenceIds?.length && <div className="pi-evidence-ids"><Files size={12} aria-hidden /><span>证据</span>
        {step.evidenceIds.map(id => {
          const source = evidence.find(item => item.id === id)
          const EvidenceIcon = modalityIcons[source?.modality || ''] || Files
          return <button type="button" key={id} data-modality={source?.modality}
            aria-label={'查看' + (source ? modalityLabels[source.modality] || '' : '') + '证据 ' + id + (source ? '：' + source.file_name : '')}
            aria-pressed={selectedEvidenceId === id} onClick={() => onEvidenceSelect(id)}>
            <span className="pi-evidence-icon"><EvidenceIcon size={13} strokeWidth={1.75} aria-hidden /></span><span>[{id}]</span></button>
        })}</div>}
      {(step.args || step.artifactId) && <details className="pi-step-details">
        <summary><ChevronRight size={12} aria-hidden /><Braces size={12} aria-hidden />调用详情</summary>
        <div className="pi-tool-record">
          {step.args && <><span className="pi-record-label">调用参数</span><pre tabIndex={0}><code>{JSON.stringify(step.args, null, 2)}</code></pre></>}
          {step.artifactId && <button type="button" className="pi-result-button" disabled={loading} onClick={loadResult}>
            {loading ? '读取中…' : resultError ? '重新读取工具结果' : result != null ? '收起工具结果' : '查看工具结果'}
            <ChevronDown size={12} aria-hidden /></button>}
          {result != null && <pre className="pi-artifact" tabIndex={0} role={resultError ? 'alert' : undefined}><code>{result}</code></pre>}
        </div>
      </details>}
    </div>
  </li>
}

export function PiProcess({ trace }: { trace: PiTrace }) {
  const [expanded, setOpen] = useState<boolean | null>(null)
  const [showModels, setShowModels] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [selection, setSelection] = useState<EvidenceSelection>()
  const evidenceRef = useRef<HTMLDetailsElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()
  const open = expanded ?? !piTerminal(trace.status)
  const tools = trace.steps.filter(step => step.kind === 'tool')
  const hiddenModels = trace.steps.filter(isRoutinePiModel).length
  const visibleSteps = showModels ? trace.steps : trace.steps.filter(step => !isRoutinePiModel(step))
  const duration = trace.usage?.duration_ms
  const activeStep = [...trace.steps].reverse().find(step => step.status === 'running')
  const readEvidence = (id: number) => {
    setSelection({ id, loading: true, content: '' })
    void piApi.evidence(trace.runId).then(value => {
      const found = value.evidence.find(item => item.id === id)
      setSelection(current => current?.id === id
        ? { id, loading: false, content: found?.content || '证据暂不可用', sourceId: found?.source_id, error: !found } : current)
    }).catch(error => setSelection(current => current?.id === id
      ? { id, loading: false, content: error instanceof Error ? error.message : '证据读取失败', error: true } : current))
      .finally(() => requestAnimationFrame(() => evidenceRef.current?.querySelector('.pi-evidence-content')?.scrollIntoView({ block: 'nearest' })))
  }
  const revealEvidence = (id: number) => {
    setEvidenceOpen(true); readEvidence(id)
    requestAnimationFrame(() => evidenceRef.current?.scrollIntoView({ block: 'nearest' }))
  }
  const reconnect = () => {
    const store = useChatStore.getState()
    for (const session of store.sessions) {
      const message = session.messages.find(m => m.pi?.runId === trace.runId)
      if (message?.pi) store.updateMessage(session.id, message.id, { pi: { ...message.pi, connectionError: undefined } })
    }
  }
  return <section className="pi-process" data-status={trace.status} data-expanded={open} aria-label="Agent Mode 研究过程">
    <button type="button" className="pi-process-header" aria-expanded={open} aria-controls={bodyId}
      aria-label={'Agent Mode 研究过程，' + piStatusLabel[trace.status] + '，' + tools.length + ' 次工具，' + trace.evidence.length + ' 条证据'
        + (duration != null ? '，耗时 ' + (duration / 1000).toFixed(1) + ' 秒' : '')} onClick={() => setOpen(!open)}>
      <span className="pi-mark" aria-hidden>π</span>
      <span className="pi-process-identity"><strong>Agent Mode</strong></span>
      <span className="pi-run-status" role="status"><span className="pi-run-status-dot" aria-hidden />{piStatusLabel[trace.status]}</span>
      <span className="pi-process-count"><span><Braces size={13} aria-hidden /><b>{tools.length}</b> 次工具</span>
        <span><Files size={13} aria-hidden /><b>{trace.evidence.length}</b> 条证据</span>
        {duration != null && <span><Clock3 size={13} aria-hidden /><b>{(duration / 1000).toFixed(1)}</b>s</span>}</span>
      <span className="pi-process-toggle" aria-hidden><ChevronDown size={14} className="pi-process-chevron" /></span>
    </button>
    {trace.connectionError && <div className="pi-connection-error" role="alert"><AlertCircle size={14} aria-hidden />
      连接中断，任务状态待同步。<button type="button" onClick={reconnect}><RotateCcw size={12} aria-hidden />重新连接</button></div>}
    {open && <div className="pi-process-body" id={bodyId}>
      <div className="pi-trace-toolbar">
        <span className="pi-trace-model"><Cpu size={13} aria-hidden />{trace.model ? piModelDisplayName(trace.model) : 'Pi'}</span>
        <div className="pi-trace-views" role="group" aria-label="过程记录视图">
          <button type="button" aria-pressed={!showModels} onClick={() => setShowModels(false)}>研究轨迹</button>
          <button type="button" aria-pressed={showModels} onClick={() => setShowModels(true)}>完整记录 <span>{trace.steps.length}</span></button>
        </div>
      </div>
      {!piTerminal(trace.status) && <div className="pi-live-activity" role="status"><Loader2 size={13} className="pi-spin" aria-hidden />
        {trace.status === 'queued' ? '等待可用执行名额' : trace.status === 'cancelling' ? '正在取消任务'
          : activeStep ? stepLabel(activeStep) : '正在同步任务记录'}
      </div>}
      {visibleSteps.length > 0 && <div className="pi-trace-hint">
        <div className="pi-trace-summary">
          <span className="pi-trace-step-count"><ListChecks size={12} aria-hidden /><b>{visibleSteps.length}</b> 个步骤</span>
          {!showModels && hiddenModels > 0 && <button type="button" className="pi-trace-folded"
            title="显示完整记录，包含已完成的模型调用" onClick={() => setShowModels(true)}>
            <Cpu size={12} aria-hidden /><b>{hiddenModels}</b> 次模型调用已折叠<ChevronRight size={11} aria-hidden />
          </button>}
        </div>
        <div className="pi-timeline-jumps" role="group" aria-label="时间线位置">
          <button type="button" aria-label="跳到时间线第一步" onClick={() => timelineRef.current?.scrollTo({ top: 0 })}>
            <ArrowUp size={11} aria-hidden />开头</button>
          <button type="button" aria-label="跳到时间线最后一步" onClick={() => {
            const timeline = timelineRef.current
            if (timeline) timeline.scrollTo({ top: timeline.scrollHeight })
          }}><ArrowDown size={11} aria-hidden />最新</button>
        </div>
      </div>}
      {visibleSteps.length ? <div className="pi-timeline-scroll" ref={timelineRef} tabIndex={0} role="region" aria-label="Agent 行动时间线">
        <ol className="pi-step-list">{visibleSteps.map(step => <Step key={step.id} step={step} runId={trace.runId}
          evidence={trace.evidence} selectedEvidenceId={selection?.id} onEvidenceSelect={revealEvidence} />)}</ol>
      </div> : <p className="pi-process-caption">{trace.status === 'queued' ? '任务已保存，正在排队。' : '正在连接任务记录…'}</p>}
      {!!trace.evidence.length && <details className="pi-evidence-list" ref={evidenceRef} open={evidenceOpen}
        onToggle={event => setEvidenceOpen(event.currentTarget.open)}>
        <summary><Files size={15} aria-hidden /><strong>来源与证据</strong><span className="pi-evidence-count">{trace.evidence.length}</span>
          <ChevronDown size={14} className="pi-evidence-chevron" aria-hidden /></summary>
        <EvidenceList trace={trace} selection={selection} onSelect={readEvidence} />
      </details>}
      {trace.usage && <div className="pi-usage"><span><Cpu size={12} aria-hidden />模型调用 {trace.usage.model_requests ?? '未知'} 次</span>
        <span>Token {trace.usage.model_tokens?.toLocaleString() ?? '未知'}{trace.usage.unknown_usage_requests ? '（含保守估算）' : ''}</span></div>}
      {trace.message && <p className="pi-process-message">{trace.message}</p>}
      {!!trace.limitations?.length && <details className="pi-limitations">
        <summary><AlertCircle size={14} aria-hidden /><strong>尚未覆盖</strong>
          <span className="pi-limitations-count">{trace.limitations.length} 项</span>
          <ChevronDown size={13} className="pi-limitations-chevron" aria-hidden /></summary>
        <ul>{trace.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>
      </details>}
      {!!trace.options?.length && <p className="pi-process-message">可补充：{trace.options.join(' / ')}</p>}
    </div>}
    {trace.draft && !piTerminal(trace.status) && <details className="pi-draft"><summary><ChevronRight size={13} aria-hidden />
      正在形成回答 · 引用待确认</summary><p>{trace.draft}</p></details>}
  </section>
}
