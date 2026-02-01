import { useState, useEffect } from 'react'
import { SlidersHorizontal, Database, Zap, Route, List, CheckSquare } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useChatStore } from '@/store/useChatStore'
import { systemApi } from '@/services/api_client'
import { cn } from '@/lib/utils'
import type { KbMode } from '@/store/useChatStore'

interface ChatConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatConfigPanel({ open, onOpenChange }: ChatConfigPanelProps) {
  const { knowledgeBases, fetchKnowledgeBases } = useKnowledgeStore()
  const { config, updateSystemConfig } = useConfigStore()
  const { getActiveSession, updateSessionKnowledgeBases } = useChatStore()

  const activeSession = getActiveSession()
  const [kbMode, setKbMode] = useState<KbMode>('auto')
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set())
  const [chatModels, setChatModels] = useState<string[]>([])
  const [currentChatModel, setCurrentChatModel] = useState<string>('')
  const [modelsLoading, setModelsLoading] = useState(false)

  useEffect(() => {
    if (open) fetchKnowledgeBases()
  }, [open, fetchKnowledgeBases])

  useEffect(() => {
    if (activeSession) {
      setKbMode(activeSession.kbMode ?? 'auto')
      setSelectedKbIds(new Set(activeSession.knowledgeBaseIds || []))
    }
  }, [activeSession?.id, activeSession?.knowledgeBaseIds, activeSession?.kbMode])

  useEffect(() => {
    if (!open) return
    setModelsLoading(true)
    systemApi
      .getModelConfig()
      .then((data: { chat_models?: string[]; current_config?: { final_generation?: { model: string } } }) => {
        setChatModels(Array.isArray(data.chat_models) ? data.chat_models : [])
        const model = data.current_config?.final_generation?.model
        setCurrentChatModel(model || config.models.find(m => m.id === 'chat')?.model || '')
      })
      .catch(() => {
        setChatModels([])
        setCurrentChatModel(config.models.find(m => m.id === 'chat')?.model || '')
      })
      .finally(() => setModelsLoading(false))
  }, [open, config.models])

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
        className="max-w-md rounded-2xl border border-slate-200/60 bg-white/95 shadow-xl dark:border-slate-800/60 dark:bg-slate-950/95"
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <SlidersHorizontal className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            发送前配置
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* 检索模式：智能路由 / 全部 / 指定 */}
          <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-4 dark:border-slate-800/60 dark:bg-slate-900/30">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Database className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              知识库范围
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setKbMode('auto')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  kbMode === 'auto'
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                )}
              >
                <Route className="h-4 w-4" />
                智能路由
              </button>
              <button
                type="button"
                onClick={() => setKbMode('all')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  kbMode === 'all'
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                )}
              >
                <List className="h-4 w-4" />
                全部
              </button>
              <button
                type="button"
                onClick={() => setKbMode('manual')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  kbMode === 'manual'
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                )}
              >
                <CheckSquare className="h-4 w-4" />
                指定
              </button>
            </div>
            {kbMode === 'manual' && (
              <ScrollArea className="mt-3 max-h-40 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                {knowledgeBases.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">暂无知识库，请先创建</p>
                ) : (
                  <div className="space-y-1">
                    {knowledgeBases.map(kb => (
                      <label
                        key={kb.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                          'hover:bg-slate-100 dark:hover:bg-slate-800'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedKbIds.has(kb.id)}
                          onChange={() => toggleKb(kb.id)}
                          className="rounded border-slate-300"
                        />
                        <span className="truncate text-sm">{kb.name}</span>
                        <span className="text-xs text-slate-400">{kb.stats?.documents ?? 0} 文档</span>
                      </label>
                    ))}
                  </div>
                )}
              </ScrollArea>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {kbMode === 'auto' && '不传知识库，由后端智能路由选择'}
              {kbMode === 'all' && '在所有知识库中检索'}
              {kbMode === 'manual' && '仅在选中的知识库中检索'}
            </p>
          </div>

          {/* 对话模型（从后端拉取，仅展示） */}
          <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-4 dark:border-slate-800/60 dark:bg-slate-900/30">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Zap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              对话模型
            </div>
            {modelsLoading ? (
              <p className="text-sm text-slate-500">加载中…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {chatModels.length === 0 ? (
                  <span className="text-sm text-slate-500">
                    {config.models.find(m => m.id === 'chat')?.name || '对话模型'}
                  </span>
                ) : (
                  chatModels.map(m => (
                    <span
                      key={m}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-sm',
                        m === currentChatModel
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
                          : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      )}
                    >
                      {m}
                    </span>
                  ))
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-slate-500">当前使用后端配置的 final_generation 模型</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200/60 pt-4 dark:border-slate-800/60">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleApply}>应用</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
