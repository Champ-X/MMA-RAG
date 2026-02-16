import { useState, useEffect } from 'react'
import { Zap } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useConfigStore } from '@/store/useConfigStore'
import { systemApi } from '@/services/api_client'
import { cn } from '@/lib/utils'

interface ModelConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModelConfigPanel({ open, onOpenChange }: ModelConfigPanelProps) {
  const { config, updateModelConfig } = useConfigStore()
  const [chatModels, setChatModels] = useState<string[]>([])
  const [currentChatModel, setCurrentChatModel] = useState<string>('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [_userSelectedModel, setUserSelectedModel] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setUserSelectedModel(null)
      return
    }
    
    // 对话框打开时，先从本地配置读取用户之前保存的模型选择
    const savedChatModel = config.models.find(m => m.id === 'chat')?.model
    if (savedChatModel) {
      setCurrentChatModel(savedChatModel)
      setUserSelectedModel(savedChatModel)
    }
    
    setModelsLoading(true)
    systemApi
      .getModelConfig()
      .then((data: { chat_models?: string[]; current_config?: { final_generation?: { model: string } } }) => {
        setChatModels(Array.isArray(data.chat_models) ? data.chat_models : [])
        // 如果本地没有保存的模型选择，才使用后端配置
        if (!savedChatModel) {
          const model = data.current_config?.final_generation?.model
          setCurrentChatModel(model || config.models.find(m => m.id === 'chat')?.model || '')
        }
      })
      .catch(() => {
        setChatModels([])
        if (!savedChatModel) {
          setCurrentChatModel(config.models.find(m => m.id === 'chat')?.model || '')
        }
      })
      .finally(() => setModelsLoading(false))
  }, [open, config.models])

  const handleModelSelect = (modelName: string) => {
    setCurrentChatModel(modelName)
    setUserSelectedModel(modelName)
    // 更新本地配置（虽然后端暂无更新接口，但前端先保存选择）
    updateModelConfig('chat', { model: modelName })
  }

  const handleApply = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[90vh] flex flex-col rounded-3xl border border-slate-200/60 bg-white/85 shadow-2xl shadow-slate-900/20 backdrop-blur-xl dark:border-slate-700/50 dark:bg-slate-950/90"
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader className="flex-shrink-0 pb-3">
          <DialogTitle className="flex items-center gap-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10">
              <Zap className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            对话模型
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
          <div className="py-1 pr-4 pb-2">
            <div className="rounded-2xl border border-slate-200/50 bg-white/50 p-4 shadow-sm backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/50">
              {modelsLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">加载中…</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {chatModels.length === 0 ? (
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      {config.models.find(m => m.id === 'chat')?.name || '对话模型'}
                    </span>
                  ) : (
                    chatModels.map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleModelSelect(m)}
                        className={cn(
                          'rounded-xl border px-3 py-1.5 text-sm font-medium transition-all duration-200 shadow-sm cursor-pointer backdrop-blur-sm',
                          m === currentChatModel
                            ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-700 shadow-md shadow-indigo-500/15 dark:bg-indigo-500/20 dark:text-indigo-200'
                            : 'border-slate-200/80 bg-white/60 text-slate-600 hover:bg-white/80 hover:border-slate-300/80 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/80'
                        )}
                      >
                        {m}
                      </button>
                    ))
                  )}
                </div>
              )}
              <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">当前使用后端配置的 final_generation 模型</p>
            </div>
          </div>
        </ScrollArea>

        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200/50 pt-4 mt-3 dark:border-slate-800/50">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            className="rounded-xl border-slate-200/80 bg-white/50 backdrop-blur-sm hover:bg-white/70 dark:border-slate-600/80 dark:bg-slate-800/50 dark:hover:bg-slate-700/70"
          >
            取消
          </Button>
          <Button 
            onClick={handleApply}
            className="rounded-xl bg-indigo-500/90 backdrop-blur-sm text-white shadow-md shadow-indigo-500/25 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/30"
          >
            应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
