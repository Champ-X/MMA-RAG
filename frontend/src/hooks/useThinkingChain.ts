import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/store/useChatStore'
import { useConfigStore } from '@/store/useConfigStore'
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
    setStreamingSessionId,
    getActiveSession,
    getSessionById,
  } = useChatStore()
  const { config } = useConfigStore()

  const [isStreaming, setIsStreaming] = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')
  const streamRef = useRef<{ close: () => void; isClosed: boolean } | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)
  const streamingSessionIdRef = useRef<string | null>(null)
  const contentBufferRef = useRef('')
  const currentUserQueryRef = useRef<string | null>(null) // 保存当前用户查询
  const [error, setError] = useState<string | null>(null)

  const cleanup = () => {
    streamRef.current?.close()
    streamRef.current = null
    setIsStreaming(false)
    setStreamingSessionId(null)
    streamingSessionIdRef.current = null
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
    streamingSessionIdRef.current = session.id
    currentUserQueryRef.current = content // 保存用户原始查询

    contentBufferRef.current = ''
    setIsStreaming(true)
    setError(null)
    setCurrentResponse('')
    setStreamingSessionId(session.id)

    // 流一开始就展示「意图识别」进行中，避免长时间只显示「等待思考阶段」
    setThinking({
      currentStage: 'intent',
      thoughtData: {},
      stages: {
        intent: 'processing',
        routing: 'idle',
        retrieval: 'idle',
        generation: 'idle',
      },
    })

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
            // 后端在每个阶段完成时推送事件（带结果），收到后：当前阶段标为已完成，下一阶段标为进行中
            const nextPhase =
              phase === 'intent' ? 'routing' : phase === 'routing' ? 'retrieval' : phase === 'retrieval' ? 'generation' : 'generation'
            setThinking({
              currentStage: nextPhase,
              thoughtData: merged,
              stages: {
                intent: phase === 'intent' ? 'completed' : ['routing', 'retrieval', 'generation'].includes(phase) ? 'completed' : 'idle',
                routing: phase === 'routing' ? 'completed' : phase === 'retrieval' || phase === 'generation' ? 'completed' : phase === 'intent' ? 'processing' : 'idle',
                retrieval: phase === 'retrieval' ? 'completed' : phase === 'generation' ? 'completed' : phase === 'routing' ? 'processing' : 'idle',
                generation: phase === 'generation' ? 'completed' : phase === 'retrieval' ? 'processing' : 'idle',
              },
            })
            options.onThought?.(e as ThoughtEvent)
          },
          onCitation: (ev) => {
            const sid = streamingSessionIdRef.current
            const s = sid ? getSessionById(sid) : null
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
            const sid = streamingSessionIdRef.current
            const s = sid ? getSessionById(sid) : null
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
            const sid = streamingSessionIdRef.current
            const s = sid ? getSessionById(sid) : null
            const last = s?.messages[s?.messages.length - 1]
            if (s && last && last.role === 'assistant' && last.id === currentMessageIdRef.current && thoughtData) {
              updateMessage(s.id, last.id, { thinking: thoughtData })
            }
            currentUserQueryRef.current = null // 清除保存的查询
            cleanup()
            options.onComplete?.()
          },
          onError: (err) => {
            const msg = err instanceof Error ? err.message : '发生未知错误'
            setError(msg)
            const sid = streamingSessionIdRef.current
            const s = sid ? getSessionById(sid) : null
            const last = s?.messages[s?.messages.length - 1]
            if (s && last && last.id === currentMessageIdRef.current) {
              updateMessage(s.id, last.id, { error: msg })
            }
            currentUserQueryRef.current = null // 清除保存的查询
            cleanup()
            options.onError?.(err)
          },
        },
        { 
          knowledgeBaseIds, 
          sessionId: sessionId ?? session.id,
          model: config.models.find(m => m.id === 'chat')?.model
        }
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
      cleanup()
      throw err
    }
  }

  const stopStreaming = () => {
    const userQuery = currentUserQueryRef.current // 获取用户原始查询
    cleanup()
    return userQuery // 返回用户原始查询，用于填充输入框
  }

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
