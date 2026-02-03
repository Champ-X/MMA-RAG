import { useEffect } from 'react'
import { ModelConfig, type TaskModelEntry } from '@/components/settings/ModelConfig'
import { useConfigStore } from '@/store/useConfigStore'

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
  const { config, availableModels, loadConfig, saveConfig, updateModelConfig } = useConfigStore()

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const initialConfig = configToTaskMatrix(config)

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

  return (
    <div className="p-6 mx-auto max-w-4xl">
      <ModelConfig
        initialConfig={initialConfig}
        availableModels={availableModels}
        onSave={handleSave}
      />
    </div>
  )
}
