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
    <div className="relative flex-shrink-0 border-b border-violet-300/60 bg-gradient-to-br from-violet-200/95 via-indigo-100 to-violet-100/90 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] backdrop-blur-md dark:border-indigo-800/50 dark:from-indigo-950 dark:via-violet-950/80 dark:to-indigo-950 dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/40 to-transparent dark:via-indigo-400/35"
        aria-hidden
      />

      <div
        ref={scrollRef}
        className="flex min-h-0 items-center gap-2 overflow-x-auto px-3 py-1 scrollbar-hide"
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
                'group relative flex min-w-0 max-w-[min(260px,72vw)] shrink-0 items-center gap-0.5 overflow-hidden rounded-full py-1 pl-2.5 pr-0.5 transition-all duration-200 ease-out',
                isActive
                  ? 'bg-gradient-to-r from-indigo-400 to-violet-500 text-white shadow-sm shadow-indigo-500/15 ring-2 ring-white/35 dark:from-indigo-400/95 dark:to-violet-500/95 dark:shadow-indigo-950/40 dark:ring-white/22'
                  : 'bg-violet-50/95 text-indigo-950 ring-2 ring-indigo-400/55 shadow-sm shadow-indigo-500/10 hover:bg-indigo-50 hover:text-indigo-950 hover:ring-indigo-500/65 hover:shadow-md hover:shadow-indigo-500/15 dark:bg-violet-950/55 dark:text-violet-50 dark:ring-violet-400/50 dark:shadow-md dark:shadow-violet-950/30 dark:hover:bg-violet-900/65 dark:hover:text-white dark:hover:ring-violet-300/45'
              )}
            >
              {isActive && (
                <span
                  className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent"
                  aria-hidden
                />
              )}
              <button
                type="button"
                className={cn(
                  'relative z-[1] min-w-0 flex-1 truncate text-left text-[14px] font-medium leading-snug tracking-tight',
                  isActive && 'text-white/95'
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
                    'relative z-[1] shrink-0 rounded-full p-[3px] transition-all duration-200',
                    isActive
                      ? 'text-white/70 hover:bg-white/18 hover:text-white'
                      : 'text-indigo-400 opacity-0 hover:bg-indigo-200/70 hover:text-indigo-800 group-hover:opacity-100 dark:text-violet-400 dark:hover:bg-violet-900/50 dark:hover:text-violet-50'
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

        <button
          type="button"
          title="新建对话"
          aria-label="新建对话"
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all duration-200',
            'bg-teal-100 text-teal-700 ring-2 ring-teal-500/70 shadow-md shadow-teal-600/20',
            'hover:bg-teal-500 hover:text-white hover:ring-teal-600 hover:shadow-lg hover:shadow-teal-500/35 active:scale-[0.96]',
            'dark:bg-teal-950/80 dark:text-teal-200 dark:ring-2 dark:ring-teal-400/55 dark:shadow-md dark:shadow-teal-950/50',
            'dark:hover:bg-teal-500 dark:hover:text-white dark:hover:ring-teal-300 dark:hover:shadow-teal-500/30'
          )}
          onClick={onCreate}
        >
          <Plus size={16} strokeWidth={2.5} className="shrink-0" />
        </button>
      </div>
    </div>
  )
}
