import { useEffect, useMemo, useState } from 'react'
import { knowledgeApi } from '@/services/api_client'
import { useKnowledgeStore, type KnowledgeBase } from '@/store/useKnowledgeStore'
import type { ChatSession, ChatScopeFile } from '@/store/useChatStore'
import { cn } from '@/lib/utils'

const MAX_QUESTIONS = 3
/** 本地兜底：未指定范围时随机抽若干库 */
const RANDOM_KB_SAMPLE_SIZE = 10

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
    const title = truncateSeed(stripFileExtension(file.name), 20) || truncateSeed(file.name, 20)
    const templates = [
      `《${title}》主要讲了什么？`,
      `《${title}》里有哪些优先关注的点？`,
      `怎样快速读懂《${title}》？`,
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
  const normalized = String(text ?? '')
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
          setQuestions(normalized)
          return
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
    <div className="mx-auto mt-4 w-full max-w-lg px-1 md:max-w-2xl md:px-0">
      {loading ? (
        <div className="flex items-center justify-center py-1" role="status" aria-label="正在生成推荐问题">
          <div className="relative h-12 w-12">
            <span
              className="absolute inset-0 animate-[spin_3.8s_linear_infinite] rounded-[42%_58%_63%_37%/44%_39%_61%_56%] border-2 border-violet-300/80 border-t-indigo-400 border-r-fuchsia-300/80 dark:border-violet-400/70 dark:border-t-indigo-300 dark:border-r-fuchsia-300/70"
              aria-hidden
            />
            <span
              className="absolute inset-[2px] animate-[spin_2.6s_linear_infinite_reverse] rounded-[61%_39%_46%_54%/58%_44%_56%_42%] border border-dashed border-indigo-300/70 dark:border-indigo-300/50"
              aria-hidden
            />
            <span
              className="absolute left-[8px] top-[6px] h-1.5 w-1.5 rounded-full bg-pink-300 shadow-sm shadow-pink-300/70 dark:bg-pink-300/90"
              aria-hidden
            />
            <span
              className="absolute right-[8px] bottom-[7px] h-1.5 w-1.5 rounded-full bg-sky-300 shadow-sm shadow-sky-300/70 dark:bg-sky-300/90"
              aria-hidden
            />
            <span className="absolute left-1/2 top-1/2 inline-flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-violet-100 to-indigo-100 text-[17px] font-semibold leading-none text-indigo-600 shadow-[0_4px_14px_rgba(99,102,241,0.25)] dark:from-violet-900/60 dark:to-indigo-900/60 dark:text-indigo-200 dark:shadow-[0_4px_16px_rgba(99,102,241,0.35)]">
              ?
            </span>
          </div>
        </div>
      ) : (
        <>
          {status === 'degraded' && (
            <div className="mb-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-700 shadow-sm dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-300" role="status">
              已切换推荐策略
            </div>
          )}
          {status === 'failed' && (
            <div className="mb-3 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-[11px] text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300" role="alert">
              暂时无法生成推荐问题
            </div>
          )}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="推荐问题">
            {questions.map((item, idx) => (
              <li key={`mobile-${item.id}`}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`发送推荐问题：${item.text}`}
                  onClick={() => onSelect(item.text)}
                  className={cn(
                    'group relative w-full overflow-hidden rounded-2xl border bg-white/90 px-3.5 py-3 text-left shadow-sm ring-1 ring-white/70 transition-[border-color,box-shadow,background-color] duration-200',
                    'border-slate-200/80 hover:border-slate-300/90 hover:bg-white hover:shadow-md',
                    'dark:border-slate-700/70 dark:bg-slate-900/60 dark:ring-white/[0.04] dark:hover:border-indigo-500/40 dark:hover:bg-slate-900/80',
                    disabled && 'cursor-not-allowed opacity-55 hover:shadow-sm'
                  )}
                >
                  <span
                    className={cn(
                      'absolute inset-y-3 left-0 w-1 rounded-r-full',
                      idx === 0 && 'bg-indigo-400/70 dark:bg-indigo-300/70',
                      idx === 1 && 'bg-emerald-400/70 dark:bg-emerald-300/70',
                      idx === 2 && 'bg-amber-400/80 dark:bg-amber-300/70'
                    )}
                    aria-hidden
                  />
                  <span className="block line-clamp-2 text-[13px] font-medium leading-snug text-slate-800 dark:text-slate-100">
                    {item.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <ul className="hidden gap-3 md:grid md:grid-cols-3" aria-label="推荐问题">
            {questions.map((item, idx) => {
              return (
                <li key={`desktop-${item.id}`} className="min-w-0">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`发送推荐问题：${item.text}`}
                    onClick={() => onSelect(item.text)}
                    className={cn(
                      'group relative flex min-h-[88px] w-full overflow-hidden rounded-2xl border bg-white/90 p-4 text-left shadow-[0_16px_30px_-26px_rgba(15,23,42,0.7)] ring-1 ring-white/70 backdrop-blur-sm transition-[border-color,box-shadow,background-color] duration-200',
                      'border-slate-200/80 hover:border-slate-300/95 hover:bg-white hover:shadow-[0_18px_34px_-24px_rgba(15,23,42,0.72)]',
                      'dark:border-slate-700/70 dark:bg-slate-900/60 dark:ring-white/[0.04] dark:hover:border-indigo-400/30 dark:hover:bg-slate-900/80',
                      disabled && 'cursor-not-allowed opacity-60 hover:shadow-[0_16px_30px_-26px_rgba(15,23,42,0.7)]'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/80 to-transparent dark:via-white/14',
                        idx === 0 && 'via-indigo-300/80 dark:via-indigo-300/40',
                        idx === 1 && 'via-emerald-300/80 dark:via-emerald-300/40',
                        idx === 2 && 'via-amber-300/90 dark:via-amber-300/40'
                      )}
                      aria-hidden
                    />
                    <span
                      className={cn(
                        'absolute left-0 top-4 h-10 w-1 rounded-r-full',
                        idx === 0 && 'bg-indigo-400/70 dark:bg-indigo-300/60',
                        idx === 1 && 'bg-emerald-400/70 dark:bg-emerald-300/60',
                        idx === 2 && 'bg-amber-400/80 dark:bg-amber-300/70'
                      )}
                      aria-hidden
                    />
                    <span className="relative z-10 block line-clamp-3 text-[13px] font-medium leading-relaxed text-slate-800/95 dark:text-slate-100">
                      {item.text}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export default SuggestedQuestions
