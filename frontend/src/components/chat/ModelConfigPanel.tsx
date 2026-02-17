import { useState, useEffect, useMemo } from 'react'
import { Zap } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useConfigStore } from '@/store/useConfigStore'
import { systemApi } from '@/services/api_client'
import { cn } from '@/lib/utils'
import { groupChatModelsByVendor, getModelVendor, VENDOR_DISPLAY_NAMES, VENDOR_LOGOS } from '@/lib/modelVendors'
import { VendorModelSelect } from './VendorModelSelect'

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

  const applyModel = (modelName: string) => {
    if (!modelName) return
    setCurrentChatModel(modelName)
    setUserSelectedModel(modelName)
    updateModelConfig('chat', { model: modelName })
  }

  const handleApply = () => {
    onOpenChange(false)
  }

  const groupedByVendor = useMemo(() => groupChatModelsByVendor(chatModels), [chatModels])

  const selectBaseClass =
    'w-full min-h-[44px] rounded-xl border-2 flex items-center text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md flex flex-col gap-0 rounded-3xl border border-slate-200/60 bg-white/95 shadow-2xl shadow-slate-900/15 backdrop-blur-xl dark:border-slate-700/50 dark:bg-slate-950/95"
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader className="flex-shrink-0 pb-4">
          <DialogTitle className="flex items-center gap-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 ring-1 ring-indigo-500/20 dark:ring-indigo-400/30">
              <Zap className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            对话模型
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pb-1">
          <div className="space-y-4">
            {modelsLoading ? (
              <div className={cn(selectBaseClass, 'flex items-center text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600')}>
                加载中…
              </div>
            ) : groupedByVendor.length === 0 ? (
              <div className={cn(selectBaseClass, 'flex items-center text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600')}>
                {config.models.find(m => m.id === 'chat')?.name || '暂无模型'}
              </div>
            ) : (
              groupedByVendor.map(([vendor, list]) => {
                const isCurrentVendor = currentChatModel && getModelVendor(currentChatModel) === vendor
                const value = isCurrentVendor ? currentChatModel : ''
                return (
                  <div key={vendor} className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {VENDOR_LOGOS[vendor] && (
                        <img
                          src={VENDOR_LOGOS[vendor]}
                          alt=""
                          className="h-5 w-5 rounded object-contain"
                          width={20}
                          height={20}
                        />
                      )}
                      <span>{VENDOR_DISPLAY_NAMES[vendor]}</span>
                      {isCurrentVendor && (
                        <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-normal text-indigo-600 dark:text-indigo-400">
                          当前使用
                        </span>
                      )}
                    </label>
                    <VendorModelSelect
                      value={value}
                      list={list}
                      isActive={!!isCurrentVendor}
                      onSelect={applyModel}
                      ariaLabel={`选择 ${vendor} 模型`}
                    />
                  </div>
                )
              })
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              当前使用后端 final_generation 配置，选择后将写入本地配置
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200/50 pt-4 mt-2 dark:border-slate-800/50">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border-slate-200/80 hover:bg-slate-50 dark:border-slate-600/80 dark:hover:bg-slate-800/80"
          >
            取消
          </Button>
          <Button
            onClick={handleApply}
            className="rounded-xl bg-indigo-500 text-white shadow-md hover:bg-indigo-600 hover:shadow-lg"
          >
            应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
