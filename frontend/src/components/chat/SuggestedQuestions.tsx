import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Library, RefreshCw, Sparkles } from 'lucide-react'
import { knowledgeApi } from '@/services/api_client'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import type { ChatSession, ChatScopeFile } from '@/store/useChatStore'
import { cn } from '@/lib/utils'
import {
  createSuggestedQuestionsCache, getSuggestionScope, localSuggestedQuestions,
  MAX_QUESTIONS, suggestionCacheKey, type SuggestionScope, type SuggestedQuestionItem,
} from '@/lib/suggestedQuestions'
import './suggestedQuestions.css'

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
    <div className="suggested-questions mx-auto mt-5 w-full max-w-lg px-1 md:max-w-3xl md:px-0" aria-busy={loading}>
      <div className="suggestions-heading">
        <h2 className="suggestions-title">
          <span className="suggestions-title-icon"><Sparkles size={14} aria-hidden /></span>
          你可以这样问
        </h2>
        <button type="button" disabled={disabled || loading}
          onClick={() => setRefresh((value) => ({ key: cacheKey, revision: value.revision + 1 }))}
          className="suggestions-refresh">
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
          <ul className="suggestions-grid" aria-label="推荐问题">
            {questions.map((item, index) => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  disabled={disabled}
                  title={item.text}
                  aria-label={`发送推荐问题：${item.text}`}
                  onClick={() => onSelect(item.text)}
                  className="suggestion-card"
                  data-note={['honey', 'sage', 'lavender'][index % 3]}
                >
                  <span className="suggestion-question">{item.text}</span>
                  <span className="suggestion-footer">
                    <span className="suggestion-source" title={item.kbName}>
                      <Library size={12} aria-hidden />
                      <span>{item.kbName}</span>
                    </span>
                    <span className="suggestion-action" aria-hidden><ArrowUpRight size={16} /></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
    </div>
  )
}

export default SuggestedQuestions
