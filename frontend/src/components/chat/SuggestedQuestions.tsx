import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, RefreshCw, Sparkles } from 'lucide-react'
import { knowledgeApi } from '@/services/api_client'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import type { ChatSession, ChatScopeFile } from '@/store/useChatStore'
import { cn } from '@/lib/utils'
import {
  createSuggestedQuestionsCache, getSuggestionScope, localSuggestedQuestions,
  MAX_QUESTIONS, suggestionCacheKey, type SuggestionScope, type SuggestedQuestionItem,
} from '@/lib/suggestedQuestions'

interface SuggestedQuestionsProps {
  session: ChatSession | null
  selectedScopeFiles?: ChatScopeFile[]
  disabled?: boolean
  onSelect: (question: string) => void
}

const suggestions = createSuggestedQuestionsCache((scope, signal) =>
  knowledgeApi.postSuggestedQuestions({
    ...scope, max_questions: MAX_QUESTIONS, use_llm: false,
    // A new sample comes from the existing pool; refresh=true explicitly rebuilds it.
    refresh: false, prefer_precomputed: true,
  }, { signal }))

interface LoadState {
  key: string
  questions: SuggestedQuestionItem[]
  loading: boolean
  failed: boolean
}

export function SuggestedQuestions({
  session, selectedScopeFiles, disabled = false, onSelect,
}: SuggestedQuestionsProps) {
  const knowledgeBases = useKnowledgeStore((state) => state.knowledgeBases)
  const fetchKnowledgeBases = useKnowledgeStore((state) => state.fetchKnowledgeBases)
  const scopeValue = JSON.stringify(getSuggestionScope(session, selectedScopeFiles))
  const scope = useMemo(() => JSON.parse(scopeValue) as SuggestionScope, [scopeValue])
  const cacheKey = suggestionCacheKey(scope, knowledgeBases)
  const [refresh, setRefresh] = useState({ key: '', revision: 0 })
  const consumedRefresh = useRef(0)
  const [state, setState] = useState<LoadState>(() => ({
    key: cacheKey, questions: suggestions.peek(cacheKey) ?? [],
    loading: !suggestions.peek(cacheKey), failed: false,
  }))

  useEffect(() => {
    void fetchKnowledgeBases({ silent: true })
  }, [fetchKnowledgeBases])

  useEffect(() => {
    let cancelled = false
    const cached = suggestions.peek(cacheKey)
    const fresh = refresh.key === cacheKey && refresh.revision > consumedRefresh.current
    if (fresh) consumedRefresh.current = refresh.revision
    if (cached && !fresh) {
      setState({ key: cacheKey, questions: cached, loading: false, failed: false })
      return
    }
    setState((current) => ({
      key: cacheKey, questions: current.key === cacheKey ? current.questions : cached ?? [],
      loading: true, failed: false,
    }))
    void suggestions.load(cacheKey, scope, fresh).then((questions) => {
      if (!cancelled) setState({ key: cacheKey, questions, loading: false, failed: false })
    }).catch(() => {
      if (!cancelled) setState((current) => ({ ...current, loading: false, failed: true }))
    })
    return () => { cancelled = true }
  }, [cacheKey, scope, refresh])

  // Never display or allow sending cards from a previous scope while its request finishes.
  const current = state.key === cacheKey ? state : {
    key: cacheKey, questions: suggestions.peek(cacheKey) ?? [],
    loading: !suggestions.peek(cacheKey), failed: false,
  }
  const questions = current.failed && !current.questions.length
    ? localSuggestedQuestions(scope, knowledgeBases) : current.questions
  const loading = current.loading

  return (
    <div className="mx-auto mt-5 w-full max-w-lg px-1 md:max-w-3xl md:px-0" aria-busy={loading}>
      <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-300" aria-hidden />
          <span>你可以这样问</span>
        </div>
        <button type="button" disabled={disabled || loading}
          onClick={() => setRefresh((value) => ({ key: cacheKey, revision: value.revision + 1 }))}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-300">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden />
          {loading ? '正在加载' : current.failed && !questions.length ? '重试' : '换一批'}
        </button>
      </div>
      {!questions.length && (
        <p className="py-3 text-xs leading-5 text-slate-500 dark:text-slate-400" role="status" aria-live="polite">
          {loading ? '正在整理推荐问题…' : current.failed
            ? '暂时无法加载推荐问题，你可以直接提问。' : '当前范围暂无推荐问题，可直接输入问题。'}
        </p>
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
    </div>
  )
}

export default SuggestedQuestions
