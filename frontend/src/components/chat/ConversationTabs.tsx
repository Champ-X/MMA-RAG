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
    <div className="flex-shrink-0 border-b border-slate-200/60 bg-gradient-to-b from-slate-50/90 to-white/60 dark:from-slate-900/80 dark:to-slate-950/60 dark:border-slate-800/60 backdrop-blur-sm shadow-sm">
      <div
        ref={scrollRef}
        className="flex items-center gap-2.5 overflow-x-auto px-4 py-3 scrollbar-hide"
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
                'group flex flex-shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 shadow-sm',
                isActive
                  ? 'bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/40'
                  : 'bg-white/80 text-slate-600 border border-slate-200/60 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-800 hover:shadow-md dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/60 dark:hover:bg-slate-700/80 dark:hover:border-slate-600 dark:hover:text-slate-100'
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
                    'flex-shrink-0 rounded-lg p-1 transition-all duration-200',
                    isActive
                      ? 'text-white/80 hover:bg-white/20 hover:text-white'
                      : 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700/70 dark:hover:text-slate-200'
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
          className="flex-shrink-0 rounded-xl px-3.5 py-2 text-slate-500 transition-all duration-200 border border-slate-200/60 bg-white/80 hover:bg-gradient-to-br hover:from-indigo-50 hover:to-purple-50 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-md dark:text-slate-400 dark:border-slate-700/60 dark:bg-slate-800/60 dark:hover:bg-slate-700/80 dark:hover:border-slate-600 dark:hover:text-slate-200"
          onClick={onCreate}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}
