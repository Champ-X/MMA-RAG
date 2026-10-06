import { apiClient } from './api_client'
import type { ChatScopeFile } from '@/store/useChatStore'
import type { ChatMention } from '@/lib/chatReferences'
import { persistMentions } from '@/lib/chatReferences'
import { referenceFilesFromMentions } from '@/lib/chatReferenceScope'
import type { PiConfig, PiEvent, PiRun } from '@/types/pi'
import type { CitationReference } from '@/types/sse'

const base = () => `${apiClient.getBaseURL()}/pi`
export function piOriginalUrl(reference: CitationReference): string | undefined {
  const path = reference.file_path
  if (!reference.pi_run_id || !path?.startsWith(`/api/pi/runs/${encodeURIComponent(reference.pi_run_id)}/sources/`)) return undefined
  return `${base()}${path.slice('/api/pi'.length)}`
}

function normalizeAssets(event: PiEvent): PiEvent {
  if (!Array.isArray(event.data.citations)) return event
  return { ...event, data: { ...event.data, citations: (event.data.citations as CitationReference[]).map(citation => {
    const url = piOriginalUrl(citation)
    return url ? { ...citation, ...(citation.img_url ? { img_url: url } : {}),
      ...(citation.audio_url ? { audio_url: url } : {}), ...(citation.video_url ? { video_url: url } : {}) } : citation
  }) } }
}
function headers(): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}
async function checked(response: Response) {
  if (response.ok) return response
  const body = await response.json().catch(() => ({}))
  const detail = body.detail
  throw new Error(typeof detail === 'string' ? detail : detail?.message || `Agent 服务返回 ${response.status}`)
}
const serializeFiles = (files: ChatScopeFile[]) => files.map(file => ({ kb_id: file.kbId, file_id: file.fileId,
  name: file.name, type: file.type || '', kb_name: file.kbName || '' }))

export const piApi = {
  async list(sessionId: string): Promise<{ runs: PiRun[] }> {
    return (await checked(await fetch(`${base()}/runs?session_id=${encodeURIComponent(sessionId)}`,
      { headers: headers(), signal: AbortSignal.timeout(5000) }))).json()
  },
  async config(): Promise<PiConfig> { return (await checked(await fetch(`${base()}/config`, { headers: headers() }))).json() },
  async get(runId: string): Promise<PiRun> { return (await checked(await fetch(`${base()}/runs/${runId}`, { headers: headers() }))).json() },
  async cancel(runId: string): Promise<PiRun> { return (await checked(await fetch(`${base()}/runs/${runId}/cancel`, { method: 'POST', headers: headers() }))).json() },
  async artifact(runId: string, id: string): Promise<unknown> { return (await checked(await fetch(`${base()}/runs/${runId}/artifacts/${id}`, { headers: headers() }))).json() },
  async evidence(runId: string): Promise<{ evidence: Array<{ id: number; content: string; source_id: string; version: string }> }> {
    return (await checked(await fetch(`${base()}/runs/${runId}/evidence`, { headers: headers() }))).json()
  },
  sourceUrl(runId: string, sourceId: string) { return `${base()}/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(sourceId)}/content` },
  async create(options: { requestId: string; sessionId: string; message: string; model?: string; knowledgeBaseIds?: string[];
    selectedFiles?: ChatScopeFile[]; mentions?: ChatMention[]; files?: File[]; attachmentIds?: string[];
    history: Array<{ role: string; content: string }>; parentRunId?: string }): Promise<PiRun> {
    const spec = { protocol_version: 1, client_request_id: options.requestId, session_id: options.sessionId,
      message: options.message || '请分析上传的材料。', model: options.model,
      knowledge_base_ids: options.knowledgeBaseIds || [], selected_files: serializeFiles(options.selectedFiles || []),
      reference_files: serializeFiles(referenceFilesFromMentions(options.mentions || [])),
      mentions: persistMentions(options.mentions || []), history: options.history, parent_run_id: options.parentRunId }
    let body: BodyInit, requestHeaders = headers()
    if (options.files?.length) {
      const form = new FormData()
      form.set('request', JSON.stringify(spec))
      form.set('attachment_ids', JSON.stringify(options.attachmentIds || []))
      options.files.forEach(file => form.append('files', file))
      body = form
    } else {
      body = JSON.stringify(spec)
      requestHeaders = { ...requestHeaders, 'Content-Type': 'application/json' }
    }
    // A transport retry uses the same key: it cannot purchase another run.
    let response: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      try { response = await fetch(`${base()}/runs`, { method: 'POST', headers: requestHeaders, body }); break }
      catch (error) { if (attempt === 1) throw error }
    }
    return (await checked(response!)).json()
  },
}

export async function watchPiRun(runId: string, after: () => number, onEvent: (event: PiEvent) => void, signal: AbortSignal) {
  let retries = 0
  while (!signal.aborted) {
    try {
      const response = await checked(await fetch(`${base()}/runs/${runId}/events?after=${after()}`, { headers: headers(), signal }))
      if (!response.body) throw new Error('Agent 事件流不可用')
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let buffer = ''
      try {
        while (!signal.aborted) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
          let boundary: number
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
            if (data) {
              const event = JSON.parse(data) as PiEvent
              if (event.protocol_version !== 1 || event.run_id !== runId) throw new Error('Agent 事件协议不匹配')
              onEvent(normalizeAssets(event))
              retries = 0
              if (/^run\.(completed|partial|needs_input|cancelled|failed)$/.test(event.type)) return
            }
          }
          if (done) break
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      // A completed run can have no newer events if another tab already saved them.
      const run = await piApi.get(runId)
      if (['completed', 'partial', 'needs_input', 'cancelled', 'failed'].includes(run.status) && after() >= run.seq) return
      throw new Error('Agent 过程连接中断')
    } catch (error) {
      if (signal.aborted) return
      if (++retries > 4) throw error
      await new Promise<void>(resolve => {
        const timer = setTimeout(done, Math.min(500 * 2 ** retries, 8000))
        function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
        signal.addEventListener('abort', done, { once: true })
      })
    }
  }
}
