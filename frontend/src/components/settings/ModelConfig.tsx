import { useState } from 'react'
import { Save, RotateCcw, Settings, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

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
  className?: string
}

export function ModelConfig({
  onSave,
  initialConfig,
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
  const modelList = (p: string) => MODELS[p] ?? []

  return (
    <div className={cn('space-y-6', className)}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              <CardTitle>模块化模型配置</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {hasChanges && (
                <span className="flex items-center gap-1 text-sm text-amber-600">
                  <AlertCircle className="h-4 w-4" />
                  未保存
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!hasChanges || saving}
                onClick={handleReset}
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                重置
              </Button>
              <Button
                size="sm"
                disabled={!hasChanges || saving}
                onClick={handleSave}
              >
                {saving ? '保存中…' : '保存'}
                <Save className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="mb-3 font-medium">任务 – 模型映射</h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">任务</th>
                    <th className="px-4 py-3 text-left font-medium">Provider</th>
                    <th className="px-4 py-3 text-left font-medium">模型</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((t) => (
                    <tr key={t.taskId} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium">{t.label}</div>
                        <div className="text-xs text-muted-foreground">
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
                            'flex h-10 w-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
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
                            'flex h-10 min-w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                          )}
                        >
                          {modelList(t.provider).map((m) => (
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
            <h3 className="mb-3 font-medium">Reranker 模型</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <select
                  value={reranker.provider}
                  onChange={(e) => updateReranker('provider', e.target.value)}
                  className={cn(
                    'flex h-10 w-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
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
                <Label>模型</Label>
                <select
                  value={reranker.model}
                  onChange={(e) => updateReranker('model', e.target.value)}
                  className={cn(
                    'flex h-10 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  {modelList(reranker.provider).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ModelConfig
