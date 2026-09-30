import type { ChatSession, ChatScopeFile } from '@/store/useChatStore'
import type { KnowledgeBase } from '@/store/useKnowledgeStore'

export interface SuggestedQuestionItem {
  id: string
  text: string
  kbName: string
}

export const MAX_QUESTIONS = 3
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const LONG_OPAQUE_TOKEN_PATTERN = /\b[0-9a-f]{16,}\b/gi
const FILE_REFERENCE_PATTERN = /(?<![A-Za-z0-9_.-])([a-z0-9][a-z0-9._-]{2,180}\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg|pdf|docx?|pptx?|xlsx?|csv|txt|md|mp3|wav|m4a|aac|flac|mp4|mov|avi|mkv|webm))(?![A-Za-z0-9_.-])/gi
const TEMP_FILE_PREFIX_PATTERN = /^(?:codex[-_ ]*clipboard|clipboard|pasted?[-_ ]*(?:image|file)|screen[-_ ]*shot|screenshot|image|img|upload(?:ed)?|wechatimg|wx_camera|mmexport|dsc|pxl)[-_ .]*/i
const GENERIC_FILE_WORD_PATTERN = /\b(?:at|copy|file|image|photo|picture|scan|new|final)\b/gi

function stripFileExtension(name: string) {
  return name.replace(/\.[^.]+$/, '').trim()
}

function getReadableFileTitle(name: string) {
  const fileName = String(name ?? '').split(/[/\\]/).pop()?.trim() ?? ''
  const stem = stripFileExtension(fileName)
  if (!stem) return ''

  const cleaned = stem
    .replace(TEMP_FILE_PREFIX_PATTERN, '')
    .replace(UUID_PATTERN, ' ')
    .replace(LONG_OPAQUE_TOKEN_PATTERN, ' ')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const semantic = cleaned
    .replace(GENERIC_FILE_WORD_PATTERN, ' ')
    .replace(/[\d\s:.-]+/g, ' ')
    .trim()

  if (!semantic || !/[A-Za-z\u4e00-\u9fff]/.test(semantic)) return ''
  if (TEMP_FILE_PREFIX_PATTERN.test(stem) && !cleaned.replace(/[0-9a-f\s:.-]+/gi, '')) return ''
  return truncateSeed(cleaned, 28)
}

function truncateSeed(text: string, max = 18) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

function normalizeQuestionText(text: string): string {
  let removedOpaqueReference = false
  let cleaned = String(text ?? '').replace(FILE_REFERENCE_PATTERN, (fileName) => {
    if (getReadableFileTitle(fileName)) return fileName
    removedOpaqueReference = true
    return ''
  })

  if (removedOpaqueReference) {
    cleaned = cleaned
      .replace(/[「《“"]\s*[」》”"]/g, '')
      .replace(/(?:在|从|根据|关于)?\s*(?:该|这个|这份|这张)?\s*(?:文件|文档|图片|图像|附件)\s*(?:中|里|内|所示(?:的)?|显示(?:的)?)?\s*[，,:：]?\s*/g, '')
      .replace(/^\s*(?:中|里|内)(?:的)?\s*/, '')
  }

  const normalized = cleaned
    .replace(/^[\-\*\d\.\)\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  return normalized.length > 96 ? `${normalized.slice(0, 95)}…` : normalized
}

function normalizeQuestionKey(text: string): string {
  return normalizeQuestionText(text).toLowerCase().replace(/[?？!！。,.，;；:：]+$/, '').trim()
}

export function normalizeSuggestedItems(
  list: Array<{ text?: string; kb_name?: string }>,
  revision?: string
): SuggestedQuestionItem[] {
  const out: SuggestedQuestionItem[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const text = normalizeQuestionText(item?.text ?? '')
    const key = normalizeQuestionKey(text)
    if (!text || !key || seen.has(key)) continue
    seen.add(key)
    out.push({
      id: `api-${revision ?? 'x'}-${out.length}`,
      text,
      kbName: item?.kb_name || '知识库',
    })
    if (out.length >= MAX_QUESTIONS) break
  }
  return out
}

export interface SuggestionScope {
  kb_mode: string
  knowledge_base_ids: string[]
  selected_files: Array<{ kb_id: string; file_id: string; name: string }>
}

/** Values, not array identity/order or session ID, determine the retrieval scope. */
export function getSuggestionScope(
  session: Pick<ChatSession, 'kbMode' | 'knowledgeBaseIds'> | null,
  files: ChatScopeFile[] = []
): SuggestionScope {
  const selected = new Map<string, SuggestionScope['selected_files'][number]>()
  for (const file of files) {
    if (!file.kbId || !file.fileId) continue
    selected.set(JSON.stringify([file.kbId, file.fileId]), {
      kb_id: file.kbId, file_id: file.fileId, name: file.name || '',
    })
  }
  const selectedFiles = [...selected.values()].sort((a, b) =>
    a.kb_id.localeCompare(b.kb_id) || a.file_id.localeCompare(b.file_id))
  const mode = session?.kbMode ?? 'auto'
  return {
    kb_mode: selectedFiles.length ? 'manual' : mode,
    knowledge_base_ids: selectedFiles.length
      ? [...new Set(selectedFiles.map((file) => file.kb_id))].sort()
      : mode === 'manual' ? [...new Set(session?.knowledgeBaseIds ?? [])].sort() : [],
    selected_files: selectedFiles,
  }
}

function scopedKnowledgeBases(scope: SuggestionScope, knowledgeBases: KnowledgeBase[]) {
  const ids = new Set(scope.knowledge_base_ids)
  return knowledgeBases.filter((kb) => scope.kb_mode !== 'manual' || ids.has(kb.id))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function suggestionCacheKey(scope: SuggestionScope, knowledgeBases: KnowledgeBase[]) {
  const version = scopedKnowledgeBases(scope, knowledgeBases).map((kb) => [
    kb.id, kb.name, kb.updated_at ?? '', kb.stats?.documents ?? 0, kb.stats?.chunks ?? 0,
    kb.stats?.images ?? 0, kb.stats?.audio ?? 0, kb.stats?.video ?? 0, kb.stats?.video_shots ?? 0,
  ])
  return JSON.stringify([scope, version])
}

export interface SuggestedQuestionsResponse {
  questions: Array<{ text: string; kb_name: string }>
  revision?: string
  source?: string
  retry_after_ms?: number
}

export interface SuggestedQuestionsResult {
  questions: SuggestedQuestionItem[]
  pending: boolean
  retryAfterMs?: number
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('推荐问题加载已取消', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

/** Shared across new conversations and React StrictMode remounts, bounded in time and size. */
export function createSuggestedQuestionsCache(
  fetchQuestions: (scope: SuggestionScope, signal: AbortSignal) => Promise<SuggestedQuestionsResponse>,
  { ttlMs = 60_000, timeoutMs = 8_000, now = Date.now } = {}
) {
  const cache = new Map<string, { expires: number; questions: SuggestedQuestionItem[] }>()
  const inFlight = new Map<string, Promise<SuggestedQuestionsResult>>()

  function peek(key: string) {
    const hit = cache.get(key)
    return hit && hit.expires > now() ? hit.questions : undefined
  }

  function load(key: string, scope: SuggestionScope, fresh = false): Promise<SuggestedQuestionsResult> {
    const pending = inFlight.get(key)
    if (pending) return pending
    const hit = !fresh ? peek(key) : undefined
    if (hit) return Promise.resolve({ questions: hit, pending: false })
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('推荐问题加载超时'))
      }, timeoutMs)
    })
    const task = Promise.race([
      Promise.resolve().then(() => fetchQuestions(scope, controller.signal)), deadline,
    ]).then((result) => {
      // Older servers returned title-only cards under scope_fallback. Treat those as
      // pending too, so a cold cache never puts rigid placeholder questions on screen.
      const pending = result.source === 'warming' || result.source === 'scope_fallback'
      if (pending) return {
        questions: [], pending: true,
        retryAfterMs: result.retry_after_ms,
      }
      const questions = normalizeSuggestedItems(result.questions ?? [], result.revision)
      cache.delete(key)
      cache.set(key, { expires: now() + ttlMs, questions })
      if (cache.size > 40) cache.delete(cache.keys().next().value!)
      return { questions, pending: false }
    }).finally(() => {
      clearTimeout(timer)
      inFlight.delete(key)
    })
    inFlight.set(key, task)
    return task
  }

  async function loadUntilReady(
    key: string,
    scope: SuggestionScope,
    { fresh = false, signal, firstRetryMs = 2_000, retryMs = 4_000,
      maxWaitMs = 60_000, maxAttempts = 16 }: {
      fresh?: boolean
      signal?: AbortSignal
      firstRetryMs?: number
      retryMs?: number
      maxWaitMs?: number
      maxAttempts?: number
    } = {}
  ): Promise<SuggestedQuestionsResult> {
    const started = now()
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw new DOMException('推荐问题加载已取消', 'AbortError')
      const result = await load(key, scope, fresh || attempt > 0)
      if (signal?.aborted) throw new DOMException('推荐问题加载已取消', 'AbortError')
      if (!result.pending) return result
      const remaining = maxWaitMs - (now() - started)
      if (attempt + 1 >= maxAttempts || remaining <= 0) return result
      const requestedDelay = attempt === 0 ? firstRetryMs : retryMs
      const delay = Math.min(remaining, Math.max(requestedDelay, result.retryAfterMs ?? 0))
      await waitForRetry(delay, signal)
      if (now() - started >= maxWaitMs) return result
    }
  }

  return { peek, load, loadUntilReady }
}
