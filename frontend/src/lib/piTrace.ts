import { piTerminal, type PiEvent, type PiRun, type PiStep, type PiTrace } from '../types/pi'

export function initialPiTrace(run: PiRun): PiTrace {
  return { runId: run.id, requestId: run.request.client_request_id, status: 'queued',
    seq: 0, startedAt: run.created_at * 1000, model: run.config.model, steps: [], evidence: [], draft: '' }
}

export function applyPiEvent(previous: PiTrace, event: PiEvent): PiTrace {
  if (event.protocol_version !== 1 || event.run_id !== previous.runId || event.seq <= previous.seq) return previous
  if (previous.seq > 0 && piTerminal(previous.status)) return previous
  // The transport replays missing events before allowing the cursor to advance.
  if (event.seq !== previous.seq + 1) throw new Error('Agent 过程事件存在缺口，正在重新同步')
  const next = { ...previous, seq: event.seq, connectionError: undefined }
  const data = event.data
  const stepId = event.span_id || (data.turn != null ? `model:${data.turn}` : String(data.tool_call_id || event.event_id))
  const updateStep = (step: PiStep) => {
    next.steps = previous.steps.some(s => s.id === step.id)
      ? previous.steps.map(s => s.id === step.id ? step : s) : [...previous.steps, step]
  }
  if (event.type.startsWith('run.')) {
    next.status = String(data.status || event.type.slice(4)) as PiTrace['status']
    if (piTerminal(next.status)) {
      next.answer = typeof data.answer === 'string' ? data.answer : undefined
      next.citations = Array.isArray(data.citations) ? data.citations as PiTrace['citations'] : []
      next.limitations = data.limitations as string[] | undefined
      next.options = data.options as string[] | undefined
      next.message = typeof data.message === 'string' ? data.message : undefined
      next.usage = data.usage as PiTrace['usage']
      next.draft = ''
      next.steps = previous.steps.map(s => s.status === 'running' ? { ...s,
        status: next.status === 'cancelled' ? 'cancelled' : 'failed' } : s)
    }
  } else if (event.type === 'answer.delta') next.draft += String(data.delta || '')
  else if (event.type === 'answer.reset') next.draft = ''
  else if (event.type === 'evidence.added') next.evidence = [...previous.evidence, data as unknown as PiTrace['evidence'][number]]
  else if (event.type === 'action.delta') {
    const id = `action:${data.turn}`
    const old = previous.steps.find(s => s.id === id)
    updateStep({ id, kind: 'action', label: '行动说明', status: 'completed', startedAt: event.timestamp * 1000,
      text: (old?.text || '') + String(data.delta || '') })
  } else if (event.type === 'context.compacted') {
    updateStep({ id: stepId, kind: 'context', label: '已归档较早的工具结果', status: 'completed', startedAt: event.timestamp * 1000,
      text: `${data.archived_tool_results} 份结果保留在任务记录中，可继续读取原始证据。` })
  } else if (event.type === 'budget.finalizing') {
    updateStep({ id: stepId, kind: 'context', label: '正在收束已有证据', status: 'completed', startedAt: event.timestamp * 1000,
      text: String(data.message || '') })
  } else if (event.type === 'sources.started' || event.type === 'sources.completed') {
    const old = previous.steps.find(s => s.id === stepId)
    updateStep({ id: stepId, kind: 'context', label: '准备检索资料', status: event.type === 'sources.started' ? 'running' : 'completed',
      startedAt: old?.startedAt ?? event.timestamp * 1000, durationMs: data.duration_ms as number | undefined,
      text: String(data.message || '') })
  } else if (event.type.startsWith('resource.')) {
    const old = previous.steps.find(s => s.id === stepId)
    updateStep({ id: stepId, kind: 'context', label: '等待服务资源', status: event.type === 'resource.waiting' ? 'running' : 'completed',
      startedAt: old?.startedAt || event.timestamp * 1000, durationMs: data.duration_ms as number | undefined, parentId: event.parent_span_id,
      text: String(data.message || '') })
  } else if (/^(tool|model)\.(started|completed|failed|rejected|cancelled)$/.test(event.type)) {
    const kind = event.type.startsWith('tool.') ? 'tool' : 'model'
    const old = previous.steps.find(s => s.id === stepId)
    const status = event.type.endsWith('started') ? 'running' : event.type.endsWith('cancelled') ? 'cancelled'
      : event.type.endsWith('failed') || event.type.endsWith('rejected') || data.stop_reason === 'error' ? 'failed' : 'completed'
    updateStep({ ...old, id: stepId, kind, label: String(data.name || data.purpose || data.model || kind), status,
      startedAt: old?.startedAt || event.timestamp * 1000,
      durationMs: typeof data.duration_ms === 'number' ? data.duration_ms : old?.durationMs,
      args: data.args as PiStep['args'] || old?.args, parentId: event.parent_span_id || old?.parentId,
      text: typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : old?.text,
      evidenceIds: data.evidence_ids as number[] | undefined || old?.evidenceIds,
      artifactId: typeof data.artifact_id === 'string' ? data.artifact_id : old?.artifactId })
  }
  return next
}
