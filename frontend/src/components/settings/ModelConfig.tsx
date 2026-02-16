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
    label: 'Intent Recognition',
    description: '意图识别与查询改写',
    provider: 'siliconflow',
    model: 'Qwen-Turbo',
  },
  {
    taskId: 'caption',
    label: 'Image Captioning',
    description: '图像描述与多模态理解',
    provider: 'siliconflow',
    model: 'Qwen-VL-Max',
  },
  {
    taskId: 'generation',
    label: 'Final Generation',
    description: '最终回答生成',
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
    'relative flex h-10 rounded-xl border-2 bg-white dark:bg-slate-800/50 pl-4 pr-10 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500/50 dark:focus:ring-fuchsia-500/50 cursor-pointer border-slate-200 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-fuchsia-500/50 focus:border-indigo-400 dark:focus:border-fuchsia-500 appearance-none shadow-sm hover:shadow-md'

  return (
    <div className={cn('space-y-6 animate-in fade-in duration-300', className)}>
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 shadow-xl shadow-slate-200/40 dark:shadow-slate-900/60 backdrop-blur-sm">
        {/* 顶部装饰条 - 更精致的渐变 */}
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 via-fuchsia-500 to-indigo-500 opacity-90 animate-pulse-soft" />

        <header className="relative px-8 py-6 border-b border-slate-100/80 dark:border-slate-800/60 bg-gradient-to-br from-slate-50/80 via-white to-indigo-50/40 dark:from-slate-900/90 dark:via-slate-950 dark:to-indigo-950/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30 transition-all duration-300 hover:scale-110 hover:shadow-xl hover:shadow-indigo-500/40 group">
                <Settings className="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 bg-gradient-to-r from-slate-900 to-slate-700 dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                  模块化模型配置
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
                  为各任务与 Reranker 指定 Provider 与模型
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {hasChanges && (
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-100/90 dark:bg-amber-900/50 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 shadow-sm animate-pulse-soft border border-amber-200/50 dark:border-amber-800/50">
                  <AlertCircle className="h-3.5 w-3.5 animate-pulse" />
                  未保存
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500 transition-all duration-200 font-medium shadow-sm hover:shadow-md disabled:opacity-40"
                disabled={!hasChanges || saving}
                onClick={handleReset}
              >
                <RotateCcw className="mr-2 h-4 w-4 transition-transform duration-200 group-hover:rotate-180" />
                重置
              </Button>
              <Button
                size="sm"
                className="rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 hover:from-indigo-500 hover:via-purple-500 hover:to-fuchsia-500 text-white shadow-lg shadow-indigo-500/40 border-0 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/50 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 font-semibold"
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

        <div className="p-8 space-y-10">
          {/* 任务 – 模型映射 */}
          <section className="animate-in slide-up duration-500">
            <div className="mb-5 flex items-center gap-3">
              <span className="inline-flex h-10 w-1.5 rounded-full bg-gradient-to-b from-indigo-500 via-purple-500 to-fuchsia-500 shadow-sm" />
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                任务 – 模型映射
              </h3>
            </div>
            <div className="overflow-hidden rounded-2xl border-2 border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-br from-slate-50/80 to-white dark:from-slate-900/50 dark:to-slate-950/80 shadow-inner backdrop-blur-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200/80 dark:border-slate-700/80 bg-gradient-to-r from-slate-100/90 to-slate-50/90 dark:from-slate-800/80 dark:to-slate-900/80">
                    <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">
                      任务
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">
                      Provider
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">
                      模型
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((t, i) => {
                    const meta = t.taskId === 'rerank' ? null : TASK_META[t.taskId]
                    const Icon = meta?.icon
                    return (
                      <tr
                        key={t.taskId}
                        className={cn(
                          'border-b border-slate-100/60 dark:border-slate-800/60 last:border-0 transition-all duration-200 border-l-4 group',
                          meta?.barClass,
                          meta?.isPrimary
                            ? 'bg-gradient-to-r from-indigo-50/80 to-indigo-50/40 dark:from-indigo-950/40 dark:to-indigo-950/20 shadow-sm'
                            : i % 2 === 0
                            ? 'bg-white/60 dark:bg-slate-950/40'
                            : 'bg-slate-50/40 dark:bg-slate-900/20',
                          meta?.isPrimary
                            ? 'hover:bg-gradient-to-r hover:from-indigo-50 hover:to-indigo-50/60 dark:hover:from-indigo-950/50 dark:hover:to-indigo-950/30'
                            : 'hover:bg-indigo-50/50 dark:hover:bg-indigo-950/15'
                        )}
                      >
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-4">
                            {Icon && (
                              <span className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 text-slate-600 dark:text-slate-400 shadow-sm group-hover:shadow-md transition-all duration-200 group-hover:scale-110">
                                <Icon className="h-5 w-5" />
                              </span>
                            )}
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-2.5 font-semibold text-slate-800 dark:text-slate-100">
                                <span className="truncate">{t.label}</span>
                                {meta?.isPrimary && (
                                  <span className="flex-shrink-0 rounded-lg bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/60 dark:to-purple-900/60 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:text-indigo-300 shadow-sm border border-indigo-200/50 dark:border-indigo-800/50">
                                    主模型
                                  </span>
                                )}
                              </div>
                              <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 truncate font-medium">
                                {t.description}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="relative">
                            <select
                              value={t.provider}
                              onChange={(e) =>
                                updateTask(t.taskId, 'provider', e.target.value)
                              }
                              className={cn(selectBase, 'min-w-[11rem] w-[11rem]')}
                              title={PROVIDER_DISPLAY_NAMES[t.provider] ?? t.provider}
                            >
                              {providerOptions.map((p) => (
                                <option key={p} value={p}>
                                  {PROVIDER_DISPLAY_NAMES[p] ?? p}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 dark:text-slate-400 pointer-events-none transition-transform duration-200 group-hover:translate-y-[-2px]" />
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="relative">
                            <select
                              value={t.model}
                              onChange={(e) =>
                                updateTask(t.taskId, 'model', e.target.value)
                              }
                              className={cn(selectBase, 'min-w-[320px] w-full max-w-[400px]')}
                              title={t.model}
                            >
                            {(t.taskId === 'caption' ? modelList(t.provider, 'vision', t.model) : modelList(t.provider, 'chat', t.model)).map((m) => (
                              <option key={m} value={m} title={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 dark:text-slate-400 pointer-events-none transition-transform duration-200 group-hover:translate-y-[-2px]" />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Reranker 模型 */}
          <section className="animate-in slide-up duration-500 delay-100">
            <div className="mb-5 flex items-center gap-3">
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
            <div className="overflow-hidden rounded-2xl border-2 border-emerald-200/40 dark:border-emerald-800/40 bg-gradient-to-br from-emerald-50/50 via-white to-teal-50/30 dark:from-emerald-950/30 dark:via-slate-950/80 dark:to-teal-950/20 p-6 shadow-inner backdrop-blur-sm ring-1 ring-emerald-100/50 dark:ring-emerald-900/30">
              <div className="flex flex-wrap items-end gap-6">
                <div className="space-y-2.5 flex-1 min-w-[11rem]">
                  <Label className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                    Provider
                  </Label>
                  <div className="relative">
                    <select
                      value={reranker.provider}
                      onChange={(e) => updateReranker('provider', e.target.value)}
                      className={cn(selectBase, 'min-w-[11rem] w-full border-emerald-200/60 dark:border-emerald-800/60 hover:border-emerald-300 dark:hover:border-emerald-700/60 focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-emerald-500/50 dark:focus:ring-emerald-500/50')}
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
                <div className="space-y-2.5 flex-1 min-w-[320px]">
                  <Label className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                    模型
                  </Label>
                  <div className="relative">
                    <select
                      value={reranker.model}
                      onChange={(e) => updateReranker('model', e.target.value)}
                      className={cn(selectBase, 'min-w-[320px] w-full max-w-[400px] border-emerald-200/60 dark:border-emerald-800/60 hover:border-emerald-300 dark:hover:border-emerald-700/60 focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-emerald-500/50 dark:focus:ring-emerald-500/50')}
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
