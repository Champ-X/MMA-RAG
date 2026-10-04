import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  CornerDownLeft,
  MessageSquare,
  Moon,
  Search,
  Sun,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { ChatSession } from '@/store/useChatStore'
import { getConversationSearchAction } from './conversationSearchKeyboard'
import { ConversationGlyph } from './ConversationGlyph'
import { SidebarGlyph } from './SidebarGlyph'
import './conversationSearch.css'
import './conversationSidebar.css'

export type SidebarView = 'chat' | 'knowledge' | 'architecture' | 'settings'

interface ConversationSidebarProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  activeView: SidebarView
  collapsed: boolean
  isDark: boolean
  onToggleCollapsed: () => void
  onToggleTheme: () => void
  onNewConversation: () => void
  onSelectConversation: (sessionId: string) => void
  onDeleteConversation: (sessionId: string) => void
  onNavigate: (view: Exclude<SidebarView, 'chat'>) => void
}

const navigationItems = [
  { id: 'knowledge' as const, label: 'Space', description: '浏览与管理知识库', keywords: '知识空间 文档 文件' },
  { id: 'architecture' as const, label: '架构', description: '查看系统模块与处理流程', keywords: 'architecture' },
  { id: 'settings' as const, label: '设置', description: '调整模型与偏好设置', keywords: 'settings 配置' },
]

const railTransition =
  'transition-[background-color,color,opacity,transform] duration-150 ease-out motion-reduce:transition-none'

const SIDEBAR_WIDTH_STORAGE_KEY = 'tessmora.sidebar.width.v1'
const SIDEBAR_DEFAULT_WIDTH = 264
const SIDEBAR_MIN_WIDTH = 224
const SIDEBAR_MAX_WIDTH = 420

function getSidebarMaxWidth() {
  if (typeof window === 'undefined') return SIDEBAR_MAX_WIDTH
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 420))
}

function clampSidebarWidth(width: number) {
  return Math.round(Math.min(getSidebarMaxWidth(), Math.max(SIDEBAR_MIN_WIDTH, width)))
}

function getInitialSidebarWidth() {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH

  const savedWidth = Number.parseInt(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? '', 10)
  return Number.isFinite(savedWidth) ? clampSidebarWidth(savedWidth) : SIDEBAR_DEFAULT_WIDTH
}

const brandWordmarkStyle = {
  fontFamily: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive',
} as const

function getConversationTitle(session: ChatSession) {
  const firstUserMessage = session.messages.find((message) => message.role === 'user')
  const title = (firstUserMessage?.content || session.title || '').replace(/\s+/g, ' ').trim()
  return title || '未命名会话'
}

interface MessageSearchMatch {
  id: string
  role: 'user' | 'assistant'
  snippet: string
}

interface SessionSearchResult {
  session: ChatSession
  title: string
  titleMatched: boolean
  matches: MessageSearchMatch[]
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function toSearchableText(value: string) {
  return value
    .replace(/```[\w+-]*\n?/g, ' ')
    .replace(/[`*_>#~[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSearchSnippet(content: string, normalizedQuery: string, contextLength = 34) {
  const searchableText = toSearchableText(content)
  const normalizedText = searchableText.toLocaleLowerCase()
  const matchIndex = normalizedText.indexOf(normalizedQuery)

  if (matchIndex < 0) {
    return searchableText.length > contextLength * 2
      ? `${searchableText.slice(0, contextLength * 2)}…`
      : searchableText
  }

  const start = Math.max(0, matchIndex - contextLength)
  const end = Math.min(searchableText.length, matchIndex + normalizedQuery.length + contextLength)
  return `${start > 0 ? '…' : ''}${searchableText.slice(start, end)}${end < searchableText.length ? '…' : ''}`
}

function getSessionSearchResult(
  session: ChatSession,
  normalizedQuery: string
): SessionSearchResult | null {
  const title = getConversationTitle(session)

  if (!normalizedQuery) {
    return {
      session,
      title,
      titleMatched: false,
      matches: [],
    }
  }

  const normalizedTitle = normalizeSearchText(title)
  const titleMatched = normalizedTitle.includes(normalizedQuery)
  const matches = session.messages
    .filter((message) => {
      const normalizedContent = normalizeSearchText(message.content)
      if (!normalizedContent.includes(normalizedQuery)) return false
      return !(titleMatched && message.role === 'user' && normalizedContent === normalizedTitle)
    })
    .slice(0, 2)
    .map((message) => ({
      id: message.id,
      role: message.role,
      snippet: buildSearchSnippet(message.content, normalizedQuery),
    }))

  if (!titleMatched && matches.length === 0) return null

  return {
    session,
    title,
    titleMatched,
    matches,
  }
}

function HighlightedSearchText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>

  const normalizedText = text.toLocaleLowerCase()
  const parts = []
  let position = 0
  let matchIndex = normalizedText.indexOf(query)
  while (matchIndex >= 0) {
    parts.push(text.slice(position, matchIndex))
    parts.push(<mark key={matchIndex}>{text.slice(matchIndex, matchIndex + query.length)}</mark>)
    position = matchIndex + query.length
    matchIndex = normalizedText.indexOf(query, position)
  }
  parts.push(text.slice(position))
  return <>{parts}</>
}

export function ConversationSidebar({
  sessions,
  activeSessionId,
  activeView,
  collapsed,
  isDark,
  onToggleCollapsed,
  onToggleTheme,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onNavigate,
}: ConversationSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const activeSessionRef = useRef<HTMLDivElement | null>(null)
  const resizeOriginRef = useRef(0)
  const isResizingRef = useRef(false)
  const bodyStyleRef = useRef({ cursor: '', userSelect: '' })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  const searchReturnFocusRef = useRef<HTMLElement | null>(null)
  const searchResultsRef = useRef<HTMLDivElement>(null)
  const newConversationRef = useRef<HTMLButtonElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const deleteReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const deleteConfirmedRef = useRef(false)
  const searchId = useId()
  const deleteDialogId = useId()
  const [searchOpen, setSearchOpen] = useState(false)
  const [pendingDeletion, setPendingDeletion] = useState<{ id: string; title: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchResult, setActiveSearchResult] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth)
  const [isResizing, setIsResizing] = useState(false)
  const normalizedSearchQuery = normalizeSearchText(searchQuery)
  const filteredNavigationItems = navigationItems.filter((item) =>
    normalizeSearchText(`${item.label} ${item.description} ${item.keywords}`).includes(normalizedSearchQuery)
  )
  const matchingSessions = useMemo(
    () =>
      sessions
        .map((session) => getSessionSearchResult(session, normalizedSearchQuery))
        .filter((result): result is SessionSearchResult => result !== null),
    [normalizedSearchQuery, sessions]
  )
  const filteredSessions = matchingSessions.slice(0, 8)
  const searchResultIds = [
    ...filteredNavigationItems.map(item => `page:${item.id}`),
    ...filteredSessions.map(result => `chat:${result.session.id}`),
  ]
  const selectedSearchResult = activeSearchResult && searchResultIds.includes(activeSearchResult)
    ? activeSearchResult : searchResultIds[0] ?? null
  const searchOptionId = (id: string) => `${searchId}-option-${encodeURIComponent(id)}`
  const theme = isDark
    ? {
        rail: 'border-[#3A3A36] bg-[#1D1D1B] text-[#F0EFEA] shadow-[12px_0_30px_-24px_rgba(0,0,0,0.72)]',
        rule: 'border-[#3A3A36]',
        logo: 'border-[#474742] bg-[#242421]',
        primary: 'text-[#F0EFEA]',
        secondary: 'text-[#C9C8C1]',
        muted: 'text-[#A5A49C]',
        hover: 'hover:bg-[#252522] hover:text-[#F0EFEA]',
        selected: 'bg-[#2B2B28] text-[#F0EFEA]',
        focus: 'focus-visible:ring-[#C8C7BE] focus-visible:ring-offset-[#1D1D1B]',
        avatar: 'bg-[#33332F] text-[#EAE9E3] ring-[#4B4B45]',
        delete: 'hover:bg-[#3A2729] hover:text-[#FFC2C6] focus-visible:ring-[#FFC2C6]/70',
      }
    : {
        rail: 'border-[#E4EAF2] bg-[#F8FAFC] text-[#0B0F16] shadow-[12px_0_28px_-24px_rgba(30,41,59,0.18)]',
        rule: 'border-[#E4EAF2]',
        logo: 'border-[#E3EAF3] bg-white',
        primary: 'text-[#0B0F16]',
        secondary: 'text-[#0B0F16]',
        muted: 'text-[#8492A6]',
        hover: 'hover:bg-[#F0F4F8] hover:text-[#0B0F16]',
        selected: 'bg-[#EAF0F6] text-[#0B0F16]',
        focus: 'focus-visible:ring-[#60748C] focus-visible:ring-offset-[#F8FAFC]',
        avatar: 'bg-[#E6EEF7] text-[#0B0F16] ring-[#D5E0EC]',
        delete: 'hover:bg-[#F3E3E3] hover:text-[#B2434B] focus-visible:ring-[#B2434B]/60',
      }

  useEffect(() => {
    if (!activeSessionRef.current) return
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    activeSessionRef.current.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
    })
  }, [activeSessionId, activeView])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        if (pendingDeletion) return
        if (searchInputRef.current) {
          searchInputRef.current.focus()
          return
        }
        searchReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setActiveSearchResult(null)
        setSearchOpen(true)
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [pendingDeletion])

  useEffect(() => {
    if (!searchOpen) return
    searchResultsRef.current?.querySelector<HTMLElement>('[data-search-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [searchOpen, selectedSearchResult, normalizedSearchQuery])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    const finishResize = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      setIsResizing(false)
      document.body.style.cursor = bodyStyleRef.current.cursor
      document.body.style.userSelect = bodyStyleRef.current.userSelect
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!isResizingRef.current) return
      setSidebarWidth(clampSidebarWidth(event.clientX - resizeOriginRef.current))
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      finishResize()
    }
  }, [])

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setActiveSearchResult(null)
  }

  const confirmConversationDeletion = () => {
    if (!pendingDeletion || deleteConfirmedRef.current) return
    // The list can change while confirmation is open. Never delete a stale target.
    if (!sessions.some((session) => session.id === pendingDeletion.id)) {
      setPendingDeletion(null)
      return
    }
    deleteConfirmedRef.current = true
    onDeleteConversation(pendingDeletion.id)
    setPendingDeletion(null)
  }

  const handleSearchOpenChange = (open: boolean) => {
    setSearchOpen(open)
    if (!open) {
      setSearchQuery('')
      setActiveSearchResult(null)
    }
  }

  const activateSearchResult = (id: string) => {
    const page = filteredNavigationItems.find(item => `page:${item.id}` === id)
    const conversation = filteredSessions.find(result => `chat:${result.session.id}` === id)
    if (!page && !conversation) return
    closeSearch()
    if (page) onNavigate(page.id)
    else if (conversation) onSelectConversation(conversation.session.id)
  }

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const action = getConversationSearchAction({
      key: event.key, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode,
      altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
    }, searchResultIds, selectedSearchResult)
    if (!action) return
    event.preventDefault()
    if (action.type === 'move') setActiveSearchResult(action.id)
    else activateSearchResult(action.id)
  }

  const clearSearchQuery = () => {
    setSearchQuery('')
    setActiveSearchResult(null)
    searchInputRef.current?.focus()
  }

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed || (event.pointerType === 'mouse' && event.button !== 0) || window.innerWidth <= 640) {
      return
    }

    const sidebarRect = sidebarRef.current?.getBoundingClientRect()
    if (!sidebarRect) return

    event.preventDefault()
    resizeOriginRef.current = sidebarRect.left
    isResizingRef.current = true
    bodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setIsResizing(true)
  }

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (collapsed) return

    const step = event.shiftKey ? 32 : 16
    let nextWidth: number | null = null

    if (event.key === 'ArrowLeft') nextWidth = sidebarWidth - step
    if (event.key === 'ArrowRight') nextWidth = sidebarWidth + step
    if (event.key === 'Home') nextWidth = SIDEBAR_MIN_WIDTH
    if (event.key === 'End') nextWidth = getSidebarMaxWidth()

    if (nextWidth === null) return
    event.preventDefault()
    setSidebarWidth(clampSidebarWidth(nextWidth))
  }

  const brandMark = (
    <span
      className={cn(
        'grid h-[52px] w-[52px] shrink-0 place-items-center overflow-hidden rounded-[16px] border',
        theme.logo
      )}
    >
      <img
        src="/tessmora-logo.png"
        alt=""
        width={52}
        height={52}
        draggable={false}
        className="h-full w-full scale-[1.22] object-cover object-center"
      />
    </span>
  )

  return (
    <aside
      ref={sidebarRef}
      aria-label="主导航与会话"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      className={cn(
        'conversation-sidebar relative z-30 flex h-[100dvh] shrink-0 flex-col overflow-hidden border-r font-sans transition-[width] duration-200 ease-out motion-reduce:transition-none',
        theme.rail,
        collapsed ? 'w-[80px]' : 'w-[var(--sidebar-width)]',
        isResizing && 'select-none',
        'max-[640px]:w-[72px]'
      )}
    >
      <header
        className={cn(
          'relative flex shrink-0 items-center',
          collapsed ? 'h-[82px] justify-center px-0' : 'h-[92px] justify-start px-4',
          'max-[640px]:h-[68px] max-[640px]:justify-center max-[640px]:px-2'
        )}
      >
        <div className={cn('flex min-w-0 items-center', !collapsed && 'gap-1.5')}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            className={cn(
              'grid h-[62px] w-[62px] place-items-center rounded-[18px]',
              theme.hover,
              'active:translate-y-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-offset-0',
              theme.focus,
              railTransition
            )}
          >
            {brandMark}
          </button>
          <span
            className={cn(
              'truncate bg-gradient-to-r from-slate-950 via-indigo-700 to-violet-600 bg-clip-text text-[31px] font-bold leading-none tracking-[0.015em] text-transparent drop-shadow-[0_1px_0_rgba(255,255,255,0.7)]',
              'dark:from-slate-50 dark:via-indigo-300 dark:to-violet-300 dark:drop-shadow-none',
              collapsed && 'hidden',
              'max-[640px]:hidden'
            )}
            style={brandWordmarkStyle}
          >
            Tessmora
          </span>
        </div>
      </header>

      <div className={cn('shrink-0', collapsed ? 'px-0' : 'px-3', 'max-[640px]:px-2')}>
        <button
          ref={newConversationRef}
          type="button"
          onClick={onNewConversation}
          title="新建对话"
          aria-label="新建对话"
          className={cn(
            'sidebar-nav-button flex h-10 w-full items-center rounded-[10px] px-[9px] text-[14px] font-medium tracking-[-0.01em]',
            theme.secondary,
            theme.hover,
            'active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            theme.focus,
            railTransition,
            collapsed ? 'mx-auto w-10 justify-center px-0' : 'gap-2.5',
            'max-[640px]:justify-center max-[640px]:px-0'
          )}
        >
          <span className="sidebar-nav-icon" aria-hidden><SidebarGlyph name="new-conversation" /></span>
          <span className={cn(collapsed && 'hidden', 'max-[640px]:hidden')}>新建对话</span>
        </button>
      </div>

      <nav aria-label="功能导航" className={cn('shrink-0 pt-0.5', collapsed ? 'px-0' : 'px-3', 'max-[640px]:px-2')}>
        <div className="space-y-0.5">
          {navigationItems.map((item) => {
            const active = activeView === item.id

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'sidebar-nav-button flex h-10 w-full items-center rounded-[10px] px-[9px] text-[14px] font-medium tracking-[-0.01em]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                  theme.focus,
                  railTransition,
                  collapsed ? 'mx-auto w-10 justify-center px-0' : 'gap-2.5',
                  active ? theme.selected : cn(theme.secondary, theme.hover),
                  'max-[640px]:justify-center max-[640px]:px-0'
                )}
              >
                <span className="sidebar-nav-icon" aria-hidden><SidebarGlyph name={item.id} /></span>
                <span className={cn(collapsed && 'hidden', 'max-[640px]:hidden')}>{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <section
        aria-label="最近会话"
        aria-hidden={collapsed}
        className={cn(
          'mt-5 flex min-h-0 flex-1 flex-col',
          collapsed ? 'mt-0 px-0' : 'px-3',
          'max-[640px]:mt-0 max-[640px]:px-0'
        )}
      >
        <div className={cn('shrink-0 px-3 pb-1.5', collapsed && 'hidden', 'max-[640px]:hidden')}>
          <span className={cn('text-[12px] font-medium tracking-[0.02em]', theme.muted)}>最近会话</span>
        </div>

        <div
          role="list"
          aria-label="会话列表"
          className={cn(
            'min-h-0 flex-1 space-y-0 overflow-y-auto pb-3 scrollbar-hide',
            collapsed && 'hidden',
            'max-[640px]:hidden'
          )}
        >
          {sessions.length === 0 ? (
            <p
              className={cn('px-3 py-3 text-[13px] leading-5', theme.muted, collapsed && 'hidden', 'max-[640px]:hidden')}
              role="status"
            >
              还没有对话
            </p>
          ) : (
            sessions.map((session) => {
              const title = getConversationTitle(session)
              const active = activeView === 'chat' && session.id === activeSessionId

              return (
                <div
                  key={session.id}
                  ref={active ? activeSessionRef : null}
                  role="listitem"
                  className={cn(
                    'conversation-sidebar-row group relative flex min-w-0 items-center rounded-[10px]',
                    railTransition,
                    active ? theme.selected : theme.hover
                  )}
                >
                  <button
                    type="button"
                    data-conversation-select
                    onClick={() => onSelectConversation(session.id)}
                    title={title}
                    aria-label={`${active ? '当前会话：' : '打开会话：'}${title}`}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 text-left transition-[padding] duration-150 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                      theme.focus,
                      collapsed ? 'justify-center px-1.5 py-2' : 'px-3 py-1.5 group-hover:pr-11 group-focus-within:pr-11',
                      'max-[640px]:justify-center max-[640px]:px-1.5 max-[640px]:py-2'
                    )}
                  >
                    <span className="conversation-sidebar-row-icon" data-active={active} aria-hidden>
                      <ConversationGlyph />
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-[14px] leading-5 tracking-[-0.01em]',
                        active ? 'font-semibold' : 'font-normal',
                        theme.secondary
                      )}
                    >
                      {title}
                    </span>
                  </button>
                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        deleteReturnFocusRef.current = event.currentTarget
                        deleteConfirmedRef.current = false
                        setPendingDeletion({ id: session.id, title })
                      }}
                      title="删除会话"
                      aria-label={`删除会话：${title}`}
                      aria-haspopup="dialog"
                      aria-controls={pendingDeletion?.id === session.id ? deleteDialogId : undefined}
                      className={cn(
                        'pointer-events-none absolute right-1.5 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg opacity-0',
                        theme.muted,
                        theme.delete,
                        'focus:pointer-events-auto focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 group-hover:pointer-events-auto group-hover:opacity-100',
                        railTransition,
                        collapsed && 'hidden',
                        'max-[640px]:hidden'
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>

      <footer
        className={cn(
          'mx-3 shrink-0 border-t pb-4 pt-3',
          theme.rule,
          collapsed && 'mx-2.5',
          'max-[640px]:mx-2.5'
        )}
      >
        <div
          className={cn(
            'grid items-center rounded-[14px] border p-1 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)] backdrop-blur-sm',
            'border-[#E3EAF3] bg-white/85 dark:border-[#3A3A36] dark:bg-[#242421]/90 dark:shadow-[0_12px_30px_-22px_rgba(0,0,0,0.8)]',
            collapsed ? 'grid-cols-1 gap-1' : 'grid-cols-[32px_minmax(0,1fr)_32px] gap-1',
            'max-[640px]:grid-cols-1 max-[640px]:gap-1'
          )}
        >
          <div
            aria-label="当前用户：Tessmora"
            className={cn(
              'flex h-8 min-w-0 items-center justify-center',
              collapsed && 'hidden',
              'max-[640px]:hidden'
            )}
          >
            <Avatar
              src="/tessmora-avatar.png"
              alt="Tessmora"
              size="sm"
              fallback={<User className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
              rootClassName={cn('text-inherit ring-1 ring-inset', theme.avatar)}
              fallbackClassName="bg-transparent text-inherit"
            />
          </div>

          <button
            ref={searchTriggerRef}
            type="button"
            onClick={() => {
              searchReturnFocusRef.current = searchTriggerRef.current
              setActiveSearchResult(null)
              setSearchOpen(true)
            }}
            title="搜索页面与会话"
            aria-label="搜索页面与会话"
            className={cn(
              'h-8 w-full rounded-[10px] text-[12px] font-medium',
              collapsed ? 'grid h-9 place-items-center px-0' : 'flex items-center gap-1 px-1.5',
              'bg-[#F0F4F8] hover:bg-[#EAF0F6] dark:bg-[#2B2B28] dark:hover:bg-[#33332F]',
              theme.secondary,
              'active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              theme.focus,
              railTransition,
              'max-[640px]:grid max-[640px]:h-9 max-[640px]:place-items-center max-[640px]:px-0'
            )}
          >
            <span className={cn(collapsed && 'hidden', 'max-[640px]:hidden')}>搜索</span>
            <kbd
              className={cn(
                'rounded-[5px] border border-slate-200/90 bg-white px-1 py-0.5 font-sans text-[8px] font-medium leading-none text-slate-400 shadow-sm',
                'dark:border-[#484842] dark:bg-[#1D1D1B] dark:text-[#929188]',
                collapsed && 'hidden',
                'max-[640px]:hidden'
              )}
              aria-hidden
            >
              ⌘K
            </kbd>
            <Search
              className={cn(
                'sidebar-utility-icon h-4 w-4 shrink-0',
                !collapsed && 'ml-auto',
                'max-[640px]:ml-0'
              )}
              strokeWidth={1.65}
              aria-hidden
            />
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            title={isDark ? '切换至浅色主题' : '切换至深色主题'}
            aria-label={isDark ? '切换至浅色主题' : '切换至深色主题'}
            aria-pressed={isDark}
            className={cn(
              'grid h-8 w-full place-items-center rounded-[10px]',
              theme.secondary,
              theme.hover,
              'active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              theme.focus,
              railTransition,
              collapsed && 'h-9',
              'max-[640px]:h-9'
            )}
          >
            {isDark ? (
              <Sun className="sidebar-utility-icon h-[18px] w-[18px] shrink-0" strokeWidth={1.65} aria-hidden />
            ) : (
              <Moon className="sidebar-utility-icon h-[18px] w-[18px] shrink-0" strokeWidth={1.65} aria-hidden />
            )}
          </button>
        </div>
      </footer>

      {!collapsed && (
        <div
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={getSidebarMaxWidth()}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
          title="拖动调整侧栏宽度；方向键可微调"
          className={cn(
            'group absolute inset-y-0 right-0 z-40 w-3 touch-none cursor-col-resize outline-none focus-visible:bg-indigo-500/12 max-[640px]:hidden',
            isResizing ? 'bg-indigo-500/12' : 'hover:bg-indigo-500/[0.07]'
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute bottom-5 right-1 top-5 w-px rounded-full bg-slate-300/40 transition-colors duration-150 dark:bg-slate-600/40',
              'group-hover:bg-indigo-400/75 group-focus-visible:bg-indigo-500/90 dark:group-hover:bg-indigo-300/70 dark:group-focus-visible:bg-indigo-300/90',
              isResizing && 'bg-indigo-500/90 dark:bg-indigo-300/90'
            )}
          />
        </div>
      )}

      <Dialog.Root open={pendingDeletion !== null} onOpenChange={(open) => { if (!open) setPendingDeletion(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="conversation-delete-overlay" />
          <Dialog.Content
            id={deleteDialogId}
            role="alertdialog"
            className="conversation-delete-dialog"
            onOpenAutoFocus={(event) => { event.preventDefault(); deleteCancelRef.current?.focus() }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const trigger = deleteReturnFocusRef.current
              if (trigger?.isConnected) trigger.focus()
              else {
                const remainingConversation = activeSessionRef.current?.querySelector<HTMLButtonElement>('[data-conversation-select]')
                  ?? sidebarRef.current?.querySelector<HTMLButtonElement>('[data-conversation-select]')
                const focusTarget = remainingConversation ?? newConversationRef.current
                focusTarget?.focus()
              }
            }}
          >
            <div className="conversation-delete-heading">
              <span className="conversation-delete-symbol" aria-hidden><Trash2 size={19} strokeWidth={1.65} /></span>
              <Dialog.Title>删除会话</Dialog.Title>
            </div>
            <Dialog.Description asChild>
              <div>
                <p className="conversation-delete-description">将移除此会话及其消息记录，此操作无法撤销。</p>
                <div className="conversation-delete-target">
                  <MessageSquare size={16} strokeWidth={1.6} aria-hidden />
                  <span>{pendingDeletion?.title}</span>
                </div>
              </div>
            </Dialog.Description>
            <div className="conversation-delete-actions">
              <Dialog.Close asChild>
                <button ref={deleteCancelRef} type="button" className="conversation-delete-cancel">取消</button>
              </Dialog.Close>
              <button type="button" className="conversation-delete-confirm" onClick={confirmConversationDeletion}>删除会话</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={searchOpen} onOpenChange={handleSearchOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="conversation-search-overlay" />
          <Dialog.Content
            className="conversation-search"
            onOpenAutoFocus={(event) => { event.preventDefault(); searchInputRef.current?.focus() }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const target = searchReturnFocusRef.current
              if (target?.isConnected) target.focus()
              else searchTriggerRef.current?.focus()
            }}
          >
            <Dialog.Description className="sr-only">
              搜索功能页面、会话标题、提问或回答。使用上下方向键选择结果，按 Enter 打开，按 Esc 关闭。
            </Dialog.Description>
            <div className="conversation-search-header">
              <div className="conversation-search-heading">
                <Dialog.Title>搜索</Dialog.Title>
              </div>
              <div className="conversation-search-input-row">
                <Search size={19} strokeWidth={1.8} aria-hidden />
                <input
                  ref={searchInputRef}
                  type="search"
                  role="combobox"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(event) => { setSearchQuery(event.target.value); setActiveSearchResult(null) }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="搜索页面、问题或回答…"
                  aria-label="搜索页面、问题或回答"
                  aria-autocomplete="list"
                  aria-expanded={searchOpen}
                  aria-controls={`${searchId}-results`}
                  aria-activedescendant={selectedSearchResult ? searchOptionId(selectedSearchResult) : undefined}
                />
                {searchQuery && <button type="button" className="conversation-search-clear" onClick={clearSearchQuery} aria-label="清空搜索内容"><X size={14} aria-hidden /></button>}
                <Dialog.Close asChild>
                  <button type="button" aria-label="关闭搜索" className="conversation-search-close">esc</button>
                </Dialog.Close>
              </div>
            </div>
            <div ref={searchResultsRef} className="conversation-search-results" id={`${searchId}-results`} role="listbox" aria-label="页面与会话搜索结果">
              {filteredNavigationItems.length > 0 && (
                <div className="conversation-search-group" role="group" aria-labelledby={`${searchId}-navigation`}>
                  <div className="conversation-search-group-heading" id={`${searchId}-navigation`}>页面与功能 <span>{filteredNavigationItems.length}</span></div>
                  {filteredNavigationItems.map((item) => {
                    const id = `page:${item.id}`
                    return (
                      <button
                        key={id} id={searchOptionId(id)} type="button" role="option" tabIndex={-1}
                        aria-selected={selectedSearchResult === id}
                        data-search-active={selectedSearchResult === id}
                        onMouseEnter={() => setActiveSearchResult(id)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => activateSearchResult(id)}
                        className="conversation-search-option"
                      >
                        <span className="conversation-search-option-icon"><SidebarGlyph name={item.id} size={18} /></span>
                        <span className="conversation-search-option-copy">
                          <span className="conversation-search-option-title"><span><HighlightedSearchText text={item.label} query={normalizedSearchQuery} /></span>{activeView === item.id && <span className="conversation-search-result-tag">当前</span>}</span>
                          <span className="conversation-search-option-description"><HighlightedSearchText text={item.description} query={normalizedSearchQuery} /></span>
                        </span>
                        <CornerDownLeft size={15} className="conversation-search-open-icon" aria-hidden />
                      </button>
                    )
                  })}
                </div>
              )}
              {filteredSessions.length > 0 && (
                <div className="conversation-search-group" role="group" aria-labelledby={`${searchId}-sessions`}>
                  <div className="conversation-search-group-heading" id={`${searchId}-sessions`}>{normalizedSearchQuery ? '会话与消息' : '最近会话'} <span>{filteredSessions.length}{matchingSessions.length > filteredSessions.length ? ` / ${matchingSessions.length}` : ''}</span></div>
                  {filteredSessions.map((result) => {
                    const id = `chat:${result.session.id}`
                    return (
                      <button
                        key={id} id={searchOptionId(id)} type="button" role="option" tabIndex={-1}
                        aria-selected={selectedSearchResult === id}
                        data-search-active={selectedSearchResult === id}
                        onMouseEnter={() => setActiveSearchResult(id)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => activateSearchResult(id)}
                        aria-label={`打开会话：${result.title}${result.matches.length ? `，匹配${result.matches.map(match => match.role === 'assistant' ? '回答' : '提问').join('、')}` : ''}`}
                        className="conversation-search-option"
                      >
                        <span className="conversation-search-option-icon"><MessageSquare size={17} strokeWidth={1.7} aria-hidden /></span>
                        <span className="conversation-search-option-copy">
                          <span className="conversation-search-option-title">
                            <span><HighlightedSearchText text={result.title} query={normalizedSearchQuery} /></span>
                            {result.session.id === activeSessionId && activeView === 'chat' && <span className="conversation-search-result-tag">当前</span>}
                            {result.titleMatched && <span className="conversation-search-result-tag">标题匹配</span>}
                          </span>
                          {result.matches.length > 0 ? (
                            <span className="conversation-search-matches">
                              {result.matches.map((match) => (
                                <span key={match.id} className="conversation-search-match">
                                  <span className="conversation-search-match-role" data-role={match.role}>{match.role === 'assistant' ? '回答' : '提问'}</span>
                                  <span className="conversation-search-snippet"><HighlightedSearchText text={match.snippet} query={normalizedSearchQuery} /></span>
                                </span>
                              ))}
                            </span>
                          ) : <span className="conversation-search-option-description">{result.session.messages.length > 0 ? `${result.session.messages.length} 条消息` : '尚无消息'} · 打开会话</span>}
                        </span>
                        <CornerDownLeft size={15} className="conversation-search-open-icon" aria-hidden />
                      </button>
                    )
                  })}
                  {matchingSessions.length > filteredSessions.length && <p className="conversation-search-more">显示前 {filteredSessions.length} 个会话，可输入更具体的关键词继续查找。</p>}
                </div>
              )}
              {searchResultIds.length === 0 && (
                <div className="conversation-search-empty">
                  <span className="conversation-search-empty-icon"><Search size={21} strokeWidth={1.5} aria-hidden /></span>
                  <strong>没有找到相关结果</strong>
                  <p>试试更短的关键词，也可以搜索会话中的提问或回答。</p>
                </div>
              )}
            </div>
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {searchResultIds.length ? `${searchResultIds.length} 项结果` : '暂无匹配'}
            </span>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  )
}
