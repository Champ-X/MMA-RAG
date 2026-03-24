import { useState, useEffect } from 'react'
import { Save, RotateCcw, Settings, AlertCircle, Brain, Image, MessageSquare, ArrowDownUp, Check, ChevronDown } from 'lucide-react'
import { useToastStore } from '@/store/useToastStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { AvailableModels } from '@/store/useConfigStore'

export type TaskId =
  | 'intent'
  | 'caption'
  | 'generation'
  | 'rerank'

export interface TaskModelEntry {
  taskId: TaskId
  label: string
  description: string
  provider: string
  model: string
}

/** Provider 下拉显示名称（补全/友好名称） */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  siliconflow: 'SiliconFlow',
  deepseek: 'DeepSeek',
}

const MODELS: Record<string, string[]> = {
  siliconflow: [
    'DeepSeek-V3',
    'Qwen-Turbo',
    'Qwen-QwQ-32B',
    'Qwen-VL-Max',
    'Qwen2.5-72B-Instruct',
    'deepseek-chat',
    'gpt-4o-mini',
    'gpt-4o',
    'BAAI/bge-large-zh-v1.5',
    'BAAI/bge-reranker-large',
  ],
  deepseek: [
    'deepseek-chat',
    'deepseek-reasoner',
  ],
}

const DEFAULT_MATRIX: TaskModelEntry[] = [
  {
    taskId: 'intent',
    label: '意图识别',
    description: '查询理解、改写与检索策略决策',
    provider: 'siliconflow',
    model: 'Qwen-Turbo',
  },
  {
    taskId: 'caption',
    label: '图像理解',
    description: '图像描述与多模态理解',
    provider: 'siliconflow',
    model: 'Qwen-VL-Max',
  },
  {
    taskId: 'generation',
    label: '回答生成',
    description: '最终回答生成与流式输出',
    provider: 'siliconflow',
    model: 'DeepSeek-V3',
  },
]

const DEFAULT_RERANK = {
  provider: 'siliconflow',
  model: 'BAAI/bge-reranker-large',
}

/** 任务类型图标与色条（意图 / 图像 / 生成） */
const TASK_META: Record<Exclude<TaskId, 'rerank'>, { icon: React.ComponentType<{ className?: string }>; barClass: string; isPrimary?: boolean }> = {
  intent: { icon: Brain, barClass: 'bg-blue-400/80 dark:bg-blue-500/80', isPrimary: false },
  caption: { icon: Image, barClass: 'bg-violet-400/80 dark:bg-violet-500/80', isPrimary: false },
  generation: { icon: MessageSquare, barClass: 'bg-indigo-500 dark:bg-indigo-400', isPrimary: true },
}

interface ModelConfigProps {
  onSave?: (config: {
    taskMatrix: TaskModelEntry[]
    reranker: { provider: string; model: string }
  }) => void | Promise<void>
  initialConfig?: {
    taskMatrix?: TaskModelEntry[]
    reranker?: { provider: string; model: string }
  }
  availableModels?: AvailableModels
  onHasChangesChange?: (hasChanges: boolean) => void
  className?: string
}

export function ModelConfig({
  onSave,
  initialConfig,
  availableModels,
  onHasChangesChange,
  className,
}: ModelConfigProps) {
  const [matrix, setMatrix] = useState<TaskModelEntry[]>(
    initialConfig?.taskMatrix ?? DEFAULT_MATRIX
  )
  const [reranker, setReranker] = useState(
    initialConfig?.reranker ?? DEFAULT_RERANK
  )
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedBrief, setSavedBrief] = useState(false)
  const { showSuccess, showError } = useToastStore()

  useEffect(() => {
    if (initialConfig?.taskMatrix) setMatrix(initialConfig.taskMatrix)
    if (initialConfig?.reranker) setReranker(initialConfig.reranker)
  }, [initialConfig?.taskMatrix, initialConfig?.reranker])

  useEffect(() => {
    onHasChangesChange?.(hasChanges)
  }, [hasChanges, onHasChangesChange])

  const updateTask = (taskId: TaskId, field: 'provider' | 'model', value: string) => {
    setMatrix((prev) =>
      prev.map((t) => {
        if (t.taskId !== taskId) return t
        if (field === 'provider') {
          const typeKey = t.taskId === 'caption' ? 'vision' : 'chat'
          // 切换 provider 时，不传入当前模型，直接获取新 provider 的模型列表
          const list = modelList(value, typeKey)
          // 如果当前模型在新列表中，保留；否则选择新列表的第一个
          const validModel = list.includes(t.model) ? t.model : (list[0] || t.model)
          return { ...t, provider: value, model: validModel }
        }
        return { ...t, [field]: value }
      })
    )
    setHasChanges(true)
  }

  const updateReranker = (field: 'provider' | 'model', value: string) => {
    setReranker((prev) => {
      if (field === 'provider') {
        // 切换 provider 时，不传入当前模型，直接获取新 provider 的模型列表
        const list = modelList(value, 'reranker')
        // 如果当前模型在新列表中，保留；否则选择新列表的第一个
        const validModel = list.includes(prev.model) ? prev.model : (list[0] || prev.model)
        return { ...prev, provider: value, model: validModel }
      }
      return { ...prev, [field]: value }
    })
    setHasChanges(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setSavedBrief(false)
    try {
      await onSave?.({ taskMatrix: matrix, reranker })
      setHasChanges(false)
      showSuccess('配置已保存')
      setSavedBrief(true)
      setTimeout(() => setSavedBrief(false), 2000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败'
      showError(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!window.confirm('将恢复为上次保存的配置，是否继续？')) return
    setMatrix(initialConfig?.taskMatrix ?? DEFAULT_MATRIX)
    setReranker(initialConfig?.reranker ?? DEFAULT_RERANK)
    setHasChanges(false)
  }

  const apiProviders = availableModels?.providers
  const baseProviders: string[] =
    apiProviders && apiProviders.length > 0 ? apiProviders : ['siliconflow', 'deepseek']
  const allProviderValues = new Set(baseProviders)
  matrix.forEach((t) => allProviderValues.add(t.provider))
  allProviderValues.add(reranker.provider)
  const providerOptions = Array.from(allProviderValues)
  const modelList = (p: string, taskType?: 'chat' | 'vision' | 'reranker', currentModel?: string) => {
    const typeKey = taskType === 'vision' ? 'vision' : taskType === 'reranker' ? 'reranker' : 'chat'
    const byProvider = availableModels?.models_by_provider?.[p]?.[typeKey]
    if (byProvider && byProvider.length > 0) {
      const list = [...byProvider]
      if (currentModel && !list.includes(currentModel)) list.unshift(currentModel)
      return list
    }
    if (availableModels && (availableModels.chat_models?.length || availableModels.vision_models?.length || availableModels.reranker_models?.length)) {
      let list: string[]
      if (taskType === 'vision') list = availableModels.vision_models
      else if (taskType === 'reranker') list = availableModels.reranker_models
      else list = availableModels.chat_models
      if (currentModel && !list.includes(currentModel)) return [currentModel, ...list]
      return list
    }
    return MODELS[p] ?? []
  }

  const selectBase =
    'relative flex h-10 w-full min-w-0 rounded-xl border bg-white dark:bg-slate-800/50 pl-4 pr-10 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500/50 dark:focus:ring-fuchsia-500/50 cursor-pointer border-slate-200 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-fuchsia-500/50 focus:border-indigo-400 dark:focus:border-fuchsia-500 appearance-none shadow-sm hover:shadow-md'

  return (
    <div className={cn('space-y-6 animate-in fade-in duration-300', className)}>
      <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/90 shadow-lg shadow-slate-200/30 backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-950/80 dark:shadow-black/20">
        <header className="border-b border-slate-100/80 bg-gradient-to-r from-slate-50/80 via-white to-indigo-50/30 px-6 py-5 dark:border-slate-800/60 dark:from-slate-900/90 dark:via-slate-950 dark:to-indigo-950/20 sm:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/25">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <h2 className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-xl font-bold tracking-tight text-transparent dark:from-slate-50 dark:to-slate-300">
                  模块化模型配置
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm font-medium text-slate-500 dark:text-slate-400">
                  为意图识别、图像理解、回答生成与 Reranker 分别指定 Provider 与模型
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 xl:justify-end">
              {hasChanges && (
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-200/60 bg-amber-100/90 px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-800/50 dark:bg-amber-900/50 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  未保存
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border border-slate-300 text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800 disabled:opacity-40"
                disabled={!hasChanges || saving}
                onClick={handleReset}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                重置
              </Button>
              <Button
                size="sm"
                className="rounded-xl border-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 font-semibold text-white shadow-md shadow-indigo-500/25 transition-all duration-200 hover:from-indigo-500 hover:via-purple-500 hover:to-fuchsia-500 hover:shadow-lg hover:shadow-indigo-500/35 disabled:opacity-50"
                disabled={!hasChanges || saving}
                onClick={handleSave}
              >
                {saving ? (
                  <>
                    <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    保存中…
                  </>
                ) : savedBrief ? (
                  <>
                    已保存
                    <Check className="ml-2 h-4 w-4 text-emerald-200" />
                  </>
                ) : (
                  <>
                    保存
                    <Save className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </header>

        <div className="space-y-8 p-6 sm:p-8">
          <div className="rounded-2xl border border-sky-200/70 bg-gradient-to-r from-sky-50/90 to-indigo-50/60 px-4 py-3 text-sm leading-relaxed text-sky-900 shadow-sm dark:border-sky-900/50 dark:from-sky-950/30 dark:to-indigo-950/20 dark:text-sky-100">
            当前“保存”主要用于维护本浏览器侧配置与未保存状态；模型列表来自后端目录，方便按任务类型分别挑选可用模型。
          </div>

          {/* 任务 – 模型映射 */}
          <section className="animate-in slide-up duration-500">
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-flex h-10 w-1.5 rounded-full bg-gradient-to-b from-indigo-500 via-purple-500 to-fuchsia-500 shadow-sm" />
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                任务 – 模型映射
              </h3>
            </div>
            <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-50/80 to-white p-3 shadow-sm dark:border-slate-700/70 dark:from-slate-900/50 dark:to-slate-950/80 sm:p-4">
              <div className="hidden grid-cols-[minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,1fr)] gap-4 rounded-xl border border-slate-200/80 bg-slate-100/80 px-5 py-3 text-xs font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300 lg:grid">
                <div>任务</div>
                <div>Provider</div>
                <div>模型</div>
              </div>

              {matrix.map((t, i) => {
                const meta = t.taskId === 'rerank' ? null : TASK_META[t.taskId]
                const Icon = meta?.icon
                const models = t.taskId === 'caption' ? modelList(t.provider, 'vision', t.model) : modelList(t.provider, 'chat', t.model)

                return (
                  <div
                    key={t.taskId}
                    className={cn(
                      'group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm transition-all duration-200 dark:border-slate-700/70 dark:bg-slate-950/50',
                      meta?.isPrimary
                        ? 'border-indigo-200/80 bg-gradient-to-r from-indigo-50/90 to-violet-50/60 dark:border-indigo-800/60 dark:from-indigo-950/40 dark:to-violet-950/20'
                        : i % 2 === 0
                          ? 'hover:border-indigo-200/70 hover:bg-slate-50/95 dark:hover:border-indigo-800/40 dark:hover:bg-slate-900/60'
                          : 'bg-slate-50/60 hover:border-indigo-200/70 hover:bg-slate-50/95 dark:bg-slate-900/25 dark:hover:border-indigo-800/40 dark:hover:bg-slate-900/60'
                    )}
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,1fr)] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-4">
                          {Icon && (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 text-slate-600 shadow-sm transition-all duration-200 group-hover:shadow-md dark:from-slate-800 dark:to-slate-900 dark:text-slate-400">
                              <Icon className="h-5 w-5" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2.5 font-semibold text-slate-800 dark:text-slate-100">
                              <span>{t.label}</span>
                              {meta?.isPrimary && (
                                <span className="rounded-lg border border-indigo-200/50 bg-gradient-to-r from-indigo-100 to-purple-100 px-2.5 py-1 text-xs font-bold text-indigo-700 shadow-sm dark:border-indigo-800/50 dark:from-indigo-900/60 dark:to-purple-900/60 dark:text-indigo-300">
                                  主模型
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                              {t.description}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 lg:hidden">
                          Provider
                        </div>
                        <div className="relative">
                          <select
                            value={t.provider}
                            onChange={(e) => updateTask(t.taskId, 'provider', e.target.value)}
                            className={selectBase}
                            title={PROVIDER_DISPLAY_NAMES[t.provider] ?? t.provider}
                          >
                            {providerOptions.map((p) => (
                              <option key={p} value={p}>
                                {PROVIDER_DISPLAY_NAMES[p] ?? p}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 lg:hidden">
                          模型
                        </div>
                        <div className="relative">
                          <select
                            value={t.model}
                            onChange={(e) => updateTask(t.taskId, 'model', e.target.value)}
                            className={selectBase}
                            title={t.model}
                          >
                            {models.map((m) => (
                              <option key={m} value={m} title={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Reranker 模型 */}
          <section className="animate-in slide-up duration-500 delay-100">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 text-emerald-600 dark:text-emerald-400 shadow-sm border border-emerald-200/50 dark:border-emerald-800/50">
                  <ArrowDownUp className="h-5 w-5" />
                </div>
                <span className="inline-flex h-10 w-1.5 rounded-full bg-gradient-to-b from-emerald-400 via-teal-400 to-emerald-500 dark:from-emerald-500 dark:via-teal-500 dark:to-emerald-600 shadow-sm" />
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                    Reranker 模型
                  </h3>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60 shadow-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    检索结果排序用
                  </span>
                </div>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-emerald-200/50 bg-gradient-to-br from-emerald-50/50 via-white to-teal-50/30 p-6 shadow-sm dark:border-emerald-800/40 dark:from-emerald-950/30 dark:via-slate-950/80 dark:to-teal-950/20">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="min-w-0 space-y-2.5">
                  <Label className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                    Provider
                  </Label>
                  <div className="relative">
                    <select
                      value={reranker.provider}
                      onChange={(e) => updateReranker('provider', e.target.value)}
                      className={cn(selectBase, 'border-emerald-200/60 dark:border-emerald-800/60 hover:border-emerald-300 dark:hover:border-emerald-700/60 focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-emerald-500/50 dark:focus:ring-emerald-500/50')}
                      title={PROVIDER_DISPLAY_NAMES[reranker.provider] ?? reranker.provider}
                    >
                      {providerOptions.map((p) => (
                        <option key={p} value={p}>
                          {PROVIDER_DISPLAY_NAMES[p] ?? p}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div className="min-w-0 space-y-2.5">
                  <Label className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                    模型
                  </Label>
                  <div className="relative">
                    <select
                      value={reranker.model}
                      onChange={(e) => updateReranker('model', e.target.value)}
                      className={cn(selectBase, 'border-emerald-200/60 dark:border-emerald-800/60 hover:border-emerald-300 dark:hover:border-emerald-700/60 focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-emerald-500/50 dark:focus:ring-emerald-500/50')}
                      title={reranker.model}
                    >
                      {modelList(reranker.provider, 'reranker', reranker.model).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default ModelConfig
