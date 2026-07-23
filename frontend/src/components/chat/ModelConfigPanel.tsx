import { useId, useState, useEffect, useMemo } from 'react'
import { Zap } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useConfigStore } from '@/store/useConfigStore'
import { systemApi } from '@/services/api_client'
import { cn } from '@/lib/utils'
import { groupChatModelsByVendor, getModelVendor, VENDOR_DISPLAY_NAMES, VENDOR_LOGOS } from '@/lib/modelVendors'
import { VendorModelSelect } from './VendorModelSelect'
import { UnifiedChatModelSearch, type ChatCatalogItem } from './UnifiedChatModelSearch'

interface ModelConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModelConfigPanel({ open, onOpenChange }: ModelConfigPanelProps) {
  const { config, updateModelConfig } = useConfigStore()
  const [chatModels, setChatModels] = useState<string[]>([])
  const [chatCatalog, setChatCatalog] = useState<ChatCatalogItem[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [currentChatModel, setCurrentChatModel] = useState<string>('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [_userSelectedModel, setUserSelectedModel] = useState<string | null>(null)

  // 仅打开弹窗时拉取列表；勿依赖 config.models，否则选模型会 updateModelConfig → 全屏「加载中」替换列表，滚动条被顶回顶部
  useEffect(() => {
    if (!open) {
      setUserSelectedModel(null)
      return
    }

    const savedChatModel = config.models.find(m => m.id === 'chat')?.model
    if (savedChatModel) {
      setCurrentChatModel(savedChatModel)
      setUserSelectedModel(savedChatModel)
    }

    let cancelled = false
    setModelsLoading(true)
    systemApi
      .getModelConfig({ refreshCatalog: true })
      .then(
        (data: {
          chat_models?: string[]
          chat_catalog?: ChatCatalogItem[]
          current_config?: { final_generation?: { model: string } }
        }) => {
        if (cancelled) return
        setCatalogError(null)
        setChatModels(Array.isArray(data.chat_models) ? data.chat_models : [])
        setChatCatalog(Array.isArray(data.chat_catalog) ? data.chat_catalog : [])
        if (!savedChatModel) {
          const model = data.current_config?.final_generation?.model
          setCurrentChatModel(model || config.models.find(m => m.id === 'chat')?.model || '')
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setChatModels([])
        setChatCatalog([])
        setCatalogError(e instanceof Error ? e.message : '加载失败')
        if (!savedChatModel) {
          setCurrentChatModel(config.models.find(m => m.id === 'chat')?.model || '')
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 open 时拉取；config 同步见下一 effect
  }, [open])

  useEffect(() => {
    if (!open) return
    const savedChatModel = config.models.find(m => m.id === 'chat')?.model
    if (savedChatModel) {
      setCurrentChatModel(savedChatModel)
      setUserSelectedModel(savedChatModel)
    }
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
  const dialogId = useId().replace(/:/g, '')
  const dialogTitleId = `${dialogId}-chat-model-config-title`
  const dialogDescriptionId = `${dialogId}-chat-model-config-description`

  const selectBaseClass =
    'w-full min-h-[44px] rounded-xl border-2 flex items-center text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        className={cn(
          'max-w-lg max-h-[min(90dvh,820px)] flex flex-col gap-0 overflow-hidden rounded-3xl border border-slate-200/60 bg-white/95 p-5 shadow-2xl shadow-slate-900/15 backdrop-blur-xl sm:p-6',
          'dark:border-slate-700/50 dark:bg-slate-950/95'
        )}
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader className="flex-shrink-0 pb-3">
          <DialogTitle id={dialogTitleId} className="flex items-center gap-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 ring-1 ring-indigo-500/20 dark:ring-indigo-400/30">
              <Zap className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
            </div>
            对话模型
          </DialogTitle>
          <DialogDescription id={dialogDescriptionId} className="text-sm text-slate-500 dark:text-slate-400">
            选择当前会话使用的回答生成模型；选择后会立即写入本地模型配置。
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1',
            '[scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.6)_transparent]',
            '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full',
            '[&::-webkit-scrollbar-thumb]:bg-slate-300/80 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600'
          )}
        >
          <div className="space-y-4 pb-2">
            <UnifiedChatModelSearch
              catalog={chatCatalog}
              loading={modelsLoading}
              fetchError={catalogError}
              currentChatModel={currentChatModel}
              onSelect={applyModel}
            />
            {modelsLoading ? (
              <div
                className={cn(selectBaseClass, 'flex items-center text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600')}
                role="status"
              >
                加载厂商分组…
              </div>
            ) : groupedByVendor.length === 0 ? (
              <div
                className={cn(selectBaseClass, 'flex items-center text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600')}
                role="status"
              >
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
                        <span
                          className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-normal text-indigo-600 dark:text-indigo-400"
                          aria-label="当前正在使用此厂商"
                        >
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

        <div className="mt-3 flex flex-shrink-0 justify-end gap-3 border-t border-slate-200/50 pt-4 dark:border-slate-800/50">
          <span className="mr-auto min-w-0 self-center truncate text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
            当前模型：{currentChatModel || '未选择'}
          </span>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border-slate-200/80 hover:bg-slate-50 dark:border-slate-600/80 dark:hover:bg-slate-800/80"
          >
            取消
          </Button>
          <Button
            onClick={handleApply}
            aria-label={`应用对话模型配置，当前模型：${currentChatModel || '未选择'}`}
            className="rounded-xl bg-indigo-500 text-white shadow-md hover:bg-indigo-600 hover:shadow-lg"
          >
            应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
