import { useCallback, useEffect, useRef, useState } from 'react'
import { flushChatPersistence, useChatStore } from '@/store/useChatStore'
import { useConfigStore } from '@/store/useConfigStore'
import {
  createChatStream,
  type ThoughtEvent,
  type CitationEvent,
  type MessageEvent,
} from '@/services/sse_stream'
import type { ThoughtPhase } from '@/types/sse'
import { advanceThinking } from '@/lib/thinkingState'
import { freezeStageTimings, mergeStageTimings } from '@/lib/stageTiming'
import { putAttachmentBlob } from '@/lib/chatAttachmentBlobStore'
import { mergeCitationReferences } from '@/lib/citations'
import { normalizeAgentMode, type ChatMessageAttachment, type ChatScopeFile, type ThoughtData } from '@/store/useChatStore'
import { persistMentions, type ChatMention } from '@/lib/chatReferences'
import { chatFileKind } from '@/lib/chatAttachmentFile'
import { mixedModeContext } from '@/lib/mixedModeContext'
import { readDecisionDiagnostics } from '@/lib/decisionDiagnostics'
import { createStreamTextBuffer, subscribeStreamTextLifecycle, type StreamTextBuffer } from '@/lib/streamTextBuffer'

interface UseThinkingChainOptions {
  onThought?: (e: ThoughtEvent) => void
  onCitation?: (e: CitationEvent) => void
  onMessage?: (e: MessageEvent) => void
  onComplete?: () => void
  onError?: (err: unknown) => void
}

function getChatErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message
    : err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
      ? err.message : '发生未知错误'
  if (raw.includes("Illegal header value") || raw.includes("Bearer '")) {
    return '模型服务密钥未配置或无效，请检查后端环境变量后重试。'
  }
  return raw
}

export function useThinkingChain(options: UseThinkingChainOptions = {}) {
  const addMessage = useChatStore((state) => state.addMessage)
  const updateMessage = useChatStore((state) => state.updateMessage)
  const setThinking = useChatStore((state) => state.setThinking)
  const clearThinking = useChatStore((state) => state.clearThinking)
  const setStreamingSessionId = useChatStore((state) => state.setStreamingSessionId)
  const getActiveSession = useChatStore((state) => state.getActiveSession)
  const getSessionById = useChatStore((state) => state.getSessionById)
  const config = useConfigStore((state) => state.config)

  const [isStreaming, setIsStreaming] = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')
  const streamRef = useRef<{ close: () => void; isClosed: boolean } | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)
  const streamingSessionIdRef = useRef<string | null>(null)
  const textBufferRef = useRef<StreamTextBuffer | null>(null)
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamEpochRef = useRef(0)
  const currentUserQueryRef = useRef<string | null>(null) // 保存当前用户查询
  const [error, setError] = useState<string | null>(null)

  const cleanup = useCallback(({ preserveError = false }: { preserveError?: boolean } = {}) => {
    // Persist the final received text before clearing the message/session identity.
    textBufferRef.current?.close()
    textBufferRef.current = null
    if (completionTimerRef.current !== null) {
      clearTimeout(completionTimerRef.current)
      completionTimerRef.current = null
    }
    streamEpochRef.current += 1
    streamRef.current?.close()
    streamRef.current = null
    setIsStreaming(false)
    setStreamingSessionId(null)
    streamingSessionIdRef.current = null
    currentMessageIdRef.current = null
    currentUserQueryRef.current = null
    clearThinking()
    setCurrentResponse('')
    if (!preserveError) {
      setError(null)
    }
  }, [clearThinking, setStreamingSessionId])

  const sendMessage = async (
    content: string,
    knowledgeBaseIds?: string[],
    sessionId?: string,
    files?: File[],
    selectedFiles?: ChatScopeFile[],
    mentions?: ChatMention[],
    attachmentIds?: string[],
  ) => {
    const session = sessionId ? getSessionById(sessionId) : getActiveSession()
    if (!session) throw new Error('没有活跃的会话')

    // A previous completion delay or cancelled request must not affect this turn.
    cleanup()
    const streamEpoch = streamEpochRef.current
    const isCurrentStream = () => streamEpochRef.current === streamEpoch
    let terminalReceived = false

    const displayContent =
      (content.trim() ? content : '') ||
      (files?.length ? `（已上传 ${files.length} 个附件）` : '')

    const baseId = Date.now()
    let attachments: ChatMessageAttachment[] | undefined
    if (files?.length) {
      attachments = await Promise.all(
        files.map(async (f, i) => {
          const id = attachmentIds?.[i] ?? `att_${baseId}_${i}_${Math.random().toString(36).slice(2, 9)}`
          await putAttachmentBlob(id, f)
          const kind = chatFileKind(f) ?? 'image'
          const base: ChatMessageAttachment = { id, kind, name: f.name, size: f.size }
          if (kind === 'image') {
            const { imageFileToPersistedThumb } = await import('@/lib/chatAttachmentThumb')
            const thumbDataUrl = await imageFileToPersistedThumb(f)
            return {
              ...base,
              previewUrl: URL.createObjectURL(f),
              ...(thumbDataUrl ? { thumbDataUrl } : {}),
            }
          }
          return base
        })
      )
    }
    if (!isCurrentStream()) return

    addMessage(session.id, {
      role: 'user',
      content: displayContent,
      attachments,
      mentions: mentions?.length ? persistMentions(mentions) : undefined,
      scopeFiles: selectedFiles?.length ? selectedFiles : undefined,
      scopeVersion: 2,
    })
    const savedMessages = getSessionById(session.id)?.messages
    const userMessageId = savedMessages?.[savedMessages.length - 1]?.id
    addMessage(session.id, {
      role: 'assistant',
      content: '',
      citations: [],
    })

    const after = getSessionById(session.id)
    const last = after?.messages[after.messages.length - 1]
    currentMessageIdRef.current = last?.id ?? null
    streamingSessionIdRef.current = session.id
    currentUserQueryRef.current = content.trim() ? content : displayContent

    const messageId = currentMessageIdRef.current
    const textBuffer = createStreamTextBuffer((text) => {
      if (!isCurrentStream()) return
      setCurrentResponse(text)
      if (messageId) updateMessage(session.id, messageId, { content: text })
    })
    textBufferRef.current = textBuffer
    setIsStreaming(true)
    setError(null)
    setCurrentResponse('')
    setStreamingSessionId(session.id)

    const requestedAgentMode = normalizeAgentMode(session.agentMode)
    const isExplicitAgent = requestedAgentMode === 'agent'

    // 显式 Agent 模式使用独立的研究轨迹，不借用直接检索的「意图解析」占位。
    setThinking({
      currentStage: isExplicitAgent ? 'agent' : 'intent',
      thoughtData: isExplicitAgent ? { agent_mode: true } : {},
      stages: {
        intent: isExplicitAgent ? 'idle' : 'processing',
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
            if (!isCurrentStream() || terminalReceived) return
            const ev = e as { type?: string; data?: Record<string, unknown> & { data?: Record<string, unknown> } }
            const phase = ev.type as ThoughtPhase
            const inner = ev.data?.data ?? ev.data
            const payload = (typeof inner === 'object' && inner !== null ? inner : {}) as Record<string, unknown>
            if (phase === 'attachment' && userMessageId && Array.isArray(payload.items)) {
              const items = payload.items as Array<{ index: number; status: 'ready' | 'failed'; summary: string }>
              updateMessage(session.id, userMessageId, { attachments: attachments?.map((item, index) => {
                const parsed = items.find(result => result.index === index + 1)
                return parsed ? { ...item, status: parsed.status, summary: parsed.summary } : item
              }) })
            }
            setThinking(advanceThinking(useChatStore.getState().thinking, phase, payload))
            options.onThought?.(e as ThoughtEvent)
          },
          onCitation: (ev) => {
            if (!isCurrentStream() || terminalReceived) return
            const sid = streamingSessionIdRef.current
            const s = sid ? getSessionById(sid) : null
            const last = s?.messages[s?.messages.length - 1]
            if (s && last && last.id === currentMessageIdRef.current && Array.isArray(ev.references)) {
              const prev = last.citations ?? []
              const next = mergeCitationReferences(prev, ev)
              updateMessage(s.id, last.id, { citations: next })
            }
            options.onCitation?.(ev)
          },
          onMessage: (ev) => {
            if (!isCurrentStream() || terminalReceived || typeof ev.delta !== 'string') return
            textBuffer.append(ev.delta)
            options.onMessage?.(ev)
          },
          onComplete: (event) => {
            if (!isCurrentStream() || terminalReceived) return
            terminalReceived = true
            textBuffer.close()
            streamRef.current?.close()
            streamRef.current = null
            const thoughtData = useChatStore.getState().thinking.thoughtData
            // 清除生成阶段的状态信息，避免显示旧的动效
            const cleanedThoughtData = { ...thoughtData,
              stage_timings: mergeStageTimings(thoughtData?.stage_timings, event.stage_timings),
            }
            if (cleanedThoughtData) {
              delete cleanedThoughtData.generation_status
              delete cleanedThoughtData.generation_message
            }
            
            // 先设置完成状态，确保前端能正确显示
            setThinking({
              currentStage: 'generation',
              thoughtData: cleanedThoughtData,
              stages: {
                intent: cleanedThoughtData.stage_timings && !cleanedThoughtData.stage_timings.intent ? 'idle' : 'completed',
                routing: cleanedThoughtData.stage_timings && !cleanedThoughtData.stage_timings.routing ? 'idle' : 'completed',
                retrieval: cleanedThoughtData.stage_timings && !cleanedThoughtData.stage_timings.retrieval ? 'idle' : 'completed',
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
              updateMessage(s.id, last.id, { thinking: thinkingWithStatus, diagnostics: readDecisionDiagnostics(event) })
            }
            
            currentUserQueryRef.current = null // 清除保存的查询
            
            // 延迟清理，确保状态更新完成后再清理
            completionTimerRef.current = setTimeout(() => {
              completionTimerRef.current = null
              if (isCurrentStream()) cleanup()
            }, 100)
            
            options.onComplete?.()
          },
          onError: (err) => {
            if (!isCurrentStream() || terminalReceived) return
            terminalReceived = true
            textBuffer.close()
            const msg = getChatErrorMessage(err)
            setError(msg)
            const stage = err && typeof err === 'object' && 'stage' in err ? err.stage : undefined
            const thinking = useChatStore.getState().thinking
            const failedThinking: ThoughtData = stage === 'validation' || stage === 'attachment' ? { failure_stage: stage } : {
              ...(thinking.thoughtData ?? {}),
              stage_timings: freezeStageTimings(mergeStageTimings(
                thinking.thoughtData?.stage_timings,
                err && typeof err === 'object' && 'stage_timings' in err ? err.stage_timings : undefined,
              ), 'failed'),
              _generation_failed: true,
              generation_error: msg,
            }
            const sid = streamingSessionIdRef.current
            const s = sid ? getSessionById(sid) : null
            const last = s?.messages[s?.messages.length - 1]
            if (s && last && last.id === currentMessageIdRef.current) {
              updateMessage(s.id, last.id, {
                error: msg,
                thinking: failedThinking,
                diagnostics: readDecisionDiagnostics(err),
              })
            }
            currentUserQueryRef.current = null // 清除保存的查询
            cleanup({ preserveError: true })
            options.onError?.(err)
          },
        },
        { 
          knowledgeBaseIds, 
          sessionId: sessionId ?? session.id,
          model: config.models.find(m => m.id === 'chat')?.model,
          files: files?.length ? files : undefined,
          selectedFiles: selectedFiles?.length ? selectedFiles : undefined,
          mentions: mentions?.length ? persistMentions(mentions) : undefined,
          attachmentIds: attachments?.map(item => item.id),
          agentMode: requestedAgentMode,
          conversationContext: mixedModeContext(session.messages),
        }
      )
    } catch (err) {
      if (!isCurrentStream()) return
      setError(err instanceof Error ? err.message : '发送失败')
      cleanup({ preserveError: true })
      throw err
    }
  }

  const stopStreaming = () => {
    const userQuery = currentUserQueryRef.current // 获取用户原始查询
    if (completionTimerRef.current !== null) {
      // The completed answer remains visible for 100 ms; stop must not relabel it.
      cleanup()
      return userQuery
    }
    textBufferRef.current?.close()
    const sid = streamingSessionIdRef.current
    const messageId = currentMessageIdRef.current
    if (sid && messageId) {
      const thoughtData = useChatStore.getState().thinking.thoughtData
      updateMessage(sid, messageId, { thinking: {
        ...thoughtData,
        stage_timings: freezeStageTimings(thoughtData?.stage_timings, 'cancelled'),
        _generation_cancelled: true,
      } })
    }
    cleanup()
    return userQuery // 返回用户原始查询，用于填充输入框
  }

  useEffect(() => {
    const unsubscribe = subscribeStreamTextLifecycle(
      () => textBufferRef.current?.flush(),
      flushChatPersistence,
    )
    return () => { unsubscribe(); cleanup() }
  }, [cleanup])

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
