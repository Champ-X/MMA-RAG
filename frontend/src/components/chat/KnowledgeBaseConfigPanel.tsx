import { useId, useState, useEffect } from 'react'
import { Database, Route, List, CheckSquare } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useChatStore } from '@/store/useChatStore'
import { cn } from '@/lib/utils'
import type { KbMode } from '@/store/useChatStore'

interface KnowledgeBaseConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KnowledgeBaseConfigPanel({ open, onOpenChange }: KnowledgeBaseConfigPanelProps) {
  const { knowledgeBases, fetchKnowledgeBases } = useKnowledgeStore()
  const { updateSystemConfig } = useConfigStore()
  const { getActiveSession, updateSessionKnowledgeBases } = useChatStore()

  const activeSession = getActiveSession()
  const [kbMode, setKbMode] = useState<KbMode>('auto')
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set())
  const dialogId = useId().replace(/:/g, '')
  const dialogTitleId = `${dialogId}-knowledge-base-config-title`
  const dialogDescriptionId = `${dialogId}-knowledge-base-config-description`

  useEffect(() => {
    if (open) fetchKnowledgeBases({ silent: true })
  }, [open, fetchKnowledgeBases])

  useEffect(() => {
    if (activeSession) {
      setKbMode(activeSession.kbMode ?? 'auto')
      setSelectedKbIds(new Set(activeSession.knowledgeBaseIds || []))
    }
  }, [activeSession?.id, activeSession?.knowledgeBaseIds, activeSession?.kbMode, open])

  const toggleKb = (id: string) => {
    setSelectedKbIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleApply = () => {
    if (!activeSession) return
    if (kbMode === 'auto') {
      updateSessionKnowledgeBases(activeSession.id, [], 'auto')
      updateSystemConfig({ defaultKnowledgeBaseIds: [] })
    } else if (kbMode === 'all') {
      const allIds = knowledgeBases.map(kb => kb.id)
      updateSessionKnowledgeBases(activeSession.id, allIds, 'all')
      updateSystemConfig({ defaultKnowledgeBaseIds: allIds })
    } else {
      const ids = Array.from(selectedKbIds)
      updateSessionKnowledgeBases(activeSession.id, ids, 'manual')
      updateSystemConfig({ defaultKnowledgeBaseIds: ids })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        className="max-w-md max-h-[90vh] flex flex-col rounded-3xl border border-slate-200/60 bg-white/85 shadow-2xl shadow-slate-900/20 backdrop-blur-xl dark:border-slate-700/50 dark:bg-slate-950/90"
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader className="flex-shrink-0 pb-3">
          <DialogTitle id={dialogTitleId} className="flex items-center gap-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10">
              <Database className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
            </div>
            知识库范围
          </DialogTitle>
          <DialogDescription id={dialogDescriptionId} className="text-sm text-slate-500 dark:text-slate-400">
            选择本轮对话的知识库检索范围；应用后仅影响当前会话的新问题。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
          <div className="py-1 pr-4 pb-2">
            <div className="rounded-2xl border border-slate-200/50 bg-white/50 p-4 shadow-sm backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/50">
              <div className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40">
                  <Database className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden />
                </div>
                检索模式
              </div>
              <div className="flex gap-2.5" role="radiogroup" aria-label="检索模式">
                <button
                  type="button"
                  onClick={() => setKbMode('auto')}
                  role="radio"
                  aria-checked={kbMode === 'auto'}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 shadow-sm backdrop-blur-sm whitespace-nowrap',
                    kbMode === 'auto'
                      ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-700 shadow-md shadow-indigo-500/15 dark:bg-indigo-500/20 dark:text-indigo-200'
                      : 'border-slate-200/80 bg-white/60 text-slate-600 hover:bg-white/80 hover:border-slate-300/80 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/80'
                  )}
                >
                  <Route className="h-4 w-4 flex-shrink-0" aria-hidden />
                  <span>智能路由</span>
                </button>
                <button
                  type="button"
                  onClick={() => setKbMode('all')}
                  role="radio"
                  aria-checked={kbMode === 'all'}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 shadow-sm backdrop-blur-sm whitespace-nowrap',
                    kbMode === 'all'
                      ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-700 shadow-md shadow-indigo-500/15 dark:bg-indigo-500/20 dark:text-indigo-200'
                      : 'border-slate-200/80 bg-white/60 text-slate-600 hover:bg-white/80 hover:border-slate-300/80 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/80'
                  )}
                >
                  <List className="h-4 w-4 flex-shrink-0" aria-hidden />
                  <span>全部</span>
                </button>
                <button
                  type="button"
                  onClick={() => setKbMode('manual')}
                  role="radio"
                  aria-checked={kbMode === 'manual'}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 shadow-sm backdrop-blur-sm whitespace-nowrap',
                    kbMode === 'manual'
                      ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-700 shadow-md shadow-indigo-500/15 dark:bg-indigo-500/20 dark:text-indigo-200'
                      : 'border-slate-200/80 bg-white/60 text-slate-600 hover:bg-white/80 hover:border-slate-300/80 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/80'
                  )}
                >
                  <CheckSquare className="h-4 w-4 flex-shrink-0" aria-hidden />
                  <span>指定</span>
                </button>
              </div>
              {kbMode === 'manual' && (
                <div className="mt-4 flex flex-col min-h-0">
                  <div
                    aria-label="可指定的知识库"
                    role="list"
                    className="rounded-xl border border-slate-200/50 bg-white/40 backdrop-blur-sm dark:border-slate-700/50 dark:bg-slate-800/50 p-2.5 shadow-inner min-h-[120px] max-h-[320px] overflow-x-hidden overflow-y-auto"
                    style={{ maxHeight: 'min(50vh, 320px)' }}
                  >
                    {knowledgeBases.length === 0 ? (
                      <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400" role="status">
                        暂无知识库，请先创建
                      </p>
                    ) : (
                      <div className="space-y-1.5" role="presentation">
                        {knowledgeBases.map(kb => (
                          <label
                            key={kb.id}
                            className={cn(
                              'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-all duration-200',
                              'hover:bg-white/50 hover:shadow-sm dark:hover:bg-slate-700/50'
                            )}
                            role="listitem"
                          >
                            <input
                              type="checkbox"
                              checked={selectedKbIds.has(kb.id)}
                              onChange={() => toggleKb(kb.id)}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600"
                            />
                            <span className="flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{kb.name}</span>
                            <span className="text-xs text-slate-400 dark:text-slate-500">{kb.stats?.documents ?? 0} 文档</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                {kbMode === 'auto' && '不传知识库，由后端智能路由选择'}
                {kbMode === 'all' && '在所有知识库中检索'}
                {kbMode === 'manual' && `仅在选中的知识库中检索，当前已选 ${selectedKbIds.size} 个`}
              </p>
            </div>
          </div>
        </ScrollArea>

        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200/50 pt-4 mt-3 dark:border-slate-800/50">
          <span className="mr-auto self-center text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
            {kbMode === 'manual' ? `已选 ${selectedKbIds.size} 个知识库` : kbMode === 'all' ? '将检索全部知识库' : '将使用智能路由'}
          </span>
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            className="rounded-xl border-slate-200/80 bg-white/50 backdrop-blur-sm hover:bg-white/70 dark:border-slate-600/80 dark:bg-slate-800/50 dark:hover:bg-slate-700/70"
          >
            取消
          </Button>
          <Button 
            onClick={handleApply}
            aria-label={`应用知识库范围：${kbMode === 'manual' ? `指定 ${selectedKbIds.size} 个知识库` : kbMode === 'all' ? '全部知识库' : '智能路由'}`}
            className="rounded-xl bg-indigo-500/90 backdrop-blur-sm text-white shadow-md shadow-indigo-500/25 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/30"
          >
            应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
