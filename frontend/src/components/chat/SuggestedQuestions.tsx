import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { knowledgeApi } from '@/services/api_client'
import { useKnowledgeStore, type KnowledgeBase } from '@/store/useKnowledgeStore'
import type { ChatSession, ChatScopeFile } from '@/store/useChatStore'
import { cn } from '@/lib/utils'

const MAX_QUESTIONS = 3
/** 本地兜底：未指定范围时随机抽若干库 */
const RANDOM_KB_SAMPLE_SIZE = 10
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const LONG_OPAQUE_TOKEN_PATTERN = /\b[0-9a-f]{16,}\b/gi
const FILE_REFERENCE_PATTERN = /(?<![A-Za-z0-9_.-])([a-z0-9][a-z0-9._-]{2,180}\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg|pdf|docx?|pptx?|xlsx?|csv|txt|md|mp3|wav|m4a|aac|flac|mp4|mov|avi|mkv|webm))(?![A-Za-z0-9_.-])/gi
const TEMP_FILE_PREFIX_PATTERN = /^(?:codex[-_ ]*clipboard|clipboard|pasted?[-_ ]*(?:image|file)|screen[-_ ]*shot|screenshot|image|img|upload(?:ed)?|wechatimg|wx_camera|mmexport|dsc|pxl)[-_ .]*/i
const GENERIC_FILE_WORD_PATTERN = /\b(?:at|copy|file|image|photo|picture|scan|new|final)\b/gi
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])

interface SuggestedQuestionsProps {
  session: ChatSession | null
  selectedScopeFiles?: ChatScopeFile[]
  disabled?: boolean
  onSelect: (question: string) => void
}

interface PortraitCluster {
  cluster_id?: string
  topic_summary?: string
  cluster_size?: number
  keywords?: string[]
}

interface SuggestedQuestionItem {
  id: string
  text: string
  kbName: string
}

type SuggestionStatus = 'degraded' | 'failed' | null

interface KnowledgeFileItem {
  id: string
  name: string
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function pickRandom<T>(arr: T[], n: number): T[] {
  if (n <= 0 || arr.length === 0) return []
  const copy = [...arr]
  shuffleInPlace(copy)
  return copy.slice(0, Math.min(n, copy.length))
}

function sortKnowledgeBases(knowledgeBases: KnowledgeBase[]) {
  return [...knowledgeBases].sort((a, b) => {
    const docsDelta = (b.stats?.documents ?? 0) - (a.stats?.documents ?? 0)
    if (docsDelta !== 0) return docsDelta
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  })
}

function parsePortraitClusters(raw: unknown): PortraitCluster[] {
  if (!raw || typeof raw !== 'object') return []
  const data = raw as { clusters?: unknown[]; topics?: unknown[] }

  if (Array.isArray(data.clusters)) {
    return data.clusters
      .filter((item): item is PortraitCluster => typeof item === 'object' && item != null)
      .map((item) => ({
        cluster_id: item.cluster_id,
        topic_summary: item.topic_summary,
        cluster_size: item.cluster_size ?? 0,
        keywords: Array.isArray(item.keywords)
          ? item.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
          : undefined,
      }))
      .filter((item) => Boolean(item.topic_summary?.trim()) || (item.keywords?.length ?? 0) > 0)
  }

  if (Array.isArray(data.topics)) {
    return data.topics
      .filter((item): item is { id?: string; summary?: string; size?: number } => typeof item === 'object' && item != null)
      .map((item) => ({
        cluster_id: item.id,
        topic_summary: item.summary,
        cluster_size: item.size ?? 0,
      }))
      .filter((item) => Boolean(item.topic_summary?.trim()))
  }

  return []
}

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

function buildTopicSeed(cluster: PortraitCluster) {
  const keywords = (cluster.keywords ?? []).map((item) => item.trim()).filter(Boolean)
  if (keywords.length >= 2) {
    return `${truncateSeed(keywords[0], 10)}、${truncateSeed(keywords[1], 10)}`
  }
  if (keywords.length === 1) {
    return truncateSeed(keywords[0], 14)
  }

  const summary = String(cluster.topic_summary ?? '').trim()
  if (!summary) return ''
  const sentence = summary.split(/[。！？\n]/).map((item) => item.trim()).find(Boolean) ?? ''
  if (!sentence) return ''
  const segment = sentence.split(/[，、；：,;]/).map((item) => item.trim()).find(Boolean) ?? sentence
  return truncateSeed(segment.replace(/\s+/g, ''), 16)
}

function buildQuestionsFromClusters(kb: KnowledgeBase, clusters: PortraitCluster[]): SuggestedQuestionItem[] {
  const templates = [
    (seed: string) => `关于「${seed}」，知识库里有哪些要点？`,
    (seed: string) => `「${seed}」相关流程或方法是什么？`,
    (seed: string) => `如何快速理解「${seed}」的重点？`,
  ]

  return [...clusters]
    .sort((a, b) => (b.cluster_size ?? 0) - (a.cluster_size ?? 0))
    .slice(0, 6)
    .map((cluster, index) => {
      const seed = buildTopicSeed(cluster)
      if (!seed) return null
      return {
        id: `${kb.id}-cluster-${cluster.cluster_id ?? index}`,
        text: templates[index % templates.length](seed),
        kbName: kb.name,
      }
    })
    .filter((item): item is SuggestedQuestionItem => Boolean(item?.text))
}

function buildQuestionsFromFiles(kb: KnowledgeBase, files: KnowledgeFileItem[]): SuggestedQuestionItem[] {
  return files.map((file, index) => {
    const title = getReadableFileTitle(file.name)
    const subject = getGenericMaterialLabel(file.name)
    const templates = title
      ? [
        `《${title}》主要讲了什么？`,
        `《${title}》里有哪些优先关注的点？`,
        `怎样快速读懂《${title}》？`,
      ]
      : [
        `${subject}展示了哪些关键信息？`,
        `${subject}有哪些值得关注的细节？`,
        `可以如何理解${subject}的主要内容？`,
      ]
    return {
      id: `${kb.id}-file-${file.id}`,
      text: templates[index % templates.length],
      kbName: kb.name,
    }
  })
}

function takeRoundRobin(
  sources: Array<{ kb: KnowledgeBase; clusters: PortraitCluster[]; files: KnowledgeFileItem[] }>,
  max: number
): SuggestedQuestionItem[] {
  const perKbClusters = sources.map((s) => buildQuestionsFromClusters(s.kb, s.clusters))
  const perKbFiles = sources.map((s) => buildQuestionsFromFiles(s.kb, s.files))
  const seen = new Set<string>()
  const out: SuggestedQuestionItem[] = []

  let round = 0
  while (out.length < max) {
    let added = false
    for (let i = 0; i < sources.length && out.length < max; i += 1) {
      const fromCluster = perKbClusters[i][round]
      if (fromCluster?.text && !seen.has(fromCluster.text)) {
        seen.add(fromCluster.text)
        out.push(fromCluster)
        added = true
        if (out.length >= max) break
      }
    }
    for (let i = 0; i < sources.length && out.length < max; i += 1) {
      const fromFile = perKbFiles[i][round]
      if (fromFile?.text && !seen.has(fromFile.text)) {
        seen.add(fromFile.text)
        out.push(fromFile)
        added = true
        if (out.length >= max) break
      }
    }
    if (!added) break
    round += 1
  }

  return out.slice(0, max)
}

function takeRandomFromPool(
  sources: Array<{ kb: KnowledgeBase; clusters: PortraitCluster[]; files: KnowledgeFileItem[] }>,
  max: number
): SuggestedQuestionItem[] {
  const pool: SuggestedQuestionItem[] = []
  const seen = new Set<string>()
  for (const s of sources) {
    for (const item of [...buildQuestionsFromClusters(s.kb, s.clusters), ...buildQuestionsFromFiles(s.kb, s.files)]) {
      if (!item.text || seen.has(item.text)) continue
      seen.add(item.text)
      pool.push(item)
    }
  }
  shuffleInPlace(pool)
  return pool.slice(0, max)
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

function normalizeSuggestedItems(
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

function normalizeFilesList(raw: unknown, allowedIds: Set<string> | null): KnowledgeFileItem[] {
  if (!Array.isArray(raw)) return []
  const list = raw
    .map((file) => ({
      id: String(file?.id ?? '').trim(),
      name: String(file?.name ?? '').trim(),
    }))
    .filter((file) => file.id && file.name && !file.id.includes('/keyframes/'))
  if (allowedIds && allowedIds.size > 0) {
    return list.filter((f) => allowedIds.has(f.id))
  }
  return list
}

type Scope =
  | { mode: 'files'; kbFileFilter: Map<string, Set<string>> }
  | { mode: 'manual_kb'; kbIds: string[] }
  | { mode: 'global_random' }

/** 服务端不可用时的本地模板生成（与旧逻辑一致） */
async function loadLocalSuggestedQuestions(
  scope: Scope,
  candidateKnowledgeBases: KnowledgeBase[],
  selectedScopeFiles: ChatScopeFile[]
): Promise<SuggestedQuestionItem[]> {
  if (!candidateKnowledgeBases.length) return []

  const sources = await Promise.all(
    candidateKnowledgeBases.map(async (kb) => {
      let allowedFileIds: Set<string> | null = null
      if (scope.mode === 'files') {
        allowedFileIds = scope.kbFileFilter.get(kb.id) ?? new Set()
      }

      const [portraitResult, filesResult] = await Promise.allSettled([
        knowledgeApi.getKnowledgeBasePortrait(kb.id),
        knowledgeApi.getKnowledgeBaseFiles(kb.id),
      ])

      const clusters = portraitResult.status === 'fulfilled' ? parsePortraitClusters(portraitResult.value) : []

      const rawFiles = filesResult.status === 'fulfilled' ? filesResult.value?.files : undefined
      let files = normalizeFilesList(rawFiles, allowedFileIds && allowedFileIds.size > 0 ? allowedFileIds : null)

      if (scope.mode === 'files' && allowedFileIds && allowedFileIds.size > 0 && files.length === 0) {
        files = Array.from(allowedFileIds).map((id) => ({
          id,
          name: selectedScopeFiles.find((f) => f.kbId === kb.id && f.fileId === id)?.name ?? id,
        }))
      }

      return { kb, clusters, files }
    })
  )

  const filteredSources = sources.filter((s) => {
    if (scope.mode === 'files') return s.files.length > 0 || s.clusters.length > 0
    return true
  })

  if (scope.mode === 'global_random') {
    return takeRandomFromPool(filteredSources, MAX_QUESTIONS)
  }

  let next = takeRoundRobin(filteredSources, MAX_QUESTIONS)
  if (next.length < MAX_QUESTIONS && scope.mode !== 'files') {
    const extra = takeRandomFromPool(filteredSources, MAX_QUESTIONS - next.length).filter(
      (q) => !next.some((x) => x.text === q.text)
    )
    next = [...next, ...extra].slice(0, MAX_QUESTIONS)
  }
  return next
}

export function SuggestedQuestions({
  session,
  selectedScopeFiles = [],
  disabled = false,
  onSelect,
}: SuggestedQuestionsProps) {
  const { knowledgeBases, fetchKnowledgeBases } = useKnowledgeStore()
  const [loading, setLoading] = useState(false)
  const [questions, setQuestions] = useState<SuggestedQuestionItem[]>([])
  const [status, setStatus] = useState<SuggestionStatus>(null)

  useEffect(() => {
    void fetchKnowledgeBases({ silent: true })
  }, [fetchKnowledgeBases])

  const scope = useMemo((): Scope => {
    const files = selectedScopeFiles ?? []
    const hasFileScope = files.length > 0
    const kbMode = session?.kbMode ?? 'auto'
    const manualIds = session?.knowledgeBaseIds ?? []

    if (hasFileScope) {
      const byKb = new Map<string, Set<string>>()
      for (const f of files) {
        if (!f.kbId || !f.fileId) continue
        if (!byKb.has(f.kbId)) byKb.set(f.kbId, new Set())
        byKb.get(f.kbId)!.add(f.fileId)
      }
      return { mode: 'files', kbFileFilter: byKb }
    }

    if (kbMode === 'manual' && manualIds.length > 0) {
      return { mode: 'manual_kb', kbIds: [...new Set(manualIds.map(String))] }
    }

    return { mode: 'global_random' }
  }, [selectedScopeFiles, session?.kbMode, session?.knowledgeBaseIds])

  const candidateKnowledgeBases = useMemo(() => {
    if (!knowledgeBases.length) return []

    if (scope.mode === 'files') {
      const list: KnowledgeBase[] = []
      for (const kbId of scope.kbFileFilter.keys()) {
        const kb = knowledgeBases.find((k) => k.id === kbId)
        if (kb) list.push(kb)
      }
      return list
    }

    if (scope.mode === 'manual_kb') {
      const set = new Set(scope.kbIds)
      return sortKnowledgeBases(knowledgeBases.filter((kb) => set.has(kb.id)))
    }

    return pickRandom(knowledgeBases, RANDOM_KB_SAMPLE_SIZE)
  }, [knowledgeBases, scope])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!knowledgeBases.length) {
        setQuestions([])
        setLoading(false)
        return
      }

      setLoading(true)
      setStatus(null)
      try {
        const res = await knowledgeApi.postSuggestedQuestions({
          kb_mode: session?.kbMode ?? 'auto',
          knowledge_base_ids: session?.knowledgeBaseIds ?? [],
          selected_files: selectedScopeFiles.map((f) => ({
            kb_id: f.kbId,
            file_id: f.fileId,
            ...(f.name ? { name: f.name } : {}),
          })),
          max_questions: MAX_QUESTIONS,
          use_llm: true,
          refresh: false,
          prefer_precomputed: true,
        })

        if (cancelled) return

        const list = res?.questions ?? []
        if (list.length > 0) {
          const normalized = normalizeSuggestedItems(list, res.revision)
          if (normalized.length > 0) {
            setQuestions(normalized)
            return
          }
        }
      } catch (e) {
        console.warn('推荐问题接口失败，使用本地模板', e)
      }

      if (cancelled) return

      const local = await loadLocalSuggestedQuestions(scope, candidateKnowledgeBases, selectedScopeFiles)
      if (!cancelled) {
        if (local.length > 0) {
          const deduped = normalizeSuggestedItems(
            local.map((q) => ({ text: q.text, kb_name: q.kbName })),
            'local'
          )
          setQuestions(deduped)
          setStatus('degraded')
        } else {
          setQuestions([])
          setStatus('failed')
        }
      }
    }

    void load().finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [knowledgeBases.length, session?.kbMode, session?.knowledgeBaseIds, selectedScopeFiles, scope, candidateKnowledgeBases])

  if (!loading && questions.length === 0 && !status) return null

  return (
    <div className="mx-auto mt-5 w-full max-w-lg px-1 md:max-w-3xl md:px-0">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-500 dark:text-slate-400" role="status" aria-label="正在生成推荐问题">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border border-slate-300 border-t-indigo-500 dark:border-slate-700 dark:border-t-indigo-300" aria-hidden />
          正在整理推荐问题
        </div>
      ) : (
        <>
          {questions.length > 0 && (
            <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-300" aria-hidden />
                <span>你可以这样问</span>
              </div>
              <span className="truncate text-[10px] tracking-wide text-slate-400 dark:text-slate-500">
                基于当前知识范围
              </span>
            </div>
          )}
          {status === 'degraded' && (
            <div className="mb-3 rounded-[6px] border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-300" role="status">
              已切换推荐策略
            </div>
          )}
          {status === 'failed' && (
            <div className="mb-3 rounded-[6px] border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300" role="alert">
              暂时无法生成推荐问题
            </div>
          )}
          <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-3" aria-label="推荐问题">
            {questions.map((item) => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  disabled={disabled}
                  title={item.text}
                  aria-label={`发送推荐问题：${item.text}`}
                  onClick={() => onSelect(item.text)}
                  className={cn(
                    'group flex min-h-[88px] w-full flex-col justify-between gap-3 overflow-hidden rounded-[12px] border border-slate-200/90 bg-white/55 px-3.5 py-3 text-left shadow-sm shadow-slate-200/20 transition-[border-color,background-color,box-shadow] duration-150 md:min-h-[112px] md:px-4 md:py-3.5',
                    'hover:border-indigo-200 hover:bg-white hover:shadow-md hover:shadow-indigo-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 focus-visible:ring-offset-2',
                    'dark:border-slate-800 dark:bg-slate-900/35 dark:shadow-none dark:hover:border-indigo-500/40 dark:hover:bg-slate-900/65',
                    disabled && 'cursor-not-allowed opacity-55'
                  )}
                >
                  <span className="flex w-full min-w-0 items-center justify-between gap-2">
                    <span className="max-w-[85%] truncate rounded-full bg-slate-100/90 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {item.kbName}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-indigo-500 dark:text-slate-600 dark:group-hover:text-indigo-300" aria-hidden />
                  </span>
                  <span className="block line-clamp-2 break-words text-[13px] font-medium leading-relaxed text-slate-800 [overflow-wrap:anywhere] md:line-clamp-3 md:text-[13.5px] dark:text-slate-100">
                    {item.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default SuggestedQuestions
