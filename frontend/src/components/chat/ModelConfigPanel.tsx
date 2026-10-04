import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Cpu, RefreshCw } from 'lucide-react'
import { WorkflowDialog } from '@/components/ui/WorkflowDialog'
import { useConfigStore } from '@/store/useConfigStore'
import { systemApi } from '@/services/api_client'
import { getModelProvider } from '@/lib/modelVendors'
import { getChatModelDisplayName, UnifiedChatModelSearch, type ChatCatalogItem } from './UnifiedChatModelSearch'
import './modelConfigPanel.css'

interface ModelConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function fallbackCatalogItem(registryId: string): ChatCatalogItem {
  const provider = getModelProvider(registryId)
  const providerIds: Record<string, string> = {
    OpenRouter: 'openrouter', AliyunBailian: 'aliyun_bailian',
    SiliconFlow: 'siliconflow', DeepSeek: 'deepseek',
  }
  return {
    registry_id: registryId,
    provider: provider ? providerIds[provider] : (registryId.includes(':') ? registryId.split(':')[0] : 'other'),
    id: registryId.includes(':') ? registryId.slice(registryId.indexOf(':') + 1) : registryId,
  }
}

export function ModelConfigPanel({ open, onOpenChange }: ModelConfigPanelProps) {
  const { config, updateModelConfig } = useConfigStore()
  const [chatModels, setChatModels] = useState<string[]>([])
  const [chatCatalog, setChatCatalog] = useState<ChatCatalogItem[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [currentChatModel, setCurrentChatModel] = useState('')
  const [initialChatModel, setInitialChatModel] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const selectedDuringLoad = useRef(false)

  useEffect(() => {
    if (open) setInitialChatModel(useConfigStore.getState().config.models.find(m => m.id === 'chat')?.model || '')
  }, [open])

  // Selection updates local config immediately; it must not refetch or reset the catalog.
  useEffect(() => {
    if (!open) return
    const savedChatModel = useConfigStore.getState().config.models.find(m => m.id === 'chat')?.model || ''
    setCurrentChatModel(savedChatModel)
    selectedDuringLoad.current = false
    let cancelled = false
    setModelsLoading(true)
    setCatalogError(null)
    systemApi.getModelConfig({ refreshCatalog: true })
      .then((data: {
        chat_models?: string[]
        chat_catalog?: ChatCatalogItem[]
        current_config?: { final_generation?: { model: string } }
      }) => {
        if (cancelled) return
        setChatModels(Array.isArray(data.chat_models) ? data.chat_models : [])
        setChatCatalog(Array.isArray(data.chat_catalog) ? data.chat_catalog : [])
        const latestSavedModel = useConfigStore.getState().config.models.find(m => m.id === 'chat')?.model
        if (latestSavedModel) {
          setCurrentChatModel(latestSavedModel)
        } else if (!selectedDuringLoad.current) {
          setCurrentChatModel(data.current_config?.final_generation?.model || '')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setCatalogError(error instanceof Error ? error.message : '加载失败')
      })
      .finally(() => { if (!cancelled) setModelsLoading(false) })
    return () => { cancelled = true }
  }, [open, refreshKey])

  useEffect(() => {
    if (!open) return
    const savedChatModel = config.models.find(m => m.id === 'chat')?.model
    if (savedChatModel) setCurrentChatModel(savedChatModel)
  }, [open, config.models])

  const catalog = useMemo(() => {
    const entries = new Map<string, ChatCatalogItem>()
    for (const item of chatCatalog) {
      if (item.registry_id) entries.set(item.registry_id, item)
    }
    // Older backends may only expose chat_models. Keep every fallback choice in the same directory.
    for (const registryId of [...chatModels, initialChatModel, currentChatModel]) {
      if (registryId && !entries.has(registryId)) entries.set(registryId, fallbackCatalogItem(registryId))
    }
    return Array.from(entries.values())
  }, [chatCatalog, chatModels, initialChatModel, currentChatModel])

  const applyModel = (modelName: string) => {
    if (!modelName) return
    selectedDuringLoad.current = true
    setCurrentChatModel(modelName)
    updateModelConfig('chat', { model: modelName })
  }
  const currentItem = catalog.find(item => item.registry_id === currentChatModel)
  const currentName = currentItem ? getChatModelDisplayName(currentItem) : currentChatModel
  const currentProvider = getModelProvider(currentChatModel)

  return (
    <WorkflowDialog
      eyebrow="对话设置"
      open={open}
      onOpenChange={onOpenChange}
      title="对话模型"
      description="选择用于生成回答的模型，选择后立即生效。"
      icon={<Cpu size={20} aria-hidden />}
      size="md"
      className="model-config-dialog"
      footer={<>
        <span className="workflow-footer-summary">选择会自动保存到本地配置</span>
        <div className="workflow-footer-actions">
          <button type="button" className="workflow-button workflow-button-primary" onClick={() => onOpenChange(false)}>完成</button>
        </div>
      </>}
    >
      <div className="model-current" aria-live="polite" aria-atomic="true">
        <span className="model-current-symbol" aria-hidden>{currentChatModel ? <Check size={18} /> : <Cpu size={18} />}</span>
        <div className="model-current-copy">
          <p className="model-current-label">当前模型{currentProvider && <span> · {currentProvider === 'AliyunBailian' ? '阿里云百炼' : currentProvider}</span>}</p>
          <p className="model-current-name">{currentName || '尚未选择模型'}</p>
          {currentChatModel && currentName !== currentChatModel && <p className="model-current-id">{currentChatModel}</p>}
        </div>
        <span className="model-current-state">{currentChatModel ? '使用中' : '待选择'}</span>
      </div>

      {catalogError && <div className="model-catalog-notice" role="status">
        <div>
          <p>模型目录暂时无法更新</p>
          <span>{catalog.length > 0 ? '你仍可选择已加载的模型。' : '请检查连接后重试。'}</span>
        </div>
        <button type="button" className="workflow-button workflow-button-quiet" onClick={() => setRefreshKey(key => key + 1)} disabled={modelsLoading}>
          <RefreshCw size={14} aria-hidden />重试
        </button>
      </div>}

      <UnifiedChatModelSearch
        variant="dialog"
        catalog={catalog}
        loading={modelsLoading}
        currentChatModel={currentChatModel}
        onSelect={applyModel}
      />
    </WorkflowDialog>
  )
}
