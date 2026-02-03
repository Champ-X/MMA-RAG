import { useState, useEffect } from 'react'
import { Save, RotateCcw, Settings, AlertCircle } from 'lucide-react'
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
  className?: string
}

export function ModelConfig({
  onSave,
  initialConfig,
  availableModels,
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

  useEffect(() => {
    if (initialConfig?.taskMatrix) setMatrix(initialConfig.taskMatrix)
    if (initialConfig?.reranker) setReranker(initialConfig.reranker)
  }, [initialConfig?.taskMatrix, initialConfig?.reranker])

  const updateTask = (taskId: TaskId, field: 'provider' | 'model', value: string) => {
    setMatrix((prev) =>
      prev.map((t) => {
        if (t.taskId !== taskId) return t
        if (field === 'provider') {
          const typeKey = t.taskId === 'caption' ? 'vision' : 'chat'
          const list = modelList(value, typeKey, t.model)
          const validModel = list.includes(t.model) ? t.model : list[0] ?? t.model
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
        const list = modelList(value, 'reranker', prev.model)
        const validModel = list.includes(prev.model) ? prev.model : list[0] ?? prev.model
        return { ...prev, provider: value, model: validModel }
      }
      return { ...prev, [field]: value }
    })
    setHasChanges(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave?.({ taskMatrix: matrix, reranker })
      setHasChanges(false)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
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
    'flex h-10 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 pl-4 pr-10 py-2 text-sm text-slate-800 dark:text-slate-100 transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 dark:focus:ring-fuchsia-500/50 focus:border-indigo-400 dark:focus:border-fuchsia-500 hover:border-slate-300 dark:hover:border-slate-500 cursor-pointer'

  return (
    <div className={cn('space-y-6', className)}>
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-950 shadow-lg shadow-slate-200/50 dark:shadow-slate-900/50">
        {/* 顶部装饰条 */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-indigo-500 opacity-90" />

        <header className="relative px-6 py-5 border-b border-slate-100 dark:border-slate-800/80 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 dark:from-slate-900/80 dark:via-slate-950 dark:to-indigo-950/20">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/25 transition-transform hover:scale-105">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-100">
                  模块化模型配置
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  为各任务与 Reranker 指定 Provider 与模型
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {hasChanges && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  未保存
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                disabled={!hasChanges || saving}
                onClick={handleReset}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                重置
              </Button>
              <Button
                size="sm"
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white shadow-md shadow-indigo-500/30 border-0 transition-all hover:shadow-lg hover:shadow-indigo-500/25"
                disabled={!hasChanges || saving}
                onClick={handleSave}
              >
                {saving ? '保存中…' : '保存'}
                <Save className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <div className="p-6 space-y-8">
          {/* 任务 – 模型映射 */}
          <section>
            <div className="mb-4 flex items-center gap-2">
              <span className="inline-flex h-8 w-1 rounded-full bg-gradient-to-b from-indigo-500 to-fuchsia-500" />
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                任务 – 模型映射
              </h3>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-900/30 shadow-inner">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/50">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      任务
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Provider
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      模型
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((t, i) => (
                    <tr
                      key={t.taskId}
                      className={cn(
                        'border-b border-slate-100 dark:border-slate-800/80 last:border-0 transition-colors',
                        i % 2 === 0
                          ? 'bg-white dark:bg-slate-950/50'
                          : 'bg-slate-50/80 dark:bg-slate-900/30',
                        'hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20'
                      )}
                    >
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-800 dark:text-slate-100">
                          {t.label}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {t.description}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <select
                          value={t.provider}
                          onChange={(e) =>
                            updateTask(t.taskId, 'provider', e.target.value)
                          }
                          className={cn(selectBase, 'min-w-[10rem] w-[10rem] border-slate-300 dark:border-slate-600')}
                          title={PROVIDER_DISPLAY_NAMES[t.provider] ?? t.provider}
                        >
                          {providerOptions.map((p) => (
                            <option key={p} value={p}>
                              {PROVIDER_DISPLAY_NAMES[p] ?? p}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <select
                          value={t.model}
                          onChange={(e) =>
                            updateTask(t.taskId, 'model', e.target.value)
                          }
                          className={cn(selectBase, 'min-w-[200px] border-slate-300 dark:border-slate-600')}
                        >
                          {(t.taskId === 'caption' ? modelList(t.provider, 'vision', t.model) : modelList(t.provider, 'chat', t.model)).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Reranker 模型 */}
          <section>
            <div className="mb-4 flex items-center gap-2">
              <span className="inline-flex h-8 w-1 rounded-full bg-gradient-to-b from-indigo-500 to-fuchsia-500" />
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                Reranker 模型
              </h3>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-900/30 p-5 shadow-inner">
              <div className="flex flex-wrap items-end gap-6">
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Provider
                  </Label>
                  <select
                    value={reranker.provider}
                    onChange={(e) => updateReranker('provider', e.target.value)}
                    className={cn(selectBase, 'min-w-[10rem] w-[10rem] border-slate-300 dark:border-slate-600')}
                    title={PROVIDER_DISPLAY_NAMES[reranker.provider] ?? reranker.provider}
                  >
                    {providerOptions.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_DISPLAY_NAMES[p] ?? p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    模型
                  </Label>
                  <select
                    value={reranker.model}
                    onChange={(e) => updateReranker('model', e.target.value)}
                    className={cn(selectBase, 'min-w-[220px] border-slate-300 dark:border-slate-600')}
                  >
                    {modelList(reranker.provider, 'reranker', reranker.model).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
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
