import { apiClient } from './api_client'
import { getLanguage, translate as t } from '@/i18n'
import { getAuthToken } from '@/lib/setupSession'

export type CollectionStatus = 'planning' | 'searching' | 'review' | 'collecting' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
export type CandidateStatus = 'candidate' | 'downloading' | 'processing' | 'ready' | 'duplicate' | 'failed' | 'skipped'
export interface CollectionCandidate {
  id: string
  title: string
  url: string
  download_url?: string
  source: string
  kind: string
  required_format?: 'pdf' | null
  material_intent?: 'paper' | null
  description: string
  thumbnail_url?: string
  published_at?: string
  author?: string
  license?: string
  width?: number
  height?: number
  warnings?: string[]
  reason?: string
  selection_reason?: string
  status: CandidateStatus
  file_id?: string
  processing_id?: string
  error?: string
  error_code?: string
}
export interface CollectionRun {
  id: string
  kb_id: string
  prompt: string
  mode: 'auto' | 'review'
  max_items: number
  status: CollectionStatus
  plan?: {
    summary?: string
    max_items?: number
    target_count?: number
    review_required_reason?: string
    warnings?: string[]
    requirements?: {
      academic_papers: boolean
      document_format: 'pdf' | null
      requested_kinds: string[]
      recency: 'day' | 'week' | 'month' | 'year' | null
      current_date: string
      publication_years: string[]
    }
  }
  candidates: CollectionCandidate[]
  counts: { found: number; ready: number; failed: number; duplicate: number; selected: number }
  message?: string
  warnings: string[]
  created_at: string
  updated_at: string
}
export interface CollectionCapabilities {
  channels: Record<string, { configured: boolean; available: boolean; kinds: string[]; reason?: string }>
  limits: { max_items: number; max_search_calls: number; max_total_bytes: number }
}
export interface CollectionRequest {
  kb_id: string
  prompt: string
  mode: 'auto' | 'review'
  max_items: number
  client_request_id: string
}

async function request<T>(path: string, options: { body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal?.aborted) abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 20000)
  const token = getAuthToken()
  try {
    const response = await fetch(`${apiClient.getBaseURL()}/collection${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tessmora-Language': getLanguage(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal, cache: 'no-store',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = data?.detail
      throw new Error(typeof detail === 'string' ? detail : detail?.message || t('暂时无法连接素材助手，请稍后重试。'))
    }
    return data as T
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error(t('连接超时，任务可能已开始。请刷新任务后重试。'))
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

export const collectionApi = {
  capabilities: (signal?: AbortSignal) => request<CollectionCapabilities>('/capabilities', { signal }),
  list: (kbId: string, signal?: AbortSignal) => request<{ runs: CollectionRun[] }>(`/runs?kb_id=${encodeURIComponent(kbId)}`, { signal }),
  get: (id: string, signal?: AbortSignal) => request<CollectionRun>(`/runs/${encodeURIComponent(id)}`, { signal }),
  create: (body: CollectionRequest, signal?: AbortSignal) => request<CollectionRun>('/runs', { body, signal }),
  collect: (id: string, candidateIds: string[], signal?: AbortSignal) => request<CollectionRun>(`/runs/${encodeURIComponent(id)}/collect`, { body: { candidate_ids: candidateIds }, signal }),
  cancel: (id: string, signal?: AbortSignal) => request<CollectionRun>(`/runs/${encodeURIComponent(id)}/cancel`, { body: {}, signal }),
  retry: (id: string, signal?: AbortSignal) => request<CollectionRun>(`/runs/${encodeURIComponent(id)}/retry`, { body: {}, signal }),
}

export function collectionIsRunning(status: CollectionStatus) {
  return status === 'planning' || status === 'searching' || status === 'collecting'
}

export function collectionRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Self-hosted HTTP origins may expose getRandomValues but not randomUUID.
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('')
}

/** URLs from providers are untrusted content, including in links and thumbnails. */
export function collectionWebUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}
