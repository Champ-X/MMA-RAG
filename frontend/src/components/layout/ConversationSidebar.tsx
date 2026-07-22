import { useEffect, useRef } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Moon,
  Network,
  Plus,
  Settings,
  Sun,
  Trash2,
  User,
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

function getConversationTitle(session: ChatSession) {
  const firstUserMessage = session.messages.find((message) => message.role === 'user')
  const title = (firstUserMessage?.content || session.title || '').replace(/\s+/g, ' ').trim()
  return title || '未命名会话'
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
  const sessionCount = String(sessions.length).padStart(2, '0')
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
        initial: 'bg-[#32322F] text-[#D8D7D0]',
        avatar: 'bg-[#33332F] text-[#EAE9E3] ring-[#4B4B45]',
        delete: 'hover:bg-[#3A2729] hover:text-[#FFC2C6] focus-visible:ring-[#FFC2C6]/70',
      }
    : {
        rail: 'border-[#E4EAF2] bg-[#F8FAFC] text-[#182230] shadow-[12px_0_28px_-24px_rgba(30,41,59,0.18)]',
        rule: 'border-[#E4EAF2]',
        logo: 'border-[#E3EAF3] bg-white',
        primary: 'text-[#182230]',
        secondary: 'text-[#506176]',
        muted: 'text-[#8492A6]',
        hover: 'hover:bg-[#F0F4F8] hover:text-[#182230]',
        selected: 'bg-[#EAF0F6] text-[#182230]',
        focus: 'focus-visible:ring-[#60748C] focus-visible:ring-offset-[#F8FAFC]',
        initial: 'bg-[#E9EFF6] text-[#596C82]',
        avatar: 'bg-[#E6EEF7] text-[#506176] ring-[#D5E0EC]',
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
  }, [activeSessionId])

  return (
    <aside
      aria-label="主导航与会话"
      className={cn(
        'relative z-30 flex h-[100dvh] shrink-0 flex-col overflow-hidden border-r font-sans transition-[width] duration-200 ease-out motion-reduce:transition-none',
        theme.rail,
        collapsed ? 'w-[76px]' : 'w-[280px]',
        'max-[640px]:w-[76px]'
      )}
    >
      <header
        className={cn(
          'flex shrink-0 items-center',
          collapsed ? 'h-[84px] flex-col justify-center gap-1.5 px-2' : 'h-[80px] justify-between px-5',
          'max-[640px]:h-[72px] max-[640px]:justify-center max-[640px]:px-3'
        )}
      >
        <div className={cn('flex min-w-0 items-center', collapsed ? 'justify-center' : 'gap-2.5')} title="Nexus">
          <div className={cn('grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl border', theme.logo)}>
            <img
              src="/logo.png"
              alt=""
              width={40}
              height={40}
              draggable={false}
              className="h-full w-full scale-[1.08] object-contain"
            />
          </div>
          <span
            className={cn(
              'truncate text-[18px] font-semibold tracking-[-0.035em]',
              theme.primary,
              collapsed && 'hidden',
              'max-[640px]:hidden'
            )}
          >
            Nexus
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
            theme.muted,
            theme.hover,
            'active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            theme.focus,
            railTransition,
            'max-[640px]:hidden'
          )}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" strokeWidth={1.8} /> : <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />}
        </button>
      </header>

      <div className={cn('shrink-0', collapsed ? 'px-3' : 'px-4', 'max-[640px]:px-3')}>
        <button
          type="button"
          onClick={onNewConversation}
          title="新建对话"
          aria-label="新建对话"
          className={cn(
            'flex h-12 w-full items-center rounded-xl px-3 text-[17px] font-medium tracking-[-0.02em]',
            theme.secondary,
            theme.hover,
            'active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            theme.focus,
            railTransition,
            collapsed ? 'justify-center px-0' : 'gap-3',
            'max-[640px]:justify-center max-[640px]:px-0'
          )}
        >
          <Plus className="h-[22px] w-[22px] shrink-0" strokeWidth={1.75} />
          <span className={cn(collapsed && 'hidden', 'max-[640px]:hidden')}>新建对话</span>
        </button>
      </div>

      <nav aria-label="功能导航" className={cn('shrink-0 pt-3', collapsed ? 'px-3' : 'px-4', 'max-[640px]:px-3')}>
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
                  'flex h-12 w-full items-center rounded-xl px-3 text-[17px] font-medium tracking-[-0.02em]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                  theme.focus,
                  railTransition,
                  collapsed ? 'justify-center px-0' : 'gap-3',
                  active ? theme.selected : cn(theme.secondary, theme.hover),
                  'max-[640px]:justify-center max-[640px]:px-0'
                )}
              >
                <Icon className="h-[22px] w-[22px] shrink-0" strokeWidth={1.75} />
                <span className={cn(collapsed && 'hidden', 'max-[640px]:hidden')}>{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <section
        aria-label="最近会话"
        className={cn(
          'mt-7 flex min-h-0 flex-1 flex-col',
          collapsed ? 'px-2.5' : 'px-4',
          'max-[640px]:px-2.5'
        )}
      >
        <div className={cn('flex shrink-0 items-center justify-between px-3 pb-1.5', collapsed && 'justify-center', 'max-[640px]:justify-center')}>
          <span className={cn('text-[14px] font-medium', theme.muted, collapsed && 'hidden', 'max-[640px]:hidden')}>最近会话</span>
          <span
            className={cn(
              'font-mono text-[11px] font-medium tabular-nums',
              theme.muted,
              collapsed && 'hidden',
              'max-[640px]:hidden'
            )}
          >
            {sessionCount}
          </span>
        </div>

        <div role="list" aria-label="会话列表" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-3 scrollbar-hide">
          {sessions.length === 0 ? (
            <p className={cn('px-3 py-3 text-[15px] leading-6', theme.muted, collapsed && 'hidden', 'max-[640px]:hidden')}>
              还没有对话
            </p>
          ) : (
            sessions.map((session) => {
              const title = getConversationTitle(session)
              const active = session.id === activeSessionId
              const initial = title.slice(0, 1).toUpperCase()

              return (
                <div
                  key={session.id}
                  ref={active ? activeSessionRef : null}
                  role="listitem"
                  className={cn(
                    'group relative flex min-w-0 items-center rounded-xl',
                    railTransition,
                    active ? theme.selected : theme.hover
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation(session.id)}
                    title={title}
                    aria-label={`打开会话：${title}`}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                      theme.focus,
                      collapsed ? 'justify-center px-1.5 py-2.5' : 'px-3 py-2.5',
                      'max-[640px]:justify-center max-[640px]:px-1.5 max-[640px]:py-2.5'
                    )}
                  >
                    <span
                      className={cn(
                        'hidden h-8 w-8 shrink-0 place-items-center rounded-xl text-[11px] font-medium',
                        theme.initial,
                        collapsed && 'grid',
                        'max-[640px]:grid'
                      )}
                      aria-hidden
                    >
                      {initial}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate leading-6 tracking-[-0.02em]',
                        active ? 'text-[17px] font-medium' : 'text-[16px] font-normal',
                        theme.secondary,
                        collapsed && 'hidden',
                        'max-[640px]:hidden'
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
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>

      <footer className={cn('shrink-0 px-4 pb-4 pt-2', collapsed && 'px-3', 'max-[640px]:px-3')}>
        <button
          type="button"
          onClick={onToggleTheme}
          title={isDark ? '切换至浅色主题' : '切换至深色主题'}
          aria-label={isDark ? '切换至浅色主题' : '切换至深色主题'}
          className={cn(
            'flex h-10 w-full items-center rounded-xl px-3 text-[15px] font-medium',
            theme.secondary,
            theme.hover,
            'active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            theme.focus,
            railTransition,
            collapsed ? 'justify-center px-0' : 'gap-3',
            'max-[640px]:justify-center max-[640px]:px-0'
          )}
        >
          {isDark ? <Sun className="h-5 w-5 shrink-0" strokeWidth={1.75} /> : <Moon className="h-5 w-5 shrink-0" strokeWidth={1.75} />}
          <span className={cn(collapsed && 'hidden', 'max-[640px]:hidden')}>{isDark ? '浅色主题' : '深色主题'}</span>
        </button>

        <div className={cn('mt-1 flex h-12 items-center px-3', collapsed ? 'justify-center px-0' : 'gap-3', 'max-[640px]:justify-center max-[640px]:px-0')}>
          <Avatar
            size="sm"
            fallback={<User className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
            rootClassName={cn('text-inherit ring-1 ring-inset', theme.avatar)}
            fallbackClassName="bg-transparent text-inherit"
          />
          <div className={cn('min-w-0', collapsed && 'hidden', 'max-[640px]:hidden')}>
            <div className={cn('truncate text-[16px] font-medium tracking-[-0.02em]', theme.primary)}>Nexus 用户</div>
            <div className={cn('mt-0.5 truncate text-[12px] font-medium', theme.muted)}>本地工作区</div>
          </div>
        </div>
      </footer>
    </aside>
  )
}
