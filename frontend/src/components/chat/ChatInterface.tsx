import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Send, Zap, Paperclip, Database, X, Square } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble } from './MessageBubble'
import { CitationPopover } from './CitationPopover'
import { ConversationTabs } from './ConversationTabs'
import { InspectorDrawer } from '@/components/debug/InspectorDrawer'
import { KnowledgeBaseConfigPanel } from './KnowledgeBaseConfigPanel'
import { ModelConfigPanel } from './ModelConfigPanel'
import { OpenRouterModelBrandIcon } from './OpenRouterModelBrandIcon'
import { useChatStore } from '@/store/useChatStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useThinkingChain } from '@/hooks/useThinkingChain'
import { cn } from '@/lib/utils'
import { getModelVendor, VENDOR_LOGOS } from '@/lib/modelVendors'
import type { CitationReference } from '@/types/sse'

export function ChatInterface() {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; size: number }>>([])
  const [citePopover, setCitePopover] = useState<{
    open: boolean
    rect: DOMRect | null
    item: CitationReference | null
  }>({ open: false, rect: null, item: null })
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectingItem, setInspectingItem] = useState<CitationReference | null>(null)
  const [kbConfigPanelOpen, setKbConfigPanelOpen] = useState(false)
  const [modelConfigPanelOpen, setModelConfigPanelOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const citePopoverRef = useRef<HTMLDivElement>(null)
  const prevIsStreamingRef = useRef(false)

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

  const handleSend = async () => {
    if (!input.trim() || isLoading || !activeSessionId) return
    const text = input.trim()
    setInput('')
    setAttachments([])
    setLoading(true)

    try {
      const kbMode = activeSession?.kbMode ?? 'auto'
      const kbIds = activeSession?.knowledgeBaseIds ?? []
      const toSend = kbMode === 'auto' ? undefined : kbIds.length > 0 ? kbIds : undefined
      await sendMessage(text, toSend)
    } catch (e) {
      console.error('发送失败', e)
    } finally {
      setLoading(false)
    }
  }

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
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const newAttachments = files.slice(0, 5).map(f => ({
      id: `a-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: f.name,
      size: f.size
    }))
    setAttachments(prev => [...newAttachments, ...prev].slice(0, 5))
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

  // 构建引用映射
  const citationMap = useMemo(() => {
    const map = new Map<number | string, CitationReference>()
    if (activeSession) {
      for (const msg of activeSession.messages) {
        if (msg.citations) {
          for (const cite of msg.citations) {
            if (typeof cite === 'object' && 'id' in cite) {
              map.set(cite.id, cite as CitationReference)
            }
          }
        }
      }
    }
    return map
  }, [activeSession, messages])

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
                    className="mb-6 inline-flex h-36 w-36 items-center justify-center rounded-full overflow-hidden ring-4 ring-indigo-300/70 dark:ring-indigo-400/50 ring-offset-1 ring-offset-slate-50 dark:ring-offset-slate-950 shadow-[0_0_28px_rgba(99,102,241,0.35),0_0_56px_rgba(217,70,239,0.18)] dark:shadow-[0_0_32px_rgba(99,102,241,0.4),0_0_64px_rgba(217,70,239,0.22)]"
                  >
                    <img
                      src="/logo.png"
                      alt=""
                      className="h-full w-full object-contain select-none"
                      style={{ background: 'transparent' }}
                      aria-hidden
                    />
                  </div>
                  <h3 className="mb-3 text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
                    你好，我是 Nexus
                  </h3>
                  <p className="mx-auto max-w-md text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
                    在输入框设置对话模型与知识库范围后，输入问题即可对话。
                  </p>
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const isLastMessage = m.role === 'assistant' && i === messages.length - 1
              const isThisTabStreaming = isStreaming && activeSessionId === streamingSessionId
              const isLastAndStreaming = isLastMessage && isThisTabStreaming
              return (
                <MessageBubble
                  key={m.id ?? i}
                  message={{
                    id: m.id,
                    type: m.role === 'user' ? 'user' : 'assistant',
                    content: m.content,
                    timestamp: new Date(m.timestamp).toISOString(),
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
                  citationMap={citationMap}
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
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map(a => (
              <span
                key={a.id}
                className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200/60 px-3 py-1.5 text-xs text-slate-700 shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
              >
                <span className="truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                  className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition-colors"
                  aria-label="移除附件"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mx-auto max-w-4xl relative">
          {/* 一体化输入框：flex 布局，textarea 与按钮区分离；focus 时极细 indigo/fuchsia 环与品牌一致 */}
          <div className="flex flex-col overflow-hidden rounded-3xl bg-white border border-slate-200/60 shadow-lg shadow-slate-900/10 transition-[box-shadow] duration-200 focus-within:ring-2 focus-within:ring-indigo-400/40 focus-within:shadow-[0_0_0_1px_rgba(217,70,239,0.22)] dark:bg-slate-800 dark:border-slate-700/60 dark:shadow-slate-900/30 dark:focus-within:ring-indigo-400/35 dark:focus-within:shadow-[0_0_0_1px_rgba(217,70,239,0.28)]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
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
