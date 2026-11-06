import { translate as tr } from '@/i18n'
import { useChatStore } from '@/store/useChatStore'
import { piApi } from '@/services/piAgent'
import { mergePiInputs } from './piTrace'
import type { PiInput, PiTrace } from '@/types/pi'

const submissions = new Set<string>()
function locate(runId: string) {
  for (const session of useChatStore.getState().sessions) {
    const message = session.messages.find(item => item.pi?.runId === runId)
    if (message?.pi) return { sessionId: session.id, messageId: message.id, pi: message.pi }
  }
}
function update(runId: string, transform: (trace: PiTrace) => PiTrace) {
  const current = locate(runId)
  if (current) useChatStore.getState().updateMessage(current.sessionId, current.messageId, { pi: transform(current.pi) })
}

/** Shared by the composer and clarification card. A transport retry retains its
 * persisted request ID, including after reload, until the server acknowledges it. */
export async function submitPiInput(runId: string, message: string, mode: PiInput['mode']) {
  const current = locate(runId)
  if (!current || current.pi.runtime !== 'durable') throw new Error(tr('此任务不支持持续补充，请新建任务。'))
  if (current.pi.runtimePaused) throw new Error(tr('此任务已暂停；恢复持续运行模式后可继续补充。'))
  if (!message.trim()) throw new Error(tr('请输入补充内容。'))
  if (submissions.has(runId)) throw new Error(tr('正在发送补充，请稍候。'))
  if (mode === 'reply' ? current.pi.status !== 'needs_input' : !['queued', 'running'].includes(current.pi.status)) {
    throw new Error(tr('任务状态已变化，请同步后重试。'))
  }
  const retry = current.pi.inputs?.find(input => input.mode === mode && input.message === message.trim()
    && ['sending', 'failed'].includes(input.status))
  const input: PiInput = { request_id: retry?.request_id || crypto.randomUUID(), message: message.trim(), mode,
    status: 'sending', created_at: retry?.created_at || Date.now() / 1000 }
  submissions.add(runId)
  update(runId, trace => ({ ...trace, inputs: mergePiInputs(trace.inputs, [input]) }))
  try {
    const result = await piApi.input(runId, { request_id: input.request_id, message: input.message, mode })
    update(runId, trace => ({ ...trace, connectionError: undefined,
      replayThrough: Math.max(trace.replayThrough || 0, result.run.seq),
      inputs: mergePiInputs(trace.inputs, [...(result.run.state.inputs || []), result.input]) }))
    if (result.input.status === 'rejected') throw new Error(tr('补充未能应用，请检查任务状态后重试。'))
  } catch (error) {
    const acknowledged = locate(runId)?.pi.inputs?.find(item => item.request_id === input.request_id)
    if (acknowledged && ['queued', 'accepted', 'applied'].includes(acknowledged.status)) return
    if (acknowledged?.status === 'rejected') throw error
    update(runId, trace => ({ ...trace, inputs: trace.inputs?.map(item => item.request_id === input.request_id
      ? { ...item, status: 'failed' } : item) }))
    throw error
  } finally {
    submissions.delete(runId)
  }
}
