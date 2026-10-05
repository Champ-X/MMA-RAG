import { useState } from 'react'
import { ChevronDown, Check, AlertCircle, Loader2, Circle, ArrowUpRight, RotateCcw } from 'lucide-react'
import { piStatusLabel, piTerminal, type PiTrace, type PiStep } from '@/types/pi'
import { piApi } from '@/services/piAgent'
import { useChatStore } from '@/store/useChatStore'
import './piAgent.css'

const toolLabels: Record<string, string> = {
  list_sources: '发现来源', search: '检索材料', read_source: '阅读原文', expand_context: '核对上下文',
  recall_evidence: '回看证据', inspect_media: '查看媒体', query_table: '读取与计算表格', submit_answer: '提交回答', ask_user: '请求补充信息',
}
const observationLabels: Record<string, string> = { parsed_text: '解析原文', caption: '索引描述', transcript: '转写', media_observation: '媒体观察', calculation: '表格计算' }
function EvidenceList({ trace }: { trace: PiTrace }) {
  const [selected, setSelected] = useState<number>(), [text, setText] = useState('')
  const [sourceId, setSourceId] = useState<string>(), [loading, setLoading] = useState(false)
  return <details className="pi-evidence-list"><summary>来源与证据 · {trace.evidence.length}</summary>
    <div className="pi-evidence-sources">{trace.evidence.map(evidence => <button type="button" key={evidence.id} disabled={loading}
      aria-pressed={selected === evidence.id} onClick={() => {
        setSelected(evidence.id); setLoading(true); setText(''); setSourceId(undefined)
        void piApi.evidence(trace.runId).then(value => {
          const found = value.evidence.find(e => e.id === evidence.id)
          setText(found?.content || '证据暂不可用'); setSourceId(found?.source_id)
        }).catch(error => setText(error instanceof Error ? error.message : '证据读取失败')).finally(() => setLoading(false))
      }}><span>[{evidence.id}] {evidence.file_name}</span><small>{observationLabels[evidence.observation] || evidence.observation}</small></button>)}</div>
    {selected != null && <div className="pi-evidence-content"><strong>证据 [{selected}]</strong>
      <p>{loading ? '读取原始记录…' : text}</p>
      {sourceId && <a href={piApi.sourceUrl(trace.runId, sourceId)} target="_blank" rel="noreferrer">打开原文件 <ArrowUpRight size={11} aria-hidden /></a>}
    </div>}
  </details>
}
function Step({ step, runId }: { step: PiStep; runId: string }) {
  const [result, setResult] = useState<string>(), [loading, setLoading] = useState(false)
  const duration = step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : ''
  const status = step.status === 'running' ? '进行中' : step.status === 'cancelled' ? '已取消' : step.status === 'failed' ? '未完成' : ''
  return <li className={`pi-step pi-step--${step.status}`}>
    <span className="pi-step-icon" aria-hidden>{step.status === 'running' ? <Loader2 size={13} className="pi-spin" /> : step.status === 'failed' ? <AlertCircle size={13} /> : step.status === 'completed' ? <Check size={13} /> : <Circle size={12} />}</span>
    <div className="min-w-0 flex-1">
      <div className="pi-step-heading"><span>{toolLabels[step.label] || (step.kind === 'model' ? `模型 · ${step.label}` : step.label)}</span>
        <span className="pi-step-duration">{[status, duration].filter(Boolean).join(' · ')}</span></div>
      {step.text && <p className="pi-step-text">{step.text}</p>}
      {step.args && <details className="pi-step-details"><summary>调用参数</summary><pre>{JSON.stringify(step.args, null, 2)}</pre></details>}
      {!!step.evidenceIds?.length && <p className="pi-evidence-ids">已返回证据 {step.evidenceIds.map(id => `[${id}]`).join(' ')}</p>}
      {step.artifactId && <button type="button" className="pi-result-button" disabled={loading} onClick={() => {
        if (result) { setResult(undefined); return }
        setLoading(true)
        void piApi.artifact(runId, step.artifactId!).then(value => setResult(JSON.stringify(value, null, 2)))
          .catch(error => setResult(error instanceof Error ? error.message : '结果读取失败')).finally(() => setLoading(false))
      }}>{loading ? '读取中…' : result ? '收起工具结果' : '查看工具结果'} <ArrowUpRight size={11} aria-hidden /></button>}
      {result && <pre className="pi-artifact">{result}</pre>}
    </div>
  </li>
}

export function PiProcess({ trace }: { trace: PiTrace }) {
  const [expanded, setOpen] = useState<boolean | null>(null)
  const open = expanded ?? !piTerminal(trace.status)
  const tools = trace.steps.filter(step => step.kind === 'tool')
  const duration = trace.usage?.duration_ms
  const reconnect = () => {
    const store = useChatStore.getState()
    for (const session of store.sessions) {
      const message = session.messages.find(m => m.pi?.runId === trace.runId)
      if (message?.pi) store.updateMessage(session.id, message.id, { pi: { ...message.pi, connectionError: undefined } })
    }
  }
  return <section className="pi-process" aria-label="Pi Agent 研究过程">
    <button type="button" className="pi-process-header" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="pi-mark" aria-hidden>π</span><span className="pi-process-title">Pi Agent <span>{piStatusLabel[trace.status]}</span></span>
      <span className="pi-process-count">{tools.length} 次工具 · {trace.evidence.length} 条证据{duration != null ? ` · ${(duration / 1000).toFixed(1)}s` : ''}</span>
      <ChevronDown size={15} className={open ? 'rotate-180' : ''} aria-hidden />
    </button>
    {trace.connectionError && <div className="pi-connection-error" role="alert">连接中断，任务状态待同步。<button type="button" onClick={reconnect}><RotateCcw size={12} aria-hidden />重新连接</button></div>}
    {open && <div className="pi-process-body">
      <p className="pi-process-caption">行动说明与实际工具记录 · {trace.model || 'Pi'}{trace.status === 'queued' ? ' · 等待可用执行名额' : ''}</p>
      {trace.steps.length ? <ol className="pi-step-list">{trace.steps.map(step => <Step key={step.id} step={step} runId={trace.runId} />)}</ol>
        : <p className="pi-process-caption">{trace.status === 'queued' ? '任务已保存，正在排队。' : '正在连接任务记录…'}</p>}
      {!!trace.evidence.length && <EvidenceList trace={trace} />}
      {trace.usage && <p className="pi-process-caption">模型调用 {trace.usage.model_requests ?? 0} 次 · Token {trace.usage.model_tokens?.toLocaleString() ?? '未知'}{trace.usage.unknown_usage_requests ? '（含保守估算）' : ''}</p>}
      {trace.message && <p className="pi-process-message">{trace.message}</p>}
      {!!trace.limitations?.length && <div className="pi-limitations"><strong>尚未覆盖</strong><ul>{trace.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
      {!!trace.options?.length && <p className="pi-process-message">可补充：{trace.options.join(' / ')}</p>}
    </div>}
    {trace.draft && !piTerminal(trace.status) && <details className="pi-draft"><summary>正在形成回答 · 引用待确认</summary><p>{trace.draft}</p></details>}
  </section>
}
