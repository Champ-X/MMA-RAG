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
  provider: 'siliconflow' | 'openai'
  model: string
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
  openai: [
    'gpt-4',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
    'gpt-4o',
    'gpt-4o-mini',
    'text-embedding-3-large',
    'text-embedding-3-small',
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
  provider: 'siliconflow' as const,
  model: 'BAAI/bge-reranker-large',
}

interface ModelConfigProps {
  onSave?: (config: {
    taskMatrix: TaskModelEntry[]
    reranker: { provider: 'siliconflow' | 'openai'; model: string }
  }) => void | Promise<void>
  initialConfig?: {
    taskMatrix?: TaskModelEntry[]
    reranker?: { provider: 'siliconflow' | 'openai'; model: string }
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
      prev.map((t) =>
        t.taskId === taskId ? { ...t, [field]: value } : t
      )
    )
    setHasChanges(true)
  }

  const updateReranker = (field: 'provider' | 'model', value: string) => {
    setReranker((prev) => ({ ...prev, [field]: value }))
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

  const providerOptions: Array<'siliconflow' | 'openai'> = [
    'siliconflow',
    'openai',
  ]
  const modelList = (p: string, taskType?: 'chat' | 'vision' | 'reranker', currentModel?: string) => {
    let list: string[]
    if (availableModels && (availableModels.chat_models?.length || availableModels.vision_models?.length || availableModels.reranker_models?.length)) {
      if (taskType === 'vision') list = availableModels.vision_models
      else if (taskType === 'reranker') list = availableModels.reranker_models
      else list = availableModels.chat_models
      if (currentModel && !list.includes(currentModel)) return [currentModel, ...list]
      return list
    }
    return MODELS[p] ?? []
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-tr from-indigo-50 to-fuchsia-50 dark:from-indigo-600/25 dark:to-fuchsia-600/15 text-indigo-600 dark:text-indigo-200 rounded-lg">
                <Settings className="h-4 w-4" />
              </div>
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">模块化模型配置</h2>
            </div>
            <div className="flex items-center gap-2">
              {hasChanges && (
                <span className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                  未保存
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                disabled={!hasChanges || saving}
                onClick={handleReset}
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                重置
              </Button>
              <Button
                size="sm"
                className="bg-gradient-to-tr from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white border-0"
                disabled={!hasChanges || saving}
                onClick={handleSave}
              >
                {saving ? '保存中…' : '保存'}
                <Save className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <h3 className="mb-3 font-medium text-slate-800 dark:text-slate-100">任务 – 模型映射</h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                    <th className="px-4 py-3 text-left font-medium text-slate-700 dark:text-slate-200">任务</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-700 dark:text-slate-200">Provider</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-700 dark:text-slate-200">模型</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((t) => (
                    <tr key={t.taskId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 dark:text-slate-100">{t.label}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {t.description}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={t.provider}
                          onChange={(e) =>
                            updateTask(t.taskId, 'provider', e.target.value)
                          }
                          className={cn(
                            'flex h-10 w-[140px] rounded-lg border border-slate-300 dark:border-slate-700',
                            'bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100',
                            'focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-fuchsia-500'
                          )}
                        >
                          {providerOptions.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={t.model}
                          onChange={(e) =>
                            updateTask(t.taskId, 'model', e.target.value)
                          }
                          className={cn(
                            'flex h-10 min-w-[180px] rounded-lg border border-slate-300 dark:border-slate-700',
                            'bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100',
                            'focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-fuchsia-500'
                          )}
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
          </div>

          <div>
            <h3 className="mb-3 font-medium text-slate-800 dark:text-slate-100">Reranker 模型</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-slate-200">Provider</Label>
                <select
                  value={reranker.provider}
                  onChange={(e) => updateReranker('provider', e.target.value)}
                  className={cn(
                    'flex h-10 w-[140px] rounded-lg border border-slate-300 dark:border-slate-700',
                    'bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100',
                    'focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-fuchsia-500'
                  )}
                >
                  {providerOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-slate-200">模型</Label>
                <select
                  value={reranker.model}
                  onChange={(e) => updateReranker('model', e.target.value)}
                  className={cn(
                    'flex h-10 min-w-[200px] rounded-lg border border-slate-300 dark:border-slate-700',
                    'bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100',
                    'focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-fuchsia-500'
                  )}
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
        </div>
      </div>
    </div>
  )
}

export default ModelConfig
