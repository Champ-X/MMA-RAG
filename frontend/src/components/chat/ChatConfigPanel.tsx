import { useState, useEffect } from 'react'
import { SlidersHorizontal, Database } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useChatStore } from '@/store/useChatStore'
import { cn } from '@/lib/utils'

interface ChatConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatConfigPanel({ open, onOpenChange }: ChatConfigPanelProps) {
  const { knowledgeBases, fetchKnowledgeBases } = useKnowledgeStore()
  const { updateSystemConfig } = useConfigStore()
  const { getActiveSession, updateSessionKnowledgeBases } = useChatStore()

  const activeSession = getActiveSession()
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) fetchKnowledgeBases()
  }, [open, fetchKnowledgeBases])

  useEffect(() => {
    if (activeSession) {
      setSelectedKbIds(new Set(activeSession.knowledgeBaseIds || []))
    }
  }, [activeSession?.id, activeSession?.knowledgeBaseIds])


  const toggleKb = (id: string) => {
    setSelectedKbIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleApply = () => {
    if (activeSession) {
      updateSessionKnowledgeBases(activeSession.id, Array.from(selectedKbIds))
    }
    updateSystemConfig({ defaultKnowledgeBaseIds: Array.from(selectedKbIds) })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" />
            发送前配置
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* 知识库选择 */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Database className="h-4 w-4" />
              知识库范围
            </div>
            <ScrollArea className="max-h-40 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
              {knowledgeBases.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">暂无知识库，请先创建</p>
              ) : (
                <div className="space-y-1">
                  {knowledgeBases.map(kb => (
                    <label
                      key={kb.id}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                        'hover:bg-slate-100 dark:hover:bg-slate-800'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedKbIds.has(kb.id)}
                        onChange={() => toggleKb(kb.id)}
                        className="rounded border-slate-300"
                      />
                      <span className="text-sm truncate">{kb.name}</span>
                      <span className="text-xs text-slate-400">
                        {kb.stats?.documents ?? 0} 文档
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
            <p className="text-xs text-slate-500 mt-1">不选则使用全局默认或自动路由</p>
          </div>
          <p className="text-xs text-slate-500">对话模型请在设置页修改</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleApply}>
            应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
