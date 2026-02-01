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
    <div className="flex-shrink-0 border-b border-slate-200/60 bg-white/40 dark:border-slate-800/60 dark:bg-slate-950/40 backdrop-blur">
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto px-4 py-2.5 scrollbar-hide"
      >
        {conversations.map((conv) => {
          const isActive = conv.id === activeConversationId
          const firstUserMsg = conv.messages.find((m) => m.role === 'user')
          const displayTitle = firstUserMsg
            ? firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '')
            : conv.title

          return (
            <div
              key={conv.id}
              data-conv-id={conv.id}
              className={cn(
                'group flex flex-shrink-0 items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-slate-100/50 text-slate-500 hover:bg-slate-200/70 hover:text-slate-700 dark:bg-slate-900/50 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-300'
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => onSelect(conv.id)}
              >
                {displayTitle}
              </button>
              {conversations.length > 1 && (
                <button
                  type="button"
                  title="删除对话"
                  className={cn(
                    'flex-shrink-0 rounded p-0.5 transition-colors',
                    isActive
                      ? 'text-white/70 hover:bg-white/20 hover:text-white'
                      : 'text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700/50 dark:hover:text-slate-200'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(conv.id)
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )
        })}
        <button
          type="button"
          title="新建对话"
          className="flex-shrink-0 rounded-lg px-3 py-1.5 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          onClick={onCreate}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}
