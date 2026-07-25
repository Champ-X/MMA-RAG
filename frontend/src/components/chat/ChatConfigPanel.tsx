import { useState, useEffect, useMemo } from 'react'
import { SlidersHorizontal, Database, Zap, Route, List, CheckSquare, Search, Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useChatStore } from '@/store/useChatStore'
import { systemApi } from '@/services/api_client'
import { cn } from '@/lib/utils'
import { groupChatModelsByVendor, getModelVendor, VENDOR_DISPLAY_NAMES, VENDOR_LOGOS } from '@/lib/modelVendors'
import { VendorModelSelect } from './VendorModelSelect'
import { UnifiedChatModelSearch, type ChatCatalogItem } from './UnifiedChatModelSearch'
import { normalizeAgentMode, type AgentMode, type KbMode } from '@/store/useChatStore'

interface ChatConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatConfigPanel({ open, onOpenChange }: ChatConfigPanelProps) {
  const { knowledgeBases, fetchKnowledgeBases } = useKnowledgeStore()
  const { config, updateSystemConfig, updateModelConfig } = useConfigStore()
  const { getActiveSession, updateSessionKnowledgeBases, updateSessionAgentMode } = useChatStore()

  const activeSession = getActiveSession()
  const [kbMode, setKbMode] = useState<KbMode>('auto')
  const [agentMode, setAgentMode] = useState<AgentMode>('auto')
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set())
  const [chatModels, setChatModels] = useState<string[]>([])
  const [chatCatalog, setChatCatalog] = useState<ChatCatalogItem[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [currentChatModel, setCurrentChatModel] = useState<string>('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [_userSelectedModel, setUserSelectedModel] = useState<string | null>(null)

  useEffect(() => {
    if (open) fetchKnowledgeBases({ silent: true })
  }, [open, fetchKnowledgeBases])

  useEffect(() => {
    if (activeSession) {
      setKbMode(activeSession.kbMode ?? 'auto')
      setAgentMode(normalizeAgentMode(activeSession.agentMode))
      setSelectedKbIds(new Set(activeSession.knowledgeBaseIds || []))
    }
  }, [activeSession?.id, activeSession?.knowledgeBaseIds, activeSession?.kbMode, activeSession?.agentMode])

  // 仅打开弹窗时拉取列表；勿依赖 config.models，否则选模型会触发全量 loading、滚动跳回顶部（与 ModelConfigPanel 相同原因）
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

  const toggleKb = (id: string) => {
    setSelectedKbIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyModel = (modelName: string) => {
    if (!modelName) return
    setCurrentChatModel(modelName)
    setUserSelectedModel(modelName)
    updateModelConfig('chat', { model: modelName })
  }

  const groupedByVendor = useMemo(() => groupChatModelsByVendor(chatModels), [chatModels])

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
    updateSessionAgentMode(activeSession.id, agentMode)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[min(90dvh,880px)] flex flex-col overflow-hidden rounded-3xl border border-slate-200/60 bg-white/85 p-5 shadow-2xl shadow-slate-900/20 backdrop-blur-xl sm:p-6 dark:border-slate-700/50 dark:bg-slate-950/90"
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader className="flex-shrink-0 pb-3">
          <DialogTitle className="flex items-center gap-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10">
              <SlidersHorizontal className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            发送前配置
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 [scrollbar-width:thin] [&>div]:max-h-full [&>div]:overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/80 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600">
          <div className="space-y-4 py-1 pr-3 pb-2">
          {/* 回答方式：保持单次 RAG 与有界 Agentic 检索可切换 */}
          <div className="rounded-2xl border border-slate-200/50 bg-white/50 p-4 shadow-sm backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/50">
            <div className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40">
                <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              回答方式
            </div>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="回答方式">
              <button
                type="button"
                aria-pressed={agentMode === 'auto'}
                onClick={() => setAgentMode('auto')}
                className={cn(
                  'group rounded-xl border px-2.5 py-3 text-left transition-all duration-200',
                  agentMode === 'auto'
                    ? 'border-indigo-400/60 bg-indigo-500/10 text-indigo-800 shadow-md shadow-indigo-500/10 dark:bg-indigo-500/15 dark:text-indigo-200'
                    : 'border-slate-200/80 bg-white/60 text-slate-600 hover:border-slate-300 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300'
                )}
              >
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4" />
                  自动
                </span>
                <span className="block text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                  按问题选择
                </span>
              </button>
              <button
                type="button"
                aria-pressed={agentMode === 'direct'}
                onClick={() => setAgentMode('direct')}
                className={cn(
                  'group rounded-xl border px-2.5 py-3 text-left transition-all duration-200',
                  agentMode === 'direct'
                    ? 'border-sky-400/60 bg-sky-500/10 text-sky-800 shadow-md shadow-sky-500/10 dark:bg-sky-500/15 dark:text-sky-200'
                    : 'border-slate-200/80 bg-white/60 text-slate-600 hover:border-slate-300 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300'
                )}
              >
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Search className="h-4 w-4" />
                  直接
                </span>
                <span className="block text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                  固定单轮检索
                </span>
              </button>
              <button
                type="button"
                aria-pressed={agentMode === 'agent'}
                onClick={() => setAgentMode('agent')}
                className={cn(
                  'group relative overflow-hidden rounded-xl border px-2.5 py-3 text-left transition-all duration-200',
                  agentMode === 'agent'
                    ? 'border-violet-400/60 bg-violet-500/10 text-violet-800 shadow-md shadow-violet-500/10 dark:bg-violet-500/15 dark:text-violet-200'
                    : 'border-slate-200/80 bg-white/60 text-slate-600 hover:border-slate-300 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300'
                )}
              >
                <span className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    深研
                  </span>
                  <span className="flex items-center gap-1" aria-hidden>
                    {[0, 1, 2].map(node => (
                      <span
                        key={node}
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          agentMode === 'agent' ? 'bg-violet-500 dark:bg-violet-300' : 'bg-slate-300 dark:bg-slate-600'
                        )}
                      />
                    ))}
                  </span>
                </span>
                <span className="block text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                  固定多轮补查
                </span>
              </button>
            </div>
            <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
              {agentMode === 'auto'
                ? '根据问题的对比、分步、跨模态和研究复杂度自动选择'
                : agentMode === 'agent'
                  ? '在预算内迭代调用现有图文音视频检索，并保留原引用链路'
                  : '适合简单问答；多模态检索与知识库路由仍然启用'}
            </p>
          </div>

          {/* 检索模式：智能路由 / 全部 / 指定 */}
          <div className="rounded-2xl border border-slate-200/50 bg-white/50 p-4 shadow-sm backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/50">
            <div className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40">
                <Database className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              知识库范围
            </div>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setKbMode('auto')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 shadow-sm backdrop-blur-sm whitespace-nowrap',
                  kbMode === 'auto'
                    ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-700 shadow-md shadow-indigo-500/15 dark:bg-indigo-500/20 dark:text-indigo-200'
                    : 'border-slate-200/80 bg-white/60 text-slate-600 hover:bg-white/80 hover:border-slate-300/80 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/80'
                )}
              >
                <Route className="h-4 w-4 flex-shrink-0" />
                <span>智能路由</span>
              </button>
              <button
                type="button"
                onClick={() => setKbMode('all')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 shadow-sm backdrop-blur-sm whitespace-nowrap',
                  kbMode === 'all'
                    ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-700 shadow-md shadow-indigo-500/15 dark:bg-indigo-500/20 dark:text-indigo-200'
                    : 'border-slate-200/80 bg-white/60 text-slate-600 hover:bg-white/80 hover:border-slate-300/80 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/80'
                )}
              >
                <List className="h-4 w-4 flex-shrink-0" />
                <span>全部</span>
              </button>
              <button
                type="button"
                onClick={() => setKbMode('manual')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 shadow-sm backdrop-blur-sm whitespace-nowrap',
                  kbMode === 'manual'
                    ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-700 shadow-md shadow-indigo-500/15 dark:bg-indigo-500/20 dark:text-indigo-200'
                    : 'border-slate-200/80 bg-white/60 text-slate-600 hover:bg-white/80 hover:border-slate-300/80 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/80'
                )}
              >
                <CheckSquare className="h-4 w-4 flex-shrink-0" />
                <span>指定</span>
              </button>
            </div>
            {kbMode === 'manual' && (
              <ScrollArea className="mt-4 max-h-[min(50vh,320px)] h-auto rounded-xl border border-slate-200/50 bg-white/40 backdrop-blur-sm dark:border-slate-700/50 dark:bg-slate-800/50 p-2.5 shadow-inner">
                {knowledgeBases.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">暂无知识库，请先创建</p>
                ) : (
                  <div className="space-y-1.5">
                    {knowledgeBases.map(kb => (
                      <label
                        key={kb.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-all duration-200',
                          'hover:bg-white/50 hover:shadow-sm dark:hover:bg-slate-700/50'
                        )}
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
              </ScrollArea>
            )}
            <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
              {kbMode === 'auto' && '不传知识库，由后端智能路由选择'}
              {kbMode === 'all' && '在所有知识库中检索'}
              {kbMode === 'manual' && '仅在选中的知识库中检索'}
            </p>
          </div>

          {/* 对话模型（每个厂商一个下拉框） */}
          <div className="rounded-2xl border border-slate-200/50 bg-white/50 p-4 shadow-sm backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/50">
            <div className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40">
                <Zap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              对话模型
            </div>
            <UnifiedChatModelSearch
              catalog={chatCatalog}
              loading={modelsLoading}
              fetchError={catalogError}
              currentChatModel={currentChatModel}
              onSelect={applyModel}
              className="mb-4"
            />
            {modelsLoading ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">加载厂商分组…</p>
            ) : groupedByVendor.length === 0 ? (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {config.models.find(m => m.id === 'chat')?.name || '对话模型'}
              </span>
            ) : (
              <div className="space-y-4">
                {groupedByVendor.map(([vendor, list]) => {
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
                        buttonClassName="min-h-[40px] py-2"
                        ariaLabel={`选择 ${vendor} 模型`}
                      />
                    </div>
                  )
                })}
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
