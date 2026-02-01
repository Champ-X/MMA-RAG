import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/store/useChatStore'
import {
  createChatStream,
  type ThoughtEvent,
  type CitationEvent,
  type MessageEvent,
} from '@/services/sse_stream'
import type { ThoughtPhase } from '@/types/sse'

interface UseThinkingChainOptions {
  onThought?: (e: ThoughtEvent) => void
  onCitation?: (e: CitationEvent) => void
  onMessage?: (e: MessageEvent) => void
  onComplete?: () => void
  onError?: (err: unknown) => void
}

export function useThinkingChain(options: UseThinkingChainOptions = {}) {
  const {
    addMessage,
    updateMessage,
    setThinking,
    clearThinking,
    getActiveSession,
  } = useChatStore()

  const [isStreaming, setIsStreaming] = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')
  const streamRef = useRef<{ close: () => void; isClosed: boolean } | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)
  const contentBufferRef = useRef('')
  const [error, setError] = useState<string | null>(null)

  const cleanup = () => {
    streamRef.current?.close()
    streamRef.current = null
    setIsStreaming(false)
    clearThinking()
    setCurrentResponse('')
    contentBufferRef.current = ''
    setError(null)
  }

  const sendMessage = async (
    content: string,
    knowledgeBaseIds?: string[],
    sessionId?: string
  ) => {
    const session = getActiveSession()
    if (!session) throw new Error('没有活跃的会话')

    addMessage(session.id, { role: 'user', content })
    addMessage(session.id, {
      role: 'assistant',
      content: '',
      citations: [],
    })

    const after = getActiveSession()
    const last = after?.messages[after.messages.length - 1]
    currentMessageIdRef.current = last?.id ?? null

    contentBufferRef.current = ''
    setIsStreaming(true)
    setError(null)
    setCurrentResponse('')

    try {
      streamRef.current = createChatStream(
        content,
        {
          onThought: (e) => {
            const ev = e as { type?: string; data?: Record<string, unknown> & { data?: Record<string, unknown> } }
            const phase = ev.type as ThoughtPhase
            const inner = ev.data?.data ?? ev.data
            const payload = (typeof inner === 'object' && inner !== null ? inner : {}) as Record<string, unknown>
            const prev = useChatStore.getState().thinking.thoughtData
            const merged = { ...prev, ...payload } as Record<string, unknown>
            setThinking({
              currentStage: phase,
              thoughtData: merged,
              stages: {
                intent: phase === 'intent' ? 'processing' : phase === 'routing' || phase === 'retrieval' ? 'completed' : 'idle',
                routing: phase === 'routing' ? 'processing' : phase === 'retrieval' ? 'completed' : 'idle',
                retrieval: phase === 'retrieval' ? 'processing' : 'idle',
                generation: phase === 'generation' ? 'processing' : 'idle',
              },
            })
            options.onThought?.(e as ThoughtEvent)
          },
          onCitation: (ev) => {
            const s = getActiveSession()
            const last = s?.messages[s?.messages.length - 1]
            if (s && last && last.id === currentMessageIdRef.current && ev.references?.length) {
              const prev = last.citations ?? []
              const next = [...prev, ...ev.references]
              updateMessage(s.id, last.id, { citations: next })
            }
            options.onCitation?.(ev)
          },
          onMessage: (ev) => {
            if (typeof ev.delta !== 'string') return
            contentBufferRef.current += ev.delta
            setCurrentResponse(contentBufferRef.current)
            const s = getActiveSession()
            const last = s?.messages[s?.messages.length - 1]
            if (s && last && last.id === currentMessageIdRef.current) {
              updateMessage(s.id, last.id, { content: contentBufferRef.current })
            }
            options.onMessage?.(ev)
          },
          onComplete: () => {
            const thoughtData = useChatStore.getState().thinking.thoughtData
            setThinking({
              currentStage: 'generation',
              stages: {
                intent: 'completed',
                routing: 'completed',
                retrieval: 'completed',
                generation: 'completed',
              },
              progress: 100,
            })
            const s = getActiveSession()
            const last = s?.messages[s.messages.length - 1]
            if (s && last && last.role === 'assistant' && last.id === currentMessageIdRef.current && thoughtData) {
              updateMessage(s.id, last.id, { thinking: thoughtData })
            }
            cleanup()
            options.onComplete?.()
          },
          onError: (err) => {
            const msg = err instanceof Error ? err.message : '发生未知错误'
            setError(msg)
            const s = getActiveSession()
            const last = s?.messages[s?.messages.length - 1]
            if (s && last && last.id === currentMessageIdRef.current) {
              updateMessage(s.id, last.id, { error: msg })
            }
            cleanup()
            options.onError?.(err)
          },
        },
        { knowledgeBaseIds, sessionId: sessionId ?? session.id }
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
      cleanup()
      throw err
    }
  }

  const stopStreaming = () => cleanup()

  useEffect(() => {
    return () => cleanup()
  }, [])

  const thinking = useChatStore((state) => state.thinking)
  const progress = {
    currentStage: thinking.currentStage,
    progress: thinking.progress,
    isThinking:
      thinking.stages.intent !== 'idle' ||
      thinking.stages.routing !== 'idle' ||
      thinking.stages.retrieval !== 'idle' ||
      thinking.stages.generation !== 'idle',
  }

  return {
    sendMessage,
    stopStreaming,
    isStreaming,
    currentResponse,
    error,
    progress,
    hasActiveStream: streamRef.current != null && !streamRef.current.isClosed,
  }
}
