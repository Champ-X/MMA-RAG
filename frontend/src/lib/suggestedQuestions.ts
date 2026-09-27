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
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])

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

function getGenericMaterialLabel(name: string) {
  const extension = String(name ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTENSIONS.has(extension)) return '这张图片'
  if (AUDIO_EXTENSIONS.has(extension)) return '这段音频'
  if (VIDEO_EXTENSIONS.has(extension)) return '这段视频'
  return '这份材料'
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

/** Emergency fallback uses metadata already in memory; never fans out file/portrait requests. */
export function localSuggestedQuestions(scope: SuggestionScope, knowledgeBases: KnowledgeBase[]) {
  if (scope.selected_files.length) {
    return normalizeSuggestedItems(scope.selected_files.map((file) => ({
      text: getReadableFileTitle(file.name)
        ? `《${getReadableFileTitle(file.name)}》主要讲了什么？`
        : `${getGenericMaterialLabel(file.name)}展示了哪些关键信息？`,
      kb_name: knowledgeBases.find((kb) => kb.id === file.kb_id)?.name ?? '所选材料',
    })), 'local-files')
  }
  return normalizeSuggestedItems(scopedKnowledgeBases(scope, knowledgeBases)
    .filter((kb) => !kb.stats || [kb.stats.documents, kb.stats.chunks, kb.stats.images,
      kb.stats.audio, kb.stats.video, kb.stats.video_shots].some((count) => Number(count) > 0))
    .map((kb) => ({ text: `「${kb.name}」知识库里有哪些主要内容？`, kb_name: kb.name })), 'local-kbs')
}

export interface SuggestedQuestionsResponse {
  questions: Array<{ text: string; kb_name: string }>
  revision?: string
}

/** Shared across new conversations and React StrictMode remounts, bounded in time and size. */
export function createSuggestedQuestionsCache(
  fetchQuestions: (scope: SuggestionScope, signal: AbortSignal) => Promise<SuggestedQuestionsResponse>,
  { ttlMs = 60_000, timeoutMs = 8_000, now = Date.now } = {}
) {
  const cache = new Map<string, { expires: number; questions: SuggestedQuestionItem[] }>()
  const inFlight = new Map<string, Promise<SuggestedQuestionItem[]>>()

  function peek(key: string) {
    const hit = cache.get(key)
    return hit && hit.expires > now() ? hit.questions : undefined
  }

  function load(key: string, scope: SuggestionScope, fresh = false): Promise<SuggestedQuestionItem[]> {
    const pending = inFlight.get(key)
    if (pending) return pending
    const hit = !fresh ? peek(key) : undefined
    if (hit) return Promise.resolve(hit)
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
      const questions = normalizeSuggestedItems(result.questions ?? [], result.revision)
      cache.delete(key)
      cache.set(key, { expires: now() + ttlMs, questions })
      if (cache.size > 40) cache.delete(cache.keys().next().value!)
      return questions
    }).finally(() => {
      clearTimeout(timer)
      inFlight.delete(key)
    })
    inFlight.set(key, task)
    return task
  }

  return { peek, load }
}
