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
            
            // 提取生成阶段的状态信息
            if (phase === 'generation' && payload.status) {
              merged.generation_status = payload.status
              merged.generation_message = payload.message || ''
            }
            
            // 后端在每个阶段完成时推送事件（带结果），收到后：当前阶段标为已完成，下一阶段标为进行中
            // 注意：只有在收到 generation 阶段的事件时，才将 currentStage 设置为 'generation'
            const nextPhase =
              phase === 'intent' ? 'routing' 
              : phase === 'routing' ? 'retrieval' 
              : phase === 'retrieval' ? 'retrieval' // 检索阶段完成后，仍然保持在 retrieval，直到收到 generation 事件
              : phase === 'generation' ? 'generation' 
              : 'retrieval'
            
            // 根据阶段设置状态
            let generationStage: 'idle' | 'processing' | 'completed' | 'failed' = 'idle'
            if (phase === 'generation') {
              if (payload.status === 'preparing' || payload.status === 'building_context' || payload.status === 'preparing_prompt' || payload.status === 'generating') {
                generationStage = 'processing'
              } else {
                generationStage = 'completed'
              }
            }
            // 只有在明确收到 generation 阶段事件时，才设置 generation 为 processing
            // 检索阶段完成时，不自动激活生成阶段
            
            setThinking({
              currentStage: nextPhase,
              thoughtData: merged,
              stages: {
                intent: phase === 'intent' ? 'completed' : ['routing', 'retrieval', 'generation'].includes(phase) ? 'completed' : 'idle',
                routing: phase === 'routing' ? 'completed' : phase === 'retrieval' || phase === 'generation' ? 'completed' : phase === 'intent' ? 'processing' : 'idle',
                retrieval: phase === 'retrieval' ? 'completed' : phase === 'generation' ? 'completed' : phase === 'routing' ? 'processing' : 'idle',
                generation: generationStage !== 'idle' ? generationStage : (phase === 'generation' ? 'processing' : 'idle'),
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
            // 清除生成阶段的状态信息，避免显示旧的动效
            const cleanedThoughtData = { ...thoughtData }
            if (cleanedThoughtData) {
              delete (cleanedThoughtData as any).generation_status
              delete (cleanedThoughtData as any).generation_message
            }
            
            // 先设置完成状态，确保前端能正确显示
            setThinking({
              currentStage: 'generation',
              thoughtData: cleanedThoughtData,
              stages: {
                intent: 'completed',
                routing: 'completed',
                retrieval: 'completed',
                generation: 'completed',
              },
              progress: 100,
            })
            
            // 保存思考数据到消息中，同时保存完成状态信息
            const sid = streamingSessionIdRef.current
            const s = sid ? getSessionById(sid) : null
            const last = s?.messages[s?.messages.length - 1]
            if (s && last && last.role === 'assistant' && last.id === currentMessageIdRef.current && cleanedThoughtData) {
              // 保存思考数据，并添加完成状态标记
              const thinkingWithStatus = {
                ...cleanedThoughtData,
                _generation_completed: true, // 标记生成已完成
              }
              updateMessage(s.id, last.id, { thinking: thinkingWithStatus })
            }
            
            currentUserQueryRef.current = null // 清除保存的查询
            
            // 延迟清理，确保状态更新完成后再清理
            setTimeout(() => {
              cleanup()
            }, 100)
            
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
