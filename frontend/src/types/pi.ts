import type { CitationReference } from './sse'
import type { ChatMention } from '../lib/chatReferences'

export type PiStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'partial' | 'needs_input' | 'cancelled' | 'failed'
export interface PiEvent {
  protocol_version: 1
  run_id: string
  event_id: string
  seq: number
  type: string
  timestamp: number
  span_id?: string
  parent_span_id?: string
  data: Record<string, unknown>
}
export interface PiStep {
  id: string
  kind: 'model' | 'tool' | 'action' | 'context'
  label: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  durationMs?: number
  text?: string
  args?: Record<string, unknown>
  evidenceIds?: number[]
  artifactId?: string
  parentId?: string
}
export interface PiTrace {
  runId: string
  requestId: string
  status: PiStatus
  seq: number
  startedAt: number
  model?: string
  steps: PiStep[]
  evidence: Array<{ id: number; file_name: string; modality: string; observation: string; locator: Record<string, unknown> }>
  draft: string
  answer?: string
  citations?: CitationReference[]
  limitations?: string[]
  options?: string[]
  usage?: Record<string, number>
  message?: string
  connectionError?: string
}
export interface PiRun {
  id: string
  status: PiStatus
  seq: number
  session_id: string
  created_at: number
  config: { model: string }
  request: { client_request_id: string; message: string; mentions?: ChatMention[];
    selected_files?: Array<{ kb_id: string; file_id: string; name: string; type?: string; kb_name?: string }>;
    attachments?: Array<{ id: string; name: string; modality: 'image' | 'audio' | 'video'; size: number }> }
  state: { answer?: string; citations?: CitationReference[]; limitations?: string[]; options?: string[]; message?: string; usage?: Record<string, number>; answer_plan?: unknown }
}
export interface PiConfig {
  enabled: boolean
  default_model: string
  models: string[]
}
export const piTerminal = (status: PiStatus) => ['completed', 'partial', 'needs_input', 'cancelled', 'failed'].includes(status)
export const piStatusLabel: Record<PiStatus, string> = {
  queued: '排队中', running: '自主研究中', cancelling: '正在取消', completed: '研究完成', partial: '部分完成',
  needs_input: '等待补充', cancelled: '已取消', failed: '运行中断',
}
