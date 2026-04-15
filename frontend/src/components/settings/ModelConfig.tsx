import { useState, useEffect, type ComponentType } from 'react'
import { Save, RotateCcw, Settings, AlertCircle, Brain, Image, MessageSquare, ArrowDownUp, Check, ChevronDown, Route, Mic, Film, BookText } from 'lucide-react'
import { useToastStore } from '@/store/useToastStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { AvailableModels, AvailableModelType } from '@/store/useConfigStore'

export type TaskId =
  | 'intent'
  | 'rewrite'
  | 'caption'
  | 'audio'
  | 'video'
  | 'portrait'
  | 'generation'

export interface TaskModelEntry {
  taskId: TaskId
  label: string
  description: string
  category: AvailableModelType
  provider: string
  model: string
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  siliconflow: 'SiliconFlow',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  aliyun_bailian: '阿里云百炼',
}

const FALLBACK_MODELS: Record<string, Partial<Record<AvailableModelType, string[]>>> = {
  siliconflow: {
    chat: ['Qwen/Qwen3-235B-A22B-Instruct-2507', 'Pro/moonshotai/Kimi-K2.5'],
    embedding: ['Qwen/Qwen3-Embedding-8B'],
    vision: ['Qwen/Qwen3-VL-30B-A3B-Instruct'],
    reranker: ['Qwen/Qwen3-Reranker-8B'],
    video: ['Qwen/Qwen3.5-397B-A17B'],
  },
  deepseek: {
    chat: ['deepseek-chat', 'deepseek-reasoner'],
  },
  openrouter: {
    chat: ['openrouter:google/gemini-2.5-flash'],
    vision: ['openrouter:google/gemini-2.5-flash'],
    audio: ['openrouter:google/gemini-2.5-flash'],
    video: ['openrouter:google/gemini-2.5-flash'],
  },
  aliyun_bailian: {
    chat: ['aliyun_bailian:qwen3-max'],
    vision: ['aliyun_bailian:qwen3-vl-plus'],
    reranker: ['aliyun_bailian:qwen3-rerank'],
    audio: ['aliyun_bailian:qwen3-omni-flash'],
    video: ['aliyun_bailian:qwen3.5-plus-2026-02-15'],
  },
}

const DEFAULT_MATRIX: TaskModelEntry[] = [
  {
    taskId: 'intent',
    label: '意图识别',
    description: '查询理解与检索策略决策',
    category: 'chat',
    provider: 'aliyun_bailian',
    model: 'aliyun_bailian:qwen3-max',
  },
  {
    taskId: 'rewrite',
    label: '查询改写',
    description: '补全检索表达、扩展召回线索',
    category: 'chat',
    provider: 'aliyun_bailian',
    model: 'aliyun_bailian:qwen3.5-flash',
  },
  {
    taskId: 'caption',
    label: '图像描述',
    description: '图像内容理解与描述生成',
    category: 'vision',
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
  },
  {
    taskId: 'audio',
    label: '音频转写',
    description: '语音/音频理解与转写',
    category: 'audio',
    provider: 'aliyun_bailian',
    model: 'aliyun_bailian:qwen3-omni-flash',
  },
  {
    taskId: 'video',
    label: '视频解析',
    description: '视频场景切分与多模态摘要',
    category: 'video',
    provider: 'aliyun_bailian',
    model: 'aliyun_bailian:qwen3.5-plus-2026-02-15',
  },
  {
    taskId: 'portrait',
    label: '知识库画像',
    description: '主题画像与摘要生成',
    category: 'chat',
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  },
  {
    taskId: 'generation',
    label: '回答生成',
    description: '最终回答生成与流式输出',
    category: 'chat',
    provider: 'siliconflow',
    model: 'Pro/moonshotai/Kimi-K2.5',
  },
]

const DEFAULT_RERANK = {
  provider: 'siliconflow',
  model: 'Qwen/Qwen3-Reranker-8B',
}

const TASK_META: Record<TaskId, { icon: ComponentType<{ className?: string }>; barClass: string; isPrimary?: boolean }> = {
  intent: { icon: Brain, barClass: 'bg-blue-400/80 dark:bg-blue-500/80' },
  rewrite: { icon: Route, barClass: 'bg-cyan-400/80 dark:bg-cyan-500/80' },
  caption: { icon: Image, barClass: 'bg-violet-400/80 dark:bg-violet-500/80' },
  audio: { icon: Mic, barClass: 'bg-amber-400/80 dark:bg-amber-500/80' },
  video: { icon: Film, barClass: 'bg-rose-400/80 dark:bg-rose-500/80' },
  portrait: { icon: BookText, barClass: 'bg-emerald-400/80 dark:bg-emerald-500/80' },
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
  const [matrix, setMatrix] = useState<TaskModelEntry[]>(initialConfig?.taskMatrix ?? DEFAULT_MATRIX)
  const [reranker, setReranker] = useState(initialConfig?.reranker ?? DEFAULT_RERANK)
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedBrief, setSavedBrief] = useState(false)
  const { showSuccess, showError } = useToastStore()

  const providerList = (category: AvailableModelType) => {
    if (availableModels?.models_by_provider && Object.keys(availableModels.models_by_provider).length > 0) {
      return Object.entries(availableModels.models_by_provider)
        .filter(([, models]) => (models?.[category] ?? []).length > 0)
        .map(([provider]) => provider)
    }
    return Object.entries(FALLBACK_MODELS)
      .filter(([, categories]) => (categories?.[category] ?? []).length > 0)
      .map(([provider]) => provider)
  }

  const modelList = (provider: string, category: AvailableModelType) => {
    if (availableModels?.models_by_provider && Object.keys(availableModels.models_by_provider).length > 0) {
      return [...(availableModels.models_by_provider[provider]?.[category] ?? [])]
    }
    return [...(FALLBACK_MODELS[provider]?.[category] ?? [])]
  }

  const normalizeSelection = <T extends { provider: string; model: string }>(entry: T, category: AvailableModelType): T => {
    const providers = providerList(category)
    if (providers.length === 0) {
      return { ...entry, provider: '', model: '' } as T
    }
    const nextProvider = providers.includes(entry.provider) ? entry.provider : providers[0]
    const models = modelList(nextProvider, category)
    return {
      ...entry,
      provider: nextProvider,
      model: models.includes(entry.model) ? entry.model : (models[0] ?? ''),
    } as T
  }

  useEffect(() => {
    if (initialConfig?.taskMatrix) setMatrix(initialConfig.taskMatrix)
    if (initialConfig?.reranker) setReranker(initialConfig.reranker)
  }, [initialConfig?.taskMatrix, initialConfig?.reranker])

  useEffect(() => {
    onHasChangesChange?.(hasChanges)
  }, [hasChanges, onHasChangesChange])

  useEffect(() => {
    setMatrix((prev) => {
      const next = prev.map((entry) => normalizeSelection(entry, entry.category))
      const changed = next.some((entry, index) => entry.provider !== prev[index]?.provider || entry.model !== prev[index]?.model)
      return changed ? next : prev
    })
    setReranker((prev) => {
      const next = normalizeSelection(prev, 'reranker')
      return next.provider !== prev.provider || next.model !== prev.model ? next : prev
    })
  }, [availableModels])

  const updateTask = (taskId: TaskId, field: 'provider' | 'model', value: string) => {
    setMatrix((prev) =>
      prev.map((task) => {
        if (task.taskId !== taskId) return task
        if (field === 'provider') {
          const nextModels = modelList(value, task.category)
          const nextModel = nextModels.includes(task.model) ? task.model : (nextModels[0] ?? '')
          return { ...task, provider: value, model: nextModel }
        }
        return { ...task, [field]: value }
      })
    )
    setHasChanges(true)
  }

  const updateReranker = (field: 'provider' | 'model', value: string) => {
    setReranker((prev) => {
      if (field === 'provider') {
        const nextModels = modelList(value, 'reranker')
        const nextModel = nextModels.includes(prev.model) ? prev.model : (nextModels[0] ?? '')
        return { ...prev, provider: value, model: nextModel }
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

  const rerankerProviders = providerList('reranker')
  const rerankerModels = reranker.provider ? modelList(reranker.provider, 'reranker') : []

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
                  为各个链路步骤分别指定 Provider 与模型，保存后新的后端请求会立即使用最新配置
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
            模型列表完全来自后端当前已注册的 Provider；未配置 API Key 的模型不会出现在这里，保存后会直接更新运行中的任务路由。
          </div>

          <section className="animate-in slide-up duration-500">
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-flex h-10 w-1.5 rounded-full bg-gradient-to-b from-indigo-500 via-purple-500 to-fuchsia-500 shadow-sm" />
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                任务 - 模型映射
              </h3>
            </div>
            <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-50/80 to-white p-3 shadow-sm dark:border-slate-700/70 dark:from-slate-900/50 dark:to-slate-950/80 sm:p-4">
              <div className="hidden grid-cols-[minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,1fr)] gap-4 rounded-xl border border-slate-200/80 bg-slate-100/80 px-5 py-3 text-xs font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300 lg:grid">
                <div>任务</div>
                <div>Provider</div>
                <div>模型</div>
              </div>

              {matrix.map((task, index) => {
                const meta = TASK_META[task.taskId]
                const Icon = meta.icon
                const providers = providerList(task.category)
                const models = task.provider ? modelList(task.provider, task.category) : []

                return (
                  <div
                    key={task.taskId}
                    className={cn(
                      'group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm transition-all duration-200 dark:border-slate-700/70 dark:bg-slate-950/50',
                      meta.isPrimary
                        ? 'border-indigo-200/80 bg-gradient-to-r from-indigo-50/90 to-violet-50/60 dark:border-indigo-800/60 dark:from-indigo-950/40 dark:to-violet-950/20'
                        : index % 2 === 0
                          ? 'hover:border-indigo-200/70 hover:bg-slate-50/95 dark:hover:border-indigo-800/40 dark:hover:bg-slate-900/60'
                          : 'bg-slate-50/60 hover:border-indigo-200/70 hover:bg-slate-50/95 dark:bg-slate-900/25 dark:hover:border-indigo-800/40 dark:hover:bg-slate-900/60'
                    )}
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,1fr)] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-4">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 text-slate-600 shadow-sm transition-all duration-200 group-hover:shadow-md dark:from-slate-800 dark:to-slate-900 dark:text-slate-400">
                            <Icon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2.5 font-semibold text-slate-800 dark:text-slate-100">
                              <span>{task.label}</span>
                              {meta.isPrimary && (
                                <span className="rounded-lg border border-indigo-200/50 bg-gradient-to-r from-indigo-100 to-purple-100 px-2.5 py-1 text-xs font-bold text-indigo-700 shadow-sm dark:border-indigo-800/50 dark:from-indigo-900/60 dark:to-purple-900/60 dark:text-indigo-300">
                                  主模型
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                              {task.description}
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
                            value={task.provider}
                            onChange={(e) => updateTask(task.taskId, 'provider', e.target.value)}
                            className={selectBase}
                            title={task.provider || '当前无可用 Provider'}
                            disabled={providers.length === 0}
                          >
                            {providers.length === 0 && <option value="">当前无可用 Provider</option>}
                            {providers.map((provider) => (
                              <option key={provider} value={provider}>
                                {PROVIDER_DISPLAY_NAMES[provider] ?? provider}
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
                            value={task.model}
                            onChange={(e) => updateTask(task.taskId, 'model', e.target.value)}
                            className={selectBase}
                            title={task.model || '当前无可用模型'}
                            disabled={models.length === 0}
                          >
                            {models.length === 0 && <option value="">当前无可用模型</option>}
                            {models.map((model) => (
                              <option key={model} value={model} title={model}>
                                {model}
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

          <section className="animate-in slide-up duration-500 delay-100">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600 shadow-sm border border-emerald-200/50 dark:from-emerald-900/40 dark:to-teal-900/40 dark:text-emerald-400 dark:border-emerald-800/50">
                  <ArrowDownUp className="h-5 w-5" />
                </div>
                <span className="inline-flex h-10 w-1.5 rounded-full bg-gradient-to-b from-emerald-400 via-teal-400 to-emerald-500 shadow-sm dark:from-emerald-500 dark:via-teal-500 dark:to-emerald-600" />
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                    Reranker 模型
                  </h3>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200/60 shadow-sm dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-300 dark:border-emerald-800/60">
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
                      title={reranker.provider || '当前无可用 Provider'}
                      disabled={rerankerProviders.length === 0}
                    >
                      {rerankerProviders.length === 0 && <option value="">当前无可用 Provider</option>}
                      {rerankerProviders.map((provider) => (
                        <option key={provider} value={provider}>
                          {PROVIDER_DISPLAY_NAMES[provider] ?? provider}
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
                      title={reranker.model || '当前无可用模型'}
                      disabled={rerankerModels.length === 0}
                    >
                      {rerankerModels.length === 0 && <option value="">当前无可用模型</option>}
                      {rerankerModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
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
