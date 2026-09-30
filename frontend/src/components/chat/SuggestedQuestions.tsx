import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Library, RefreshCw, Sparkles } from 'lucide-react'
import { knowledgeApi } from '@/services/api_client'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import type { ChatSession, ChatScopeFile } from '@/store/useChatStore'
import { cn } from '@/lib/utils'
import {
  createSuggestedQuestionsCache, getSuggestionScope,
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
    ...scope, max_questions: MAX_QUESTIONS, use_llm: true,
    // Ready pools return immediately; a cold pool is prepared in the background.
    refresh: false, prefer_precomputed: true,
  }, { signal }))

interface LoadState {
  key: string
  questions: SuggestedQuestionItem[]
  loading: boolean
  failed: boolean
  pending: boolean
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
    loading: !suggestions.peek(cacheKey), failed: false, pending: false,
  }))

  useEffect(() => {
    void fetchKnowledgeBases({ silent: true })
  }, [fetchKnowledgeBases])

  useEffect(() => {
    const controller = new AbortController()
    const cached = suggestions.peek(cacheKey)
    const fresh = refresh.key === cacheKey && refresh.revision > consumedRefresh.current
    if (fresh) consumedRefresh.current = refresh.revision
    if (cached && !fresh) {
      setState({ key: cacheKey, questions: cached, loading: false, failed: false, pending: false })
      return
    }
    setState((current) => ({
      key: cacheKey, questions: current.key === cacheKey ? current.questions : cached ?? [],
      loading: true, failed: false, pending: false,
    }))
    void suggestions.loadUntilReady(cacheKey, scope, { fresh, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setState((current) => ({
        key: cacheKey,
        questions: result.pending && current.key === cacheKey ? current.questions : result.questions,
        loading: false, failed: false, pending: result.pending,
      }))
    }).catch(() => {
      if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, failed: true }))
    })
    return () => { controller.abort() }
  }, [cacheKey, scope, refresh])

  // Never display or allow sending cards from a previous scope while its request finishes.
  const current = state.key === cacheKey ? state : {
    key: cacheKey, questions: suggestions.peek(cacheKey) ?? [],
    loading: !suggestions.peek(cacheKey), failed: false, pending: false,
  }
  const questions = current.questions
  const loading = current.loading

  return (
    <div className="suggested-questions mx-auto mt-5 w-full max-w-3xl px-1 sm:px-0" aria-busy={loading}>
      <div className="suggestions-heading">
        <h2 className="suggestions-title">
          <span className="suggestions-title-icon"><Sparkles size={17} aria-hidden /></span>
          你可以这样问
        </h2>
        <button type="button" disabled={disabled || loading}
          onClick={() => setRefresh((value) => ({ key: cacheKey, revision: value.revision + 1 }))}
          className="suggestions-refresh">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden />
          {loading ? '正在准备' : current.failed || current.pending ? '再试一次' : '换一批'}
        </button>
      </div>
      {!questions.length && (
        <p className="py-3 text-sm leading-6 text-slate-500 dark:text-slate-400" role="status" aria-live="polite">
          {loading ? '正在看看你的资料，找几个值得聊的问题…' : current.failed
            ? '推荐问题暂时没加载出来，你也可以先聊聊想了解什么。' : current.pending
              ? '还在准备问题，稍后可以再试一次。也可以直接开始聊。'
              : '还没有找到合适的推荐问题，先聊聊你想了解什么吧。'}
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
                      <Library size={14} aria-hidden />
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
