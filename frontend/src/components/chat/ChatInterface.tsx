import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Send, Zap, Paperclip, Database, Square, AtSign, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble } from './MessageBubble'
import { CitationPopover } from './CitationPopover'
import { ConversationTabs } from './ConversationTabs'
import { SuggestedQuestions } from './SuggestedQuestions'
import { InspectorDrawer } from '@/components/debug/InspectorDrawer'
import { KnowledgeBaseConfigPanel } from './KnowledgeBaseConfigPanel'
import { ModelConfigPanel } from './ModelConfigPanel'
import { OpenRouterModelBrandIcon } from './OpenRouterModelBrandIcon'
import { FileScopePicker } from './FileScopePicker'
import { useChatStore } from '@/store/useChatStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useThinkingChain } from '@/hooks/useThinkingChain'
import { cn } from '@/lib/utils'
import { getModelVendor, VENDOR_LOGOS } from '@/lib/modelVendors'
import type { CitationReference } from '@/types/sse'
import type { ChatMessageAttachment, ChatScopeFile, Message } from '@/store/useChatStore'
import { ComposerAttachmentTile } from './ChatAttachmentPreview'
import { fileScopeKey, formatScopedFileSize, useFileScopeOptions } from './useFileScopeOptions'

const MAX_CHAT_ATTACHMENTS = 3
const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_CHAT_AUDIO_BYTES = 10 * 1024 * 1024

function maxBytesForChatFile(f: File): number {
  return f.type.startsWith('image/') ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_AUDIO_BYTES
}

/** 每条助手消息内的引用 id → 对象；禁止跨消息合并，否则多轮对话共用 [1][2] 时会互相覆盖 */
function buildCitationMapForMessage(
  citations: Message['citations'] | undefined
): Map<number | string, CitationReference> {
  const map = new Map<number | string, CitationReference>()
  if (!citations) return map
  for (const cite of citations) {
    if (typeof cite === 'object' && cite != null && 'id' in cite) {
      map.set(cite.id, cite as CitationReference)
    }
  }
  return map
}

const EMPTY_STATE_GREETING_PREFIX = '你好，我是 '
const EMPTY_STATE_GREETING_FULL = `${EMPTY_STATE_GREETING_PREFIX}Nexus`

interface FileMentionState {
  query: string
  start: number
  end: number
}

function getFileMentionState(value: string, caret: number | null | undefined): FileMentionState | null {
  const safeCaret = typeof caret === 'number' ? caret : value.length
  const beforeCaret = value.slice(0, safeCaret)
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/)
  if (!match) return null
  const triggerStart = safeCaret - match[2].length - 1
  if (triggerStart < 0) return null
  return {
    query: match[2],
    start: triggerStart,
    end: safeCaret,
  }
}

/** 新对话空状态标题：逐字打字；切换会话时重播；尊重减少动效偏好 */
function EmptyStateGreetingTitle({ sessionKey }: { sessionKey: string }) {
  const [visibleLen, setVisibleLen] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const onChange = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reducedMotion) {
      setVisibleLen(EMPTY_STATE_GREETING_FULL.length)
      return
    }

    const fullLen = EMPTY_STATE_GREETING_FULL.length
    const stepMs = 150
    const pauseBeforeReplayMs = 5200

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (intervalId != null) {
        clearInterval(intervalId)
        intervalId = null
      }
      if (timeoutId != null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const scheduleReplay = () => {
      if (cancelled) return
      timeoutId = window.setTimeout(() => {
        timeoutId = null
        if (cancelled) return
        startCycle()
      }, pauseBeforeReplayMs)
    }

    const startCycle = () => {
      if (cancelled) return
      setVisibleLen(0)
      let i = 0
      intervalId = window.setInterval(() => {
        if (cancelled) {
          clearTimers()
          return
        }
        i += 1
        setVisibleLen(i)
        if (i >= fullLen) {
          if (intervalId != null) clearInterval(intervalId)
          intervalId = null
          scheduleReplay()
        }
      }, stepMs)
    }

    startCycle()

    return () => {
      cancelled = true
      clearTimers()
    }
  }, [sessionKey, reducedMotion])

  const visible = EMPTY_STATE_GREETING_FULL.slice(0, visibleLen)
  const prefixLen = EMPTY_STATE_GREETING_PREFIX.length
  const prefixPart =
    visible.length <= prefixLen ? visible : EMPTY_STATE_GREETING_PREFIX
  const namePart =
    visible.length > prefixLen ? visible.slice(prefixLen) : ''
  const done = visibleLen >= EMPTY_STATE_GREETING_FULL.length

  return (
    <h3
      className="mb-3 text-balance text-4xl font-semibold tracking-tight [font-family:'Ma_Shan_Zheng','Caveat','STKaiti','KaiTi',cursive] sm:text-5xl sm:leading-snug"
      aria-label={EMPTY_STATE_GREETING_FULL}
    >
      <span className="bg-gradient-to-r from-slate-900 via-indigo-800 to-violet-700 bg-clip-text text-transparent dark:from-slate-100 dark:via-indigo-200 dark:to-violet-300">
        {prefixPart}
        {namePart ? (
          <span className="font-semibold">{namePart}</span>
        ) : null}
      </span>
      {!done && (
        <span
          className="ml-0.5 inline-block min-w-[0.35em] translate-y-px text-indigo-600/90 animate-pulse dark:text-indigo-300/90"
          aria-hidden
        >
          ▍
        </span>
      )}
    </h3>
  )
}

function EmptyStateHint() {
  return (
    <div className="mx-auto mt-2.5 max-w-lg px-4">
      <p className="text-balance text-center text-3xl leading-tight tracking-[0.03em] text-transparent [font-family:'Caveat','Segoe_Print','Bradley_Hand',cursive] bg-gradient-to-r from-slate-500 via-indigo-500 to-violet-500 bg-clip-text drop-shadow-[0_3px_12px_rgba(99,102,241,0.2)] dark:from-slate-300 dark:via-indigo-300 dark:to-violet-300 dark:drop-shadow-[0_4px_14px_rgba(129,140,248,0.26)] sm:text-4xl">
        Ask me something...
      </p>
    </div>
  )
}

export function ChatInterface() {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<
    Array<{ id: string; file: File; previewUrl?: string }>
  >([])
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const [citePopover, setCitePopover] = useState<{
    open: boolean
    rect: DOMRect | null
    item: CitationReference | null
  }>({ open: false, rect: null, item: null })
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectingItem, setInspectingItem] = useState<CitationReference | null>(null)
  const [kbConfigPanelOpen, setKbConfigPanelOpen] = useState(false)
  const [fileScopePickerOpen, setFileScopePickerOpen] = useState(false)
  const [modelConfigPanelOpen, setModelConfigPanelOpen] = useState(false)
  const [selectedScopeFiles, setSelectedScopeFiles] = useState<ChatScopeFile[]>([])
  const [mentionState, setMentionState] = useState<FileMentionState | null>(null)
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const citePopoverRef = useRef<HTMLDivElement>(null)
  const prevIsStreamingRef = useRef(false)
  const mentionStateRef = useRef<FileMentionState | null>(null)
  mentionStateRef.current = mentionState
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([])

  const {
    sessions,
    activeSessionId,
    streamingSessionId,
    getActiveSession,
    createSession,
    createSessionFromApi,
    switchSession,
    deleteSession,
    setLoading,
    thinking,
    addMessage,
    updateMessage,
  } = useChatStore()

  const { sendMessage, stopStreaming, isStreaming, error } = useThinkingChain()
  const { config } = useConfigStore()
  const {
    knowledgeBases: scopeKnowledgeBases,
    filesByKb: scopeFilesByKb,
    loadingKbIds: scopeLoadingKbIds,
    ensureAllKbFiles,
    hasLoadedFilesForKb,
  } = useFileScopeOptions(Boolean(mentionState))

  const activeSession = getActiveSession()
  const messages = activeSession?.messages ?? []
  const isLoading = isStreaming

  // 获取当前选中的模型名称，简化显示
  const chatFullModelId = useMemo(
    () => config.models.find(m => m.id === 'chat')?.model || '',
    [config.models]
  )

  const currentModel = useMemo(() => {
    const chatModel = chatFullModelId
    // 如果模型名称包含斜杠，只显示最后一部分；否则显示完整名称
    if (chatModel.includes('/')) {
      return chatModel.split('/').pop() || chatModel
    }
    return chatModel || '模型'
  }, [chatFullModelId])

  /** 非 OpenRouter：本地 vendor 图；OpenRouter 在按钮内单独用 Lobe 图标 */
  const currentModelLogo = useMemo(() => {
    if (!chatFullModelId || chatFullModelId.startsWith('openrouter:')) return null
    const vendor = getModelVendor(chatFullModelId)
    return VENDOR_LOGOS[vendor] || null
  }, [chatFullModelId])

  const openRouterModelRaw = useMemo(() => {
    if (!chatFullModelId.startsWith('openrouter:')) return ''
    return chatFullModelId.slice('openrouter:'.length).trim()
  }, [chatFullModelId])


  const scrollToBottom = useCallback(() => {
    const run = () => {
      const viewport = scrollAreaRef.current?.firstElementChild as HTMLElement | null
      if (viewport && viewport.scrollHeight > viewport.clientHeight) {
        viewport.scrollTop = viewport.scrollHeight
        return
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
    requestAnimationFrame(() => requestAnimationFrame(run))
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, thinking.currentStage, scrollToBottom])

  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current
    prevIsStreamingRef.current = isStreaming
    if (wasStreaming && !isStreaming) {
      const t = setTimeout(scrollToBottom, 120)
      return () => clearTimeout(t)
    }
  }, [isStreaming, scrollToBottom])

  useEffect(() => {
    if (!activeSessionId && sessions.length === 0) {
      createSessionFromApi().catch(() => createSession())
    }
  }, [activeSessionId, sessions.length, createSession, createSessionFromApi])

  // 自动调整输入框高度
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    // 重置高度以获取准确的 scrollHeight
    el.style.height = 'auto'
    // 强制重排以获取准确的 scrollHeight
    const scrollHeight = el.scrollHeight
    // 最大高度约 8 行（8 * 24px ≈ 192px），最小高度 56px
    const minHeight = 56
    const maxHeight = 192
    const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight))
    el.style.height = `${newHeight}px`
    // 当内容超过最大高度时，显示滚动条
    el.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [input])

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      })
    }
  }, [])

  useEffect(() => {
    setSelectedScopeFiles([])
    setMentionState(null)
  }, [activeSessionId])

  useEffect(() => {
    if (!mentionState) return
    void ensureAllKbFiles()
  }, [mentionState, ensureAllKbFiles])

  const selectedScopeKeySet = useMemo(
    () => new Set(selectedScopeFiles.map(file => fileScopeKey(file.kbId, file.fileId))),
    [selectedScopeFiles]
  )

  const mentionGroups = useMemo(() => {
    if (!mentionState) return []
    const keyword = mentionState.query.trim().toLowerCase()
    let renderedItems = 0
    const maxItems = keyword ? 24 : 18

    return scopeKnowledgeBases
      .map(kb => {
        const rawFiles = (scopeFilesByKb[kb.id] ?? []).filter(
          file => !selectedScopeKeySet.has(fileScopeKey(kb.id, file.id))
        )
        const filteredFiles = !keyword
          ? rawFiles
          : rawFiles.filter(file => `${file.name} ${file.type}`.toLowerCase().includes(keyword))
        const remaining = Math.max(maxItems - renderedItems, 0)
        const limitedFiles = remaining > 0 ? filteredFiles.slice(0, Math.min(remaining, keyword ? 8 : 6)) : []
        renderedItems += limitedFiles.length
        return {
          kbId: kb.id,
          kbName: kb.name,
          files: limitedFiles,
          totalMatches: filteredFiles.length,
          isLoading: scopeLoadingKbIds.includes(kb.id),
          hasLoaded: hasLoadedFilesForKb(kb.id),
        }
      })
      .filter(group => group.files.length > 0 || group.isLoading || !group.hasLoaded)
      .slice(0, keyword ? 8 : 5)
  }, [mentionState, scopeKnowledgeBases, scopeFilesByKb, scopeLoadingKbIds, selectedScopeKeySet, hasLoadedFilesForKb])

  const mentionOptions = useMemo(
    () =>
      mentionGroups.flatMap(group =>
        group.files.map(file => ({
          kbId: group.kbId,
          kbName: group.kbName,
          file,
        }))
      ),
    [mentionGroups]
  )

  const mentionOptionIndexByKey = useMemo(() => {
    const map = new Map<string, number>()
    mentionOptions.forEach((option, index) => {
      map.set(fileScopeKey(option.kbId, option.file.id), index)
    })
    return map
  }, [mentionOptions])

  useEffect(() => {
    setMentionHighlightIndex(0)
  }, [mentionState?.query])

  useEffect(() => {
    if (!mentionOptions.length) return
    if (mentionHighlightIndex < mentionOptions.length) return
    setMentionHighlightIndex(Math.max(mentionOptions.length - 1, 0))
  }, [mentionHighlightIndex, mentionOptions.length])

  useEffect(() => {
    const target = mentionOptionRefs.current[mentionHighlightIndex]
    target?.scrollIntoView({ block: 'nearest' })
  }, [mentionHighlightIndex])

  const syncMentionState = useCallback((nextValue: string, caret: number | null | undefined) => {
    const nextState = getFileMentionState(nextValue, caret)
    setMentionState(nextState)
  }, [])

  const insertMentionSelection = useCallback((selection: { kbId: string; kbName: string; file: { id: string; name: string; type: string } }) => {
    const currentMention = mentionStateRef.current
    setSelectedScopeFiles(prev => {
      const key = fileScopeKey(selection.kbId, selection.file.id)
      if (prev.some(item => fileScopeKey(item.kbId, item.fileId) === key)) return prev
      return [
        ...prev,
        {
          kbId: selection.kbId,
          kbName: selection.kbName,
          fileId: selection.file.id,
          name: selection.file.name,
          type: selection.file.type,
        },
      ]
    })

    if (!currentMention) return
    const before = input.slice(0, currentMention.start)
    const after = input.slice(currentMention.end)
    let nextInput = `${before}${after}`
    if (before && !/\s$/.test(before) && after && !/^\s/.test(after)) {
      nextInput = `${before} ${after}`
    }
    nextInput = nextInput.replace(/[ \t]{2,}/g, ' ')
    setInput(nextInput)
    setMentionState(null)
    requestAnimationFrame(() => {
      const caretPos = Math.min(before.length, nextInput.length)
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(caretPos, caretPos)
    })
  }, [input])

  const submitMessage = useCallback(async (nextInput?: string) => {
    const text = (nextInput ?? input).trim()
    if ((!text && attachments.length === 0) || isLoading || !activeSessionId) return
    const files = attachments.map((a) => a.file)
    attachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    })
    setInput('')
    setAttachments([])
    setMentionState(null)
    setLoading(true)

    try {
      const scopedKbIds = Array.from(new Set(selectedScopeFiles.map(file => file.kbId))).filter(Boolean)
      const kbMode = activeSession?.kbMode ?? 'auto'
      const kbIds = activeSession?.knowledgeBaseIds ?? []
      const toSend = scopedKbIds.length > 0
        ? scopedKbIds
        : kbMode === 'auto'
          ? undefined
          : kbIds.length > 0
            ? kbIds
            : undefined
      await sendMessage(
        text,
        toSend,
        activeSessionId,
        files.length ? files : undefined,
        selectedScopeFiles.length ? selectedScopeFiles : undefined
      )
      setSelectedScopeFiles([])
    } catch (e) {
      console.error('发送失败', e)
    } finally {
      setLoading(false)
    }
  }, [input, attachments, isLoading, activeSessionId, setLoading, selectedScopeFiles, activeSession, sendMessage])

  const handleSend = useCallback(() => {
    void submitMessage()
  }, [submitMessage])

  const handleStop = () => {
    if (!activeSessionId || !isStreaming) return
    
    // 获取用户原始查询
    const userQuery = stopStreaming()
    
    // 添加终止提示消息
    const lastMessage = activeSession?.messages[activeSession.messages.length - 1]
    if (lastMessage && lastMessage.role === 'assistant') {
      // 标记最后一条消息为已终止
      updateMessage(activeSessionId, lastMessage.id, { 
        error: 'stopped', // 使用 error 字段标记终止状态
      })
    }
    
    // 添加终止提示系统消息
    addMessage(activeSessionId, {
      role: 'assistant',
      content: '',
      error: 'stopped_hint', // 特殊标记，用于显示终止提示
    })
    
    // 将用户原始查询填充到输入框
    if (userQuery) {
      setInput(userQuery)
      // 聚焦输入框
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    const next: Array<{ id: string; file: File; previewUrl?: string }> = []
    for (const f of picked) {
      const isImage = f.type.startsWith('image/')
      const isAudio = f.type.startsWith('audio/')
      if (!isImage && !isAudio) {
        console.warn('仅支持图片与音频：', f.name)
        continue
      }
      const limit = maxBytesForChatFile(f)
      if (f.size > limit) {
        const mb = Math.round(limit / (1024 * 1024))
        console.warn(`文件过大（图片/音频均≤${mb}MB）：${f.name}`)
        continue
      }
      next.push({
        id: `a-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file: f,
        ...(isImage ? { previewUrl: URL.createObjectURL(f) } : {}),
      })
    }
    setAttachments((prev) => [...prev, ...next].slice(0, MAX_CHAT_ATTACHMENTS))
    if (e.target) e.target.value = ''
  }

  // 处理引用点击：必须从「当前被点击的那条消息」里取引用，避免多条回答共用 [1][2] 时取到上一条的引用
  const handleCitationClick = useCallback((refId: number | string, event: React.MouseEvent, messageId?: string) => {
    if (!activeSession) return

    let citation: CitationReference | null = null
    if (messageId) {
      const msg = activeSession.messages.find(m => m.id === messageId)
      if (msg?.citations) {
        const found = msg.citations.find(c => {
          if (typeof c === 'object' && 'id' in c) return String(c.id) === String(refId)
          return false
        })
        if (found && typeof found === 'object' && 'id' in found) citation = found as CitationReference
      }
    }
    // 若已经指定 messageId 但未找到引用，避免错误回退到上一条消息
    if (!citation && !messageId) {
      for (const msg of activeSession.messages) {
        if (msg.citations) {
          const found = msg.citations.find(c => {
            if (typeof c === 'object' && 'id' in c) return String(c.id) === String(refId)
            return false
          })
          if (found && typeof found === 'object' && 'id' in found) {
            citation = found as CitationReference
            break
          }
        }
      }
    }

    if (citation) {
      const rect = event?.currentTarget?.getBoundingClientRect?.()
      if (rect) setCitePopover({ open: true, rect, item: citation })
    }
  }, [activeSession])

  // 关闭引用悬浮卡片
  const closeCitePopover = useCallback(() => {
    setCitePopover({ open: false, rect: null, item: null })
  }, [])

  // 打开检查器
  const openInspectorFromPopover = useCallback(() => {
    if (citePopover.item) {
      setInspectingItem(citePopover.item)
      setInspectorOpen(true)
      closeCitePopover()
    }
  }, [citePopover.item, closeCitePopover])

  // 点击外部关闭悬浮卡片
  useEffect(() => {
    if (!citePopover.open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (citePopoverRef.current && !citePopoverRef.current.contains(e.target as Node)) {
        closeCitePopover()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCitePopover()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [citePopover.open, closeCitePopover])

  // 按消息维度构建引用映射（同一 id 在不同轮次指向不同材料，不可混在一个 Map 里）
  const citationMapsByMessageId = useMemo(() => {
    const byId = new Map<string, Map<number | string, CitationReference>>()
    for (const msg of messages) {
      byId.set(msg.id, buildCitationMapForMessage(msg.citations))
    }
    return byId
  }, [messages])

  const handleNewConversation = useCallback(() => {
    createSessionFromApi().catch(() => createSession())
  }, [createSessionFromApi, createSession])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/60 dark:bg-slate-950/40">
      {/* 对话标签栏 */}
      <ConversationTabs
        conversations={sessions}
        activeConversationId={activeSessionId}
        onSelect={switchSession}
        onCreate={handleNewConversation}
        onDelete={deleteSession}
      />

      {/* 消息区 */}
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <div className="px-2 pt-3 pb-1">
          <div className="mx-auto max-w-4xl flex flex-col gap-6">
            {messages.length === 0 && (
              <div className="relative mx-auto w-full max-w-2xl py-10 sm:py-12 text-center">
                <div className="pointer-events-none absolute left-1/2 top-4 h-44 w-44 -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl dark:bg-fuchsia-500/15" />
                <div className="pointer-events-none absolute left-1/2 top-20 h-36 w-72 -translate-x-1/2 rounded-full bg-sky-300/20 blur-3xl dark:bg-indigo-500/15" />
                <div className="relative z-10">
                  <div
                    className="mb-7 inline-flex h-36 w-36 items-center justify-center rounded-full overflow-hidden ring-4 ring-indigo-300/70 dark:ring-indigo-400/50 ring-offset-1 ring-offset-slate-50 dark:ring-offset-slate-950 shadow-[0_0_28px_rgba(99,102,241,0.35),0_0_56px_rgba(217,70,239,0.18)] dark:shadow-[0_0_32px_rgba(99,102,241,0.4),0_0_64px_rgba(217,70,239,0.22)]"
                  >
                    <img
                      src="/logo.png"
                      alt=""
                      className="h-full w-full origin-center scale-[1.22] object-contain object-center select-none"
                      style={{ background: 'transparent' }}
                      aria-hidden
                    />
                  </div>
                  <EmptyStateGreetingTitle sessionKey={activeSessionId ?? ''} />
                  <EmptyStateHint />
                  <div className="mt-4 sm:mt-5">
                    <SuggestedQuestions
                      session={activeSession}
                      selectedScopeFiles={selectedScopeFiles}
                      disabled={isLoading || !activeSessionId}
                      onSelect={(question) => {
                        void submitMessage(question)
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const isLastMessage = m.role === 'assistant' && i === messages.length - 1
              const isThisTabStreaming = isStreaming && activeSessionId === streamingSessionId
              const isLastAndStreaming = isLastMessage && isThisTabStreaming
              const messageCitationMap =
                citationMapsByMessageId.get(m.id) ?? buildCitationMapForMessage(m.citations)
              return (
                <MessageBubble
                  key={m.id ?? i}
                  message={{
                    id: m.id,
                    type: m.role === 'user' ? 'user' : 'assistant',
                    content: m.content,
                    timestamp: new Date(m.timestamp).toISOString(),
                    attachments: m.attachments as ChatMessageAttachment[] | undefined,
                    scopeFiles: m.scopeFiles,
                    citations: m.citations,
                    metadata: (m as any).metadata,
                    thinking: (m as any).thinking,
                    error: m.error,
                  }}
                  isStreaming={isLastAndStreaming}
                  liveThinking={
                    isLastAndStreaming
                      ? {
                          thoughtData: thinking.thoughtData,
                          stages: thinking.stages,
                          currentStage: thinking.currentStage,
                        }
                      : undefined
                  }
                  citationMap={messageCitationMap}
                  onCiteClick={handleCitationClick}
                />
              )
            })}

            {error && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="py-3 text-sm text-destructive">
                  {error}
                </CardContent>
              </Card>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      </ScrollArea>

      {/* 输入区 - Gemini 风格悬浮框 */}
      <div className="relative px-3 pb-3">
        <div className="mx-auto max-w-4xl relative">
          {/* 一体化输入框：flex 布局，textarea 与按钮区分离；focus 时极细 indigo/fuchsia 环与品牌一致 */}
          <div className="flex flex-col overflow-hidden rounded-3xl bg-white border border-slate-200/60 shadow-lg shadow-slate-900/10 transition-[box-shadow] duration-200 focus-within:ring-2 focus-within:ring-indigo-400/40 focus-within:shadow-[0_0_0_1px_rgba(217,70,239,0.22)] dark:bg-slate-800 dark:border-slate-700/60 dark:shadow-slate-900/30 dark:focus-within:ring-indigo-400/35 dark:focus-within:shadow-[0_0_0_1px_rgba(217,70,239,0.28)]">
            {(selectedScopeFiles.length > 0 || attachments.length > 0) && (
              <div className="flex flex-col gap-3 border-b border-slate-100/90 bg-gradient-to-b from-slate-50/90 via-indigo-50/20 to-transparent px-4 py-3 dark:border-slate-700/60 dark:from-slate-900/40 dark:via-indigo-950/25 dark:to-transparent">
                {selectedScopeFiles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedScopeFiles.map((file) => (
                      <button
                        key={`${file.kbId}::${file.fileId}`}
                        type="button"
                        onClick={() => {
                          setSelectedScopeFiles(prev =>
                            prev.filter(item => !(item.kbId === file.kbId && item.fileId === file.fileId))
                          )
                        }}
                        className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200/70 bg-white/90 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-slate-950/70 dark:text-emerald-200"
                      >
                        <AtSign className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{file.kbName ? `${file.kbName} / ${file.name}` : file.name}</span>
                        <X className="h-3.5 w-3.5 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {attachments.map((a) => {
                      const isImage = a.file.type.startsWith('image/')
                      const item: ChatMessageAttachment = {
                        id: a.id,
                        kind: isImage ? 'image' : 'audio',
                        name: a.file.name,
                        size: a.file.size,
                        previewUrl: a.previewUrl,
                      }
                      return (
                        <ComposerAttachmentTile
                          key={a.id}
                          item={item}
                          onRemove={() => {
                            if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
                            setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                const nextValue = e.target.value
                setInput(nextValue)
                syncMentionState(nextValue, e.target.selectionStart)
              }}
              onSelect={(e) => {
                syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart)
              }}
              onBlur={() => {
                requestAnimationFrame(() => {
                  if (document.activeElement !== inputRef.current) {
                    setMentionState(null)
                  }
                })
              }}
              onKeyDown={(e) => {
                if (mentionState) {
                  if (e.key === 'ArrowDown' && mentionOptions.length > 0) {
                    e.preventDefault()
                    setMentionHighlightIndex(prev => (prev + 1) % mentionOptions.length)
                    return
                  }
                  if (e.key === 'ArrowUp' && mentionOptions.length > 0) {
                    e.preventDefault()
                    setMentionHighlightIndex(prev => (prev - 1 + mentionOptions.length) % mentionOptions.length)
                    return
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && mentionOptions.length > 0) {
                    e.preventDefault()
                    const target = mentionOptions[Math.min(mentionHighlightIndex, mentionOptions.length - 1)]
                    if (target) insertMentionSelection(target)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setMentionState(null)
                    return
                  }
                }
                // Enter 发送，Shift + Enter 换行
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
                // Cmd/Ctrl + Enter 也可以发送（保留原有功能）
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="输入你的问题"
              rows={1}
              className="w-full resize-none border-0 bg-transparent px-6 py-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500 disabled:opacity-50 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-slate-400 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 dark:[&::-webkit-scrollbar-thumb]:hover:bg-slate-500"
              style={{ minHeight: '56px', maxHeight: '192px' }}
              disabled={isLoading || !activeSessionId}
            />

            {mentionState && (
              <div className="border-t border-slate-100/90 px-4 pb-2 dark:border-slate-700/60">
                <div className="max-h-72 overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-2 shadow-lg shadow-slate-900/10 dark:border-slate-700/70 dark:bg-slate-900/95">
                  {mentionOptions.length > 0 ? (
                    <div className="space-y-3">
                      {mentionGroups.map(group => (
                        <div key={group.kbId} className="space-y-1">
                          <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {group.kbName}
                            <span className="ml-2 normal-case tracking-normal text-slate-400 dark:text-slate-500">
                              {group.totalMatches} 个匹配
                            </span>
                          </div>
                          <div className="space-y-1">
                            {group.files.map(file => {
                              const optionIndex = mentionOptionIndexByKey.get(fileScopeKey(group.kbId, file.id)) ?? 0
                              const isActive = optionIndex === mentionHighlightIndex
                              return (
                                <button
                                  key={`${group.kbId}::${file.id}`}
                                  ref={node => {
                                    mentionOptionRefs.current[optionIndex] = node
                                  }}
                                  type="button"
                                  onMouseDown={e => {
                                    e.preventDefault()
                                    insertMentionSelection({ kbId: group.kbId, kbName: group.kbName, file })
                                  }}
                                  className={cn(
                                    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                                    isActive
                                      ? 'bg-emerald-500/10 text-emerald-900 ring-1 ring-emerald-500/20 dark:text-emerald-100'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                  )}
                                >
                                  <AtSign className={cn('h-4 w-4 flex-shrink-0', isActive ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400')} />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">{file.name}</div>
                                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                      <span>{String(file.type || 'file').toUpperCase()}</span>
                                      <span>{formatScopedFileSize(file.size)}</span>
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">
                      {scopeLoadingKbIds.length > 0 ? '正在加载文件列表...' : '没有匹配的文件。'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 底部功能栏 - 独立区域，与文字区物理分离 */}
            <div className="flex flex-shrink-0 items-center justify-between px-4 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setKbConfigPanelOpen(true)}
                  title="知识库范围配置"
                  className="group flex items-center gap-1.5 rounded-full border border-blue-200/60 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 backdrop-blur-sm px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm shadow-blue-500/10 ring-1 ring-blue-200/30 transition-all duration-200 hover:border-blue-300/80 hover:from-blue-100/90 hover:to-indigo-100/90 hover:shadow-md hover:shadow-blue-500/20 hover:ring-blue-300/50 active:scale-95 dark:border-blue-500/40 dark:from-blue-900/30 dark:to-indigo-900/30 dark:text-blue-200 dark:ring-blue-500/20 dark:hover:border-blue-400/60 dark:hover:from-blue-800/40 dark:hover:to-indigo-800/40"
                >
                  <Database className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300 transition-transform duration-200 group-hover:scale-110" />
                  <span>
                    {activeSession?.kbMode === 'all'
                      ? '全部'
                      : activeSession?.kbMode === 'manual'
                        ? `指定 ${activeSession?.knowledgeBaseIds?.length ?? 0} 个`
                        : '智能路由'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setModelConfigPanelOpen(true)}
                  title="对话模型选择"
                  className="group flex items-center gap-1.5 rounded-full border border-purple-200/60 bg-gradient-to-r from-purple-50/80 to-pink-50/80 backdrop-blur-sm px-3 py-1.5 text-xs font-semibold text-purple-700 shadow-sm shadow-purple-500/10 ring-1 ring-purple-200/30 transition-all duration-200 hover:border-purple-300/80 hover:from-purple-100/90 hover:to-pink-100/90 hover:shadow-md hover:shadow-purple-500/20 hover:ring-purple-300/50 active:scale-95 dark:border-purple-500/40 dark:from-purple-900/30 dark:to-pink-900/30 dark:text-purple-200 dark:ring-purple-500/20 dark:hover:border-purple-400/60 dark:hover:from-purple-800/40 dark:hover:to-pink-800/40"
                >
                  {openRouterModelRaw ? (
                    <OpenRouterModelBrandIcon
                      modelId={openRouterModelRaw}
                      size={14}
                      className="h-3.5 w-3.5 flex-shrink-0 p-0 ring-0 transition-transform duration-200 group-hover:scale-110 dark:bg-transparent"
                    />
                  ) : currentModelLogo ? (
                    <img
                      src={currentModelLogo}
                      alt=""
                      className="h-3.5 w-3.5 flex-shrink-0 rounded object-contain transition-transform duration-200 group-hover:scale-110"
                      width={14}
                      height={14}
                    />
                  ) : (
                    <Zap className="h-3.5 w-3.5 flex-shrink-0 text-purple-600 dark:text-purple-300 transition-transform duration-200 group-hover:scale-110 group-hover:rotate-12" />
                  )}
                  <span className="truncate max-w-[120px]">{currentModel}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFileScopePickerOpen(true)}
                  title="指定检索文件"
                  className={cn(
                    'group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 transition-all duration-200 active:scale-95',
                    selectedScopeFiles.length > 0
                      ? 'border-emerald-300/80 bg-gradient-to-r from-emerald-50/90 to-teal-50/80 text-emerald-700 shadow-emerald-500/10 ring-emerald-200/50 hover:border-emerald-400/80 hover:from-emerald-100/90 hover:to-teal-100/90 dark:border-emerald-500/40 dark:from-emerald-900/30 dark:to-teal-900/20 dark:text-emerald-200'
                      : 'border-slate-200/70 bg-white/70 text-slate-600 ring-slate-200/50 hover:border-slate-300/80 hover:bg-white/90 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-300'
                  )}
                >
                  <AtSign className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" />
                  <span>{selectedScopeFiles.length > 0 ? `文件 ${selectedScopeFiles.length}` : '文件'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="添加附件"
                  className="flex h-8 w-8 items-center justify-center text-slate-700 transition-all duration-200 hover:text-slate-900 hover:scale-110 active:scale-95 dark:text-slate-300 dark:hover:text-slate-100"
                >
                  <Paperclip className="h-5 w-5" strokeWidth={2} />
                </button>

                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    title="停止生成"
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/30 transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/40 hover:scale-105 active:scale-95"
                    )}
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSend}
                    title="发送"
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/30 transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/40 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                    )}
                    disabled={(!input.trim() && attachments.length === 0) || isLoading || !activeSessionId}
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,audio/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* 引用悬浮卡片 */}
      <div ref={citePopoverRef}>
        <CitationPopover
          open={citePopover.open}
          rect={citePopover.rect}
          item={citePopover.item}
          onClose={closeCitePopover}
          onOpenInspector={openInspectorFromPopover}
        />
      </div>

      {/* 配置面板 */}
      <KnowledgeBaseConfigPanel open={kbConfigPanelOpen} onOpenChange={setKbConfigPanelOpen} />
      <FileScopePicker
        open={fileScopePickerOpen}
        onOpenChange={setFileScopePickerOpen}
        value={selectedScopeFiles}
        onChange={setSelectedScopeFiles}
      />
      <ModelConfigPanel open={modelConfigPanelOpen} onOpenChange={setModelConfigPanelOpen} />

      {/* 检查器侧边栏 */}
      <InspectorDrawer
        isOpen={inspectorOpen}
        onClose={() => {
          setInspectorOpen(false)
          setInspectingItem(null)
        }}
        citations={inspectingItem ? [inspectingItem] : []}
      />
    </div>
  )
}

export default ChatInterface
