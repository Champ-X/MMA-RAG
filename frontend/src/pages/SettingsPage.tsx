import { useEffect, useState, useCallback } from 'react'
import { ModelConfig, type TaskModelEntry } from '@/components/settings/ModelConfig'
import { useConfigStore } from '@/store/useConfigStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertCircle } from 'lucide-react'

function configToTaskMatrix(config: { models: Array<{ id: string; model?: string; provider?: string; name?: string }> }) {
  const chat = config.models.find(m => m.id === 'chat')
  const caption = config.models.find(m => m.id === 'caption')
  const rerank = config.models.find(m => m.id === 'rerank')
  return {
    taskMatrix: [
      {
        taskId: 'intent' as const,
        label: 'Intent Recognition',
        description: '意图识别与查询改写',
        provider: chat?.provider || 'siliconflow',
        model: chat?.model || 'Qwen-Turbo',
      },
      {
        taskId: 'caption' as const,
        label: 'Image Captioning',
        description: '图像描述与多模态理解',
        provider: caption?.provider || 'siliconflow',
        model: caption?.model || 'Qwen-VL-Max',
      },
      {
        taskId: 'generation' as const,
        label: 'Final Generation',
        description: '最终回答生成',
        provider: chat?.provider || 'siliconflow',
        model: chat?.model || 'DeepSeek-V3',
      },
    ] as TaskModelEntry[],
    reranker: {
      provider: rerank?.provider || 'siliconflow',
      model: rerank?.model || 'BAAI/bge-reranker-large',
    },
  }
}

export function SettingsPage() {
  const { config, availableModels, loadConfig, saveConfig, updateModelConfig, isLoading, error, setError } = useConfigStore()
  const [settingsHasChanges, setSettingsHasChanges] = useState(false)

  // 使用 useBlocker 实现离开确认（React Router v6.4+）
  useEffect(() => {
    if (!settingsHasChanges) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '当前配置未保存，是否离开？'
      return e.returnValue
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [settingsHasChanges])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const initialConfig = configToTaskMatrix(config)
  const handleRetry = useCallback(() => {
    setError(null)
    loadConfig()
  }, [loadConfig, setError])

  const handleSave = async (data: {
    taskMatrix: TaskModelEntry[]
    reranker: { provider: string; model: string }
  }) => {
    const gen = data.taskMatrix.find(t => t.taskId === 'generation')
    const cap = data.taskMatrix.find(t => t.taskId === 'caption')
    if (gen) updateModelConfig('chat', { model: gen.model, provider: gen.provider, name: gen.label })
    if (cap) updateModelConfig('caption', { model: cap.model, provider: cap.provider, name: cap.label })
    updateModelConfig('rerank', { model: data.reranker.model, provider: data.reranker.provider, name: 'Reranker' })
    await saveConfig()
  }

  if (isLoading) {
    return (
      <ScrollArea className="h-full">
        <div className="p-6 mx-auto max-w-5xl animate-in fade-in duration-300">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">设置</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">设置 &gt; 模型配置</p>
          </div>
          <div className="rounded-3xl border-2 border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 p-8 animate-pulse shadow-xl">
            <div className="h-6 bg-gradient-to-r from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-800 rounded-lg w-1/3 mb-6" />
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800/50 dark:to-slate-900/50 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 mx-auto max-w-5xl animate-in fade-in duration-300 pb-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
            设置
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">设置 &gt; 模型配置</p>
        </div>

        {error && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border-2 border-amber-200/80 dark:border-amber-800/60 bg-gradient-to-r from-amber-50/90 to-amber-50/50 dark:from-amber-950/40 dark:to-amber-950/20 px-5 py-4 shadow-lg shadow-amber-200/20 dark:shadow-amber-900/20 animate-in slide-up duration-300">
            <div className="flex items-center gap-3 text-amber-800 dark:text-amber-200">
              <AlertCircle className="h-5 w-5 flex-shrink-0 animate-pulse" />
              <span className="text-sm font-medium">配置加载失败，当前显示为默认配置。{error}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-2 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 font-semibold shadow-sm hover:shadow-md transition-all duration-200"
              onClick={handleRetry}
            >
              重试
            </Button>
          </div>
        )}

        <ModelConfig
          initialConfig={initialConfig}
          availableModels={availableModels}
          onSave={handleSave}
          onHasChangesChange={setSettingsHasChanges}
        />
      </div>
    </ScrollArea>
  )
}
