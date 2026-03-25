import { useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatSession } from '@/store/useChatStore'

interface ConversationTabsProps {
  conversations: ChatSession[]
  activeConversationId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function ConversationTabs({
  conversations,
  activeConversationId,
  onSelect,
  onCreate,
  onDelete,
}: ConversationTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current && activeConversationId) {
      const activeTab = scrollRef.current.querySelector(
        `[data-conv-id="${activeConversationId}"]`
      )
      if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [activeConversationId])

  return (
    <div className="relative flex-shrink-0 px-3 pt-1">
      <div className="relative overflow-hidden rounded-[22px] border-[1.5px] border-slate-300/95 bg-white/84 ring-1 ring-slate-200/80 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.16),0_16px_36px_-28px_rgba(76,29,149,0.3)] backdrop-blur-xl dark:border-slate-600/90 dark:bg-slate-950/68 dark:ring-white/[0.08] dark:shadow-[0_16px_34px_-24px_rgba(0,0,0,0.6),0_18px_36px_-30px_rgba(76,29,149,0.28)]">
        <div
          className="pointer-events-none absolute inset-[1.5px] rounded-[20px] border border-white/75 dark:border-white/[0.06]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-indigo-300/70 to-transparent dark:via-violet-400/35"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-8 top-0 h-20 w-28 rounded-full bg-indigo-200/45 blur-3xl dark:bg-indigo-500/12"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-0 top-1 h-16 w-24 rounded-full bg-fuchsia-200/40 blur-3xl dark:bg-fuchsia-500/10"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-8 bg-gradient-to-r from-white/90 to-transparent dark:from-slate-950/80"
          aria-hidden
        />

        <div className="relative flex min-h-0 items-stretch">
          <div className="relative min-w-0 flex-1">
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-10 bg-gradient-to-l from-white/95 to-transparent dark:from-slate-950/90"
              aria-hidden
            />
            <div
              ref={scrollRef}
              className="relative flex min-h-0 items-center gap-2 overflow-x-auto px-3 py-2 pr-2 scrollbar-hide"
            >
        {conversations.map((conv) => {
          const isActive = conv.id === activeConversationId
          const firstUserMsg = conv.messages.find((m) => m.role === 'user')
          const displayTitle = firstUserMsg
            ? firstUserMsg.content.slice(0, 28) + (firstUserMsg.content.length > 28 ? '…' : '')
            : conv.title

          return (
            <div
              key={conv.id}
              data-conv-id={conv.id}
              className={cn(
                'group relative flex min-w-0 max-w-[min(260px,72vw)] shrink-0 items-center gap-2 overflow-hidden rounded-2xl border-[1.5px] px-3 py-2 transition-all duration-200 ease-out',
                isActive
                  ? 'border-indigo-400/95 bg-gradient-to-br from-indigo-50/95 via-white to-violet-50/80 text-slate-950 ring-1 ring-indigo-300/75 shadow-[0_12px_24px_-20px_rgba(99,102,241,0.85)] dark:border-violet-400/50 dark:bg-gradient-to-br dark:from-violet-950/90 dark:via-slate-900 dark:to-indigo-950/80 dark:text-slate-50 dark:ring-violet-400/30 dark:shadow-[0_14px_28px_-22px_rgba(76,29,149,0.9)]'
                  : 'border-slate-300/90 bg-white/68 text-slate-600 ring-1 ring-inset ring-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_8px_18px_-20px_rgba(15,23,42,0.35)] hover:-translate-y-[1px] hover:border-indigo-300/85 hover:bg-white/82 hover:text-slate-900 hover:ring-indigo-100/80 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_22px_-18px_rgba(99,102,241,0.45)] dark:border-slate-600/85 dark:bg-slate-900/55 dark:text-slate-300 dark:ring-white/[0.05] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:hover:border-violet-400/30 dark:hover:bg-slate-900/82 dark:hover:text-slate-50 dark:hover:ring-violet-300/10'
              )}
            >
              {isActive && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 shadow-[0_0_0_4px_rgba(129,140,248,0.14)] transition-all duration-200 dark:shadow-[0_0_0_4px_rgba(99,102,241,0.18)]"
                  aria-hidden
                />
              )}
              <button
                type="button"
                className={cn(
                  'min-w-0 flex-1 truncate text-left text-[14px] font-medium leading-snug tracking-tight'
                )}
                onClick={() => onSelect(conv.id)}
              >
                {displayTitle}
              </button>
              {conversations.length > 1 && (
                <button
                  type="button"
                  title="删除对话"
                  className={cn(
                    'shrink-0 rounded-xl p-1 transition-all duration-200',
                    isActive
                      ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100'
                      : 'text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-100'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(conv.id)
                  }}
                >
                  <X size={12} strokeWidth={2.25} />
                </button>
              )}
            </div>
          )
        })}
            </div>
          </div>

          <div className="flex shrink-0 items-center border-l border-slate-200/90 bg-gradient-to-b from-white/90 to-indigo-50/40 py-2 pl-2.5 pr-3 backdrop-blur-sm dark:border-slate-600/80 dark:from-slate-950/90 dark:to-indigo-950/35">
            <button
              type="button"
              title="新建对话"
              aria-label="新建对话"
              className={cn(
                'group relative isolate grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-all duration-200 ease-out',
                'bg-gradient-to-br from-indigo-500 via-indigo-500 to-violet-600 text-white',
                'shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_22px_-4px_rgba(99,102,241,0.55)]',
                'ring-[1.5px] ring-indigo-400/50 ring-offset-2 ring-offset-white/90',
                'hover:from-indigo-600 hover:via-indigo-600 hover:to-violet-700',
                'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_28px_-4px_rgba(91,33,182,0.55)]',
                'active:scale-[0.95]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/90 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                'dark:from-indigo-500 dark:via-violet-600 dark:to-violet-700',
                'dark:ring-indigo-300/40 dark:ring-offset-slate-950',
                'dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_24px_-4px_rgba(76,29,149,0.65)]',
                'dark:hover:from-indigo-400 dark:hover:via-violet-500 dark:hover:to-violet-600',
                'dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_14px_32px_-4px_rgba(99,102,241,0.45)]',
                'dark:focus-visible:ring-offset-slate-950'
              )}
              onClick={onCreate}
            >
              <Plus
                size={18}
                strokeWidth={2.75}
                className="relative z-[1] shrink-0 drop-shadow-sm transition-transform duration-200 ease-out group-hover:rotate-90 group-hover:scale-110"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
