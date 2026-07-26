import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Database,
  MessageSquarePlus,
  Moon,
  Network,
  Search,
  Settings,
  Sun,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { ChatSession } from '@/store/useChatStore'

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
  { id: 'knowledge' as const, label: '知识库', icon: Database },
  { id: 'architecture' as const, label: '架构', icon: Network },
  { id: 'settings' as const, label: '设置', icon: Settings },
]

const railTransition =
  'transition-[background-color,color,opacity,transform] duration-150 ease-out motion-reduce:transition-none'

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
  const matchIndex = normalizedText.indexOf(query)
  if (matchIndex < 0) return <>{text}</>

  const matchEnd = matchIndex + query.length
  return (
    <>
      {text.slice(0, matchIndex)}
      <mark className="rounded-[3px] bg-indigo-100 px-0.5 text-indigo-950 dark:bg-indigo-500/25 dark:text-indigo-100">
        {text.slice(matchIndex, matchEnd)}
      </mark>
      {text.slice(matchEnd)}
    </>
  )
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
  const activeSessionRef = useRef<HTMLDivElement | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedSearchQuery = normalizeSearchText(searchQuery)
  const filteredNavigationItems = navigationItems.filter((item) =>
    item.label.toLocaleLowerCase().includes(normalizedSearchQuery)
  )
  const filteredSessions = useMemo(
    () =>
      sessions
        .map((session) => getSessionSearchResult(session, normalizedSearchQuery))
        .filter((result): result is SessionSearchResult => result !== null)
        .slice(0, 8),
    [normalizedSearchQuery, sessions]
  )
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
        setSearchOpen(true)
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
  }

  const handleSearchOpenChange = (open: boolean) => {
    setSearchOpen(open)
    if (!open) setSearchQuery('')
  }

  const brandMark = (
    <span
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border',
        theme.logo
      )}
    >
      <img
        src="/tessmora-logo.png"
        alt=""
        width={40}
        height={40}
        draggable={false}
        className="h-full w-full scale-[1.22] object-cover object-center"
      />
    </span>
  )

  return (
    <aside
      aria-label="主导航与会话"
      className={cn(
        'relative z-30 flex h-[100dvh] shrink-0 flex-col overflow-hidden border-r font-sans transition-[width] duration-200 ease-out motion-reduce:transition-none',
        theme.rail,
        collapsed ? 'w-[80px]' : 'w-[204px]',
        'max-[640px]:w-[72px]'
      )}
    >
      <header
        className={cn(
          'relative flex shrink-0 items-center',
          collapsed ? 'h-[72px] justify-center px-0' : 'h-[76px] justify-start px-3',
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
              'grid h-12 w-12 place-items-center rounded-xl',
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
              'truncate bg-gradient-to-r from-slate-950 via-indigo-700 to-violet-600 bg-clip-text text-[26px] font-bold leading-none tracking-[0.01em] text-transparent drop-shadow-[0_1px_0_rgba(255,255,255,0.7)]',
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
          type="button"
          onClick={onNewConversation}
          title="新建对话"
          aria-label="新建对话"
          className={cn(
            'flex h-10 w-full items-center rounded-[10px] px-3 text-[14px] font-medium tracking-[-0.01em]',
            theme.secondary,
            theme.hover,
            'active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            theme.focus,
            railTransition,
            collapsed ? 'mx-auto w-10 justify-center px-0' : 'gap-3',
            'max-[640px]:justify-center max-[640px]:px-0'
          )}
        >
          <MessageSquarePlus
            className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-[22px] w-[22px]')}
            strokeWidth={1.75}
            aria-hidden
          />
          <span className={cn(collapsed && 'hidden', 'max-[640px]:hidden')}>新建对话</span>
        </button>
      </div>

      <nav aria-label="功能导航" className={cn('shrink-0 pt-0.5', collapsed ? 'px-0' : 'px-3', 'max-[640px]:px-2')}>
        <div className="space-y-0.5">
          {navigationItems.map((item) => {
            const Icon = item.icon
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
                  'flex h-10 w-full items-center rounded-[10px] px-3 text-[14px] font-medium tracking-[-0.01em]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                  theme.focus,
                  railTransition,
                  collapsed ? 'mx-auto w-10 justify-center px-0' : 'gap-3',
                  active ? theme.selected : cn(theme.secondary, theme.hover),
                  'max-[640px]:justify-center max-[640px]:px-0'
                )}
              >
                <Icon
                  className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-[22px] w-[22px]')}
                  strokeWidth={1.75}
                  aria-hidden
                />
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
                    'group relative flex min-w-0 items-center rounded-[10px]',
                    railTransition,
                    active ? theme.selected : theme.hover
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation(session.id)}
                    title={title}
                    aria-label={`${active ? '当前会话：' : '打开会话：'}${title}`}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                      theme.focus,
                      collapsed ? 'justify-center px-1.5 py-2' : 'px-3 py-1.5',
                      'max-[640px]:justify-center max-[640px]:px-1.5 max-[640px]:py-2'
                    )}
                  >
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
                        onDeleteConversation(session.id)
                      }}
                      title="删除会话"
                      aria-label={`删除会话：${title}`}
                      className={cn(
                        'mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg opacity-0',
                        theme.muted,
                        theme.delete,
                        'focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 group-hover:opacity-100',
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
            type="button"
            onClick={() => setSearchOpen(true)}
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
                'h-4 w-4 shrink-0',
                !collapsed && 'ml-auto',
                'max-[640px]:ml-0'
              )}
              strokeWidth={1.85}
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
              <Sun className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            ) : (
              <Moon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
      </footer>

      <Dialog.Root open={searchOpen} onOpenChange={handleSearchOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-slate-950/30 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
          <Dialog.Content
            aria-describedby="sidebar-search-description"
            className="fixed left-1/2 top-[14vh] z-[90] flex max-h-[68vh] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[0_28px_80px_-24px_rgba(15,23,42,0.45)] outline-none dark:border-slate-700 dark:bg-slate-900"
          >
            <Dialog.Title className="sr-only">搜索页面与会话</Dialog.Title>
            <Dialog.Description id="sidebar-search-description" className="sr-only">
              输入关键词，搜索功能页面、会话标题、用户提问或 AI 回答。
            </Dialog.Description>

            <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-4 dark:border-slate-700">
              <Search className="h-5 w-5 shrink-0 text-slate-400" strokeWidth={1.75} aria-hidden />
              <input
                autoFocus
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索页面、问题或回答…"
                aria-label="搜索页面、问题或回答"
                className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
              />
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭搜索"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              </Dialog.Close>
            </div>

            <div className="min-h-0 overflow-y-auto p-2">
              {filteredNavigationItems.length > 0 && (
                <section aria-labelledby="search-navigation-heading">
                  <h3
                    id="search-navigation-heading"
                    className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                  >
                    功能
                  </h3>
                  <div className="space-y-0.5">
                    {filteredNavigationItems.map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            closeSearch()
                            onNavigate(item.id)
                          }}
                          className="flex h-11 w-full items-center gap-3 rounded-[6px] px-3 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Icon className="h-[18px] w-[18px] text-slate-500 dark:text-slate-400" strokeWidth={1.75} aria-hidden />
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}

              {filteredSessions.length > 0 && (
                <section aria-labelledby="search-sessions-heading" className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                  <h3
                    id="search-sessions-heading"
                    className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                  >
                    会话与消息
                  </h3>
                  <div className="space-y-0.5">
                    {filteredSessions.map((result) => (
                      <button
                        key={result.session.id}
                        type="button"
                        onClick={() => {
                          closeSearch()
                          onSelectConversation(result.session.id)
                        }}
                        aria-label={`打开会话：${result.title}`}
                        className="flex min-h-11 w-full items-start gap-3 rounded-[6px] px-3 py-2.5 text-left text-[14px] text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[6px] bg-slate-100 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                          {result.title.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium">
                              <HighlightedSearchText text={result.title} query={normalizedSearchQuery} />
                            </span>
                            {result.titleMatched && (
                              <span className="shrink-0 rounded-[4px] bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                标题
                              </span>
                            )}
                          </span>

                          {result.matches.length > 0 && (
                            <span className="mt-1.5 block space-y-1.5">
                              {result.matches.map((match) => (
                                <span
                                  key={match.id}
                                  className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-slate-500 dark:text-slate-400"
                                >
                                  <span
                                    className={cn(
                                      'mt-0.5 shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-4',
                                      match.role === 'assistant'
                                        ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'
                                        : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
                                    )}
                                  >
                                    {match.role === 'assistant' ? '回答' : '提问'}
                                  </span>
                                  <span className="line-clamp-2 min-w-0 flex-1">
                                    <HighlightedSearchText text={match.snippet} query={normalizedSearchQuery} />
                                  </span>
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {filteredNavigationItems.length === 0 && filteredSessions.length === 0 && (
                <div className="px-4 py-10 text-center text-[14px] text-slate-500 dark:text-slate-400">
                  没有找到匹配的页面、问题或回答
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  )
}
