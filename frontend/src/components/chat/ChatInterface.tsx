import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Send, Zap, Paperclip, SlidersHorizontal, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble } from './MessageBubble'
import { CitationPopover } from './CitationPopover'
import { ConversationTabs } from './ConversationTabs'
import { InspectorDrawer } from '@/components/debug/InspectorDrawer'
import { ChatConfigPanel } from './ChatConfigPanel'
import { useChatStore } from '@/store/useChatStore'
import { useThinkingChain } from '@/hooks/useThinkingChain'
import { useConfigStore } from '@/store/useConfigStore'
import { cn } from '@/lib/utils'
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
  const [configPanelOpen, setConfigPanelOpen] = useState(false)
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
  } = useChatStore()

  const { config } = useConfigStore()
  const { sendMessage, isStreaming, error } = useThinkingChain()

  const activeSession = getActiveSession()
  const messages = activeSession?.messages ?? []
  const isLoading = isStreaming

  const selectedModel = useMemo(() => {
    return config.models.find(m => m.id === 'chat') || config.models[0] || null
  }, [config.models])

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
    el.style.height = '0px'
    const next = Math.min(el.scrollHeight, 200)
    el.style.height = `${Math.max(next, 56)}px`
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
      {/* 顶部状态条 */}
      <div className="flex items-center justify-between border-b border-slate-200/60 px-4 py-3 backdrop-blur dark:border-slate-800/60">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl bg-indigo-500/10 px-3 py-2 text-indigo-700 ring-1 ring-indigo-500/15 dark:text-indigo-200">
            <Zap className="h-4 w-4" />
            <div className="text-sm font-medium">
              {selectedModel?.name || 'DeepSeek-V3'}
            </div>
          </div>

          <div className="rounded-xl bg-slate-900/5 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-900/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10">
            检索模式：<span className="font-medium">
              {activeSession?.kbMode === 'all'
                ? '全部'
                : activeSession?.kbMode === 'manual'
                  ? `指定 ${activeSession?.knowledgeBaseIds?.length ?? 0} 个`
                  : '智能路由'}
            </span>
          </div>
        </div>

        <div className="hidden items-center gap-2 text-xs text-slate-500 dark:text-slate-400 md:flex">
          <kbd className="rounded-md bg-slate-900/5 px-2 py-1 ring-1 ring-slate-900/10 dark:bg-white/5 dark:ring-white/10">
            ⌘/Ctrl
          </kbd>
          <span>+</span>
          <kbd className="rounded-md bg-slate-900/5 px-2 py-1 ring-1 ring-slate-900/10 dark:bg-white/5 dark:ring-white/10">
            Enter
          </kbd>
          <span>发送</span>
        </div>
      </div>

      {/* 消息区 */}
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <div className="px-4 py-4">
          <div className="mx-auto max-w-4xl flex flex-col gap-8">
            {messages.length === 0 && (
              <Card className="p-10 text-center border-slate-200/60 dark:border-slate-800/60 bg-gradient-to-br from-slate-50/80 to-white/60 dark:from-slate-900/60 dark:to-slate-950/40 shadow-lg">
                <CardContent>
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg">
                    <Zap className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-slate-800 dark:text-slate-100">
                    你好，我是 Nexus
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400">
                    你可以在输入框上方展开配置面板，选择模型与知识库范围，然后开始提问。
                  </p>
                </CardContent>
              </Card>
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
      <div className="border-t border-slate-200/40 bg-gradient-to-t from-white via-white to-transparent dark:border-slate-800/40 dark:from-slate-950 dark:via-slate-950 px-4 py-4">
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

        <div className="mx-auto max-w-4xl">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="输入你的问题…（支持 Markdown / LaTeX / 引用演示）"
              rows={1}
              className="w-full resize-none rounded-3xl border border-slate-200/80 bg-white px-6 py-4 pb-14 text-sm text-slate-900 shadow-lg shadow-slate-900/10 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-slate-300 focus:shadow-xl focus:shadow-slate-900/15 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:shadow-slate-900/30"
              disabled={isLoading || !activeSessionId}
            />

            {/* 底部功能栏 - Gemini 风格 */}
            <div className="absolute bottom-3 left-6 right-6 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="添加附件"
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfigPanelOpen(true)}
                  title="发送前配置"
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleSend}
                title="发送"
                className={cn(
                  "pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/30 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/40 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                )}
                disabled={!input.trim() && attachments.length === 0 || isLoading || !activeSessionId}
              >
                <Send className="h-4 w-4" />
              </button>
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
      <ChatConfigPanel open={configPanelOpen} onOpenChange={setConfigPanelOpen} />

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
