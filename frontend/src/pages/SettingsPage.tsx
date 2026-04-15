import { useEffect, useState, useCallback, useMemo } from 'react'
import { ModelConfig, type TaskModelEntry } from '@/components/settings/ModelConfig'
import { useConfigStore, type SystemConfig } from '@/store/useConfigStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTheme } from '@/hooks/useTheme'
import { useToastStore } from '@/store/useToastStore'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Monitor,
  Moon,
  Palette,
  Quote,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from 'lucide-react'

const TASK_MATRIX_META = [
  {
    taskId: 'intent' as const,
    modelId: 'intent',
    label: '意图识别',
    description: '查询理解与检索策略决策',
    category: 'chat' as const,
  },
  {
    taskId: 'rewrite' as const,
    modelId: 'rewrite',
    label: '查询改写',
    description: '补全检索表达、扩展召回线索',
    category: 'chat' as const,
  },
  {
    taskId: 'caption' as const,
    modelId: 'caption',
    label: '图像描述',
    description: '图片内容理解与描述生成',
    category: 'vision' as const,
  },
  {
    taskId: 'audio' as const,
    modelId: 'audio',
    label: '音频转写',
    description: '语音/音频理解与转写',
    category: 'audio' as const,
  },
  {
    taskId: 'video' as const,
    modelId: 'video',
    label: '视频解析',
    description: '视频场景切分与多模态摘要',
    category: 'video' as const,
  },
  {
    taskId: 'portrait' as const,
    modelId: 'portrait',
    label: '知识库画像',
    description: '主题画像与摘要生成',
    category: 'chat' as const,
  },
  {
    taskId: 'generation' as const,
    modelId: 'chat',
    label: '回答生成',
    description: '最终回答生成与流式输出',
    category: 'chat' as const,
  },
]

function configToTaskMatrix(config: { models: Array<{ id: string; model?: string; provider?: string; name?: string }> }) {
  const rerank = config.models.find(m => m.id === 'rerank')
  return {
    taskMatrix: TASK_MATRIX_META.map((task) => {
      const current = config.models.find((m) => m.id === task.modelId)
      return {
        taskId: task.taskId,
        label: task.label,
        description: task.description,
        category: task.category,
        provider: current?.provider || '',
        model: current?.model || '',
      }
    }) as TaskModelEntry[],
    reranker: {
      provider: rerank?.provider || '',
      model: rerank?.model || '',
    },
  }
}

const THEME_OPTIONS: Array<{
  value: SystemConfig['theme']
  label: string
  description: string
  icon: typeof Sun
}> = [
  { value: 'light', label: '浅色', description: '适合白天与投屏演示', icon: Sun },
  { value: 'dark', label: '深色', description: '适合长时间阅读与夜间使用', icon: Moon },
  { value: 'system', label: '跟随系统', description: '自动匹配系统外观设置', icon: Monitor },
]

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Sparkles
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/85 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/70">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/20">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{value}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>
        </div>
      </div>
    </div>
  )
}

function PreferenceToggle({
  icon: Icon,
  title,
  description,
  enabled,
  onToggle,
}: {
  icon: typeof Brain
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={cn(
        'w-full rounded-2xl border p-3.5 text-left transition-all duration-200',
        enabled
          ? 'border-indigo-200 bg-indigo-50/80 shadow-sm shadow-indigo-500/10 dark:border-indigo-800/60 dark:bg-indigo-950/30'
          : 'border-slate-200/80 bg-white/80 hover:border-slate-300 dark:border-slate-800/80 dark:bg-slate-950/60 dark:hover:border-slate-700'
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm',
            enabled
              ? 'border-indigo-200 bg-white text-indigo-600 dark:border-indigo-700 dark:bg-slate-900 dark:text-indigo-300'
              : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</p>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                enabled
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              )}
            >
              {enabled ? '开启' : '关闭'}
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
    </button>
  )
}

export function SettingsPage() {
  const {
    config,
    availableModels,
    loadConfig,
    saveConfig,
    updateModelConfig,
    updateSystemConfig,
    isLoading,
    error,
    hasUnsavedChanges,
    setError,
  } = useConfigStore()
  const { theme, setTheme } = useTheme()
  const { showSuccess, showError } = useToastStore()
  const [settingsHasChanges, setSettingsHasChanges] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isSavingPreferences, setIsSavingPreferences] = useState(false)
  const pendingChanges = settingsHasChanges || hasUnsavedChanges

  useEffect(() => {
    let active = true
    loadConfig().finally(() => {
      if (active) setHasLoadedOnce(true)
    })
    return () => {
      active = false
    }
  }, [loadConfig])

  useEffect(() => {
    if (config.theme && theme !== config.theme) {
      setTheme(config.theme)
    }
  }, [config.theme, setTheme, theme])

  useEffect(() => {
    if (!pendingChanges) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '当前配置未保存，是否离开？'
      return e.returnValue
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [pendingChanges])

  const initialConfig = useMemo(() => configToTaskMatrix({ models: config.models }), [config.models])
  const availableProviderCount = useMemo(() => {
    return availableModels.providers.length > 0
      ? availableModels.providers.length
      : new Set(config.models.map((m) => m.provider)).size
  }, [availableModels.providers, config.models])
  const availableModelCount = useMemo(() => {
    const all = [
      ...availableModels.chat_models,
      ...availableModels.vision_models,
      ...availableModels.reranker_models,
      ...availableModels.audio_models,
      ...availableModels.video_models,
    ]
    return new Set(all).size
  }, [availableModels])
  const themeLabel = useMemo(
    () => THEME_OPTIONS.find((item) => item.value === config.theme)?.label ?? '浅色',
    [config.theme]
  )

  const handleRetry = useCallback(() => {
    setError(null)
    loadConfig().finally(() => setHasLoadedOnce(true))
  }, [loadConfig, setError])

  const handleSave = async (data: {
    taskMatrix: TaskModelEntry[]
    reranker: { provider: string; model: string }
  }) => {
    data.taskMatrix.forEach((task) => {
      const meta = TASK_MATRIX_META.find((item) => item.taskId === task.taskId)
      if (!meta) return
      updateModelConfig(meta.modelId, { model: task.model, provider: task.provider, name: task.label })
    })
    updateModelConfig('rerank', { model: data.reranker.model, provider: data.reranker.provider, name: 'Reranker' })
    await saveConfig()
  }

  const handleThemeChange = (nextTheme: SystemConfig['theme']) => {
    if (config.theme === nextTheme) return
    setTheme(nextTheme)
    updateSystemConfig({ theme: nextTheme })
  }

  const handleToggle = (key: 'enableThinking' | 'enableCitations') => {
    updateSystemConfig({ [key]: !config[key] } as Pick<SystemConfig, typeof key>)
  }

  const handleSavePreferences = async () => {
    setIsSavingPreferences(true)
    try {
      await saveConfig()
      showSuccess('页面设置已保存到当前浏览器')
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存失败'
      showError(message)
    } finally {
      setIsSavingPreferences(false)
    }
  }

  if (!hasLoadedOnce) {
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
      <div className="mx-auto max-w-6xl px-4 py-6 pb-8 animate-in fade-in duration-300 sm:px-6">
        <div className="mb-6 overflow-hidden rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white via-white to-indigo-50/40 p-6 shadow-xl shadow-indigo-500/5 dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/20 dark:shadow-black/20 sm:p-7">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/90 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/50 dark:text-indigo-200">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              设置中心
            </div>
            <h1 className="mt-3 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-700 bg-clip-text text-3xl font-bold tracking-tight text-transparent dark:from-slate-50 dark:via-slate-200 dark:to-indigo-300">
              模型与界面设置
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              统一管理任务模型、页面主题，以及回答中的思考链与引用显示方式。主题与显示偏好会立即生效；模型保存后会直接更新后端任务路由。
            </p>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <SummaryCard
              icon={Palette}
              label="当前主题"
              value={themeLabel}
              hint="支持浅色、深色与跟随系统"
            />
            <SummaryCard
              icon={Sparkles}
              label="Provider"
              value={String(availableProviderCount)}
              hint="仅统计当前已配置 API Key 的 Provider"
            />
            <SummaryCard
              icon={CheckCircle2}
              label="模型候选"
              value={availableModelCount > 0 ? String(availableModelCount) : '暂无可选'}
              hint="仅显示当前已配置 API Key 的任务模型"
            />
          </div>

          <div className="mt-5 rounded-2xl border border-sky-200/70 bg-gradient-to-r from-sky-50/90 to-indigo-50/60 px-5 py-4 shadow-sm dark:border-sky-900/50 dark:from-sky-950/30 dark:to-indigo-950/20">
            <p className="text-sm leading-relaxed text-sky-900 dark:text-sky-100">
              模型目录来自后端 <code className="rounded bg-white/70 px-1.5 py-0.5 text-[12px] dark:bg-slate-900/70">chat/models</code>，
              只展示当前已配置 Key 的 Provider；点击“保存”后会直接更新后端任务路由，新的请求无需重启即可生效。
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border-2 border-amber-200/80 dark:border-amber-800/60 bg-gradient-to-r from-amber-50/90 to-amber-50/50 dark:from-amber-950/40 dark:to-amber-950/20 px-5 py-4 shadow-lg shadow-amber-200/20 dark:shadow-amber-900/20 animate-in slide-up duration-300">
            <div className="flex items-center gap-3 text-amber-800 dark:text-amber-200">
              <AlertCircle className="h-5 w-5 flex-shrink-0 animate-pulse" />
              <span className="text-sm font-medium">配置加载或同步失败，当前仍显示本地/默认配置。{error}</span>
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

        <div className="space-y-6">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 shadow-lg shadow-slate-200/30 dark:border-slate-800/80 dark:bg-slate-950/75 dark:shadow-black/20">
              <div className="border-b border-slate-100/80 bg-gradient-to-r from-slate-50 to-indigo-50/40 px-6 py-4 dark:border-slate-800/70 dark:from-slate-900/80 dark:to-indigo-950/20">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/20">
                    <Palette className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">界面与显示</h2>
                    <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">控制主题外观，以及回答中哪些辅助信息对用户可见。</p>
                  </div>
                </div>
              </div>

              <div className="space-y-5 p-5">
                <div>
                  <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    主题模式
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {THEME_OPTIONS.map((item) => {
                      const Icon = item.icon
                      const active = config.theme === item.value
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => handleThemeChange(item.value)}
                          className={cn(
                            'rounded-2xl border p-3 text-left transition-all duration-200',
                            active
                              ? 'border-indigo-200 bg-indigo-50 shadow-sm shadow-indigo-500/10 dark:border-indigo-800/60 dark:bg-indigo-950/30'
                              : 'border-slate-200/80 bg-slate-50/60 hover:border-slate-300 hover:bg-white dark:border-slate-800/80 dark:bg-slate-900/50 dark:hover:border-slate-700'
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                'flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm',
                                active
                                  ? 'border-indigo-200 bg-white text-indigo-600 dark:border-indigo-700 dark:bg-slate-900 dark:text-indigo-300'
                                  : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400'
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{item.label}</span>
                                {active && (
                                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/70 dark:text-indigo-200">
                                    当前
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">{item.description}</p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    回答辅助信息
                  </p>
                  <div className="space-y-3">
                    <PreferenceToggle
                      icon={Brain}
                      title="显示思考链"
                      description="控制回答顶部的 Thinking Capsule 是否展示，用于查看意图识别、路由与检索策略。"
                      enabled={config.enableThinking}
                      onToggle={() => handleToggle('enableThinking')}
                    />
                    <PreferenceToggle
                      icon={Quote}
                      title="显示引用"
                      description="控制正文中的引用编号、段落下方的图片/音频/视频引用卡，以及消息底部的引用条是否展示。"
                      enabled={config.enableCitations}
                      onToggle={() => handleToggle('enableCitations')}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3.5 dark:border-slate-800/80 dark:bg-slate-900/50">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">当前状态</p>
                  <ul className="mt-2.5 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                    <li>主题：<span className="font-medium text-slate-800 dark:text-slate-100">{themeLabel}</span></li>
                    <li>思考链：<span className="font-medium text-slate-800 dark:text-slate-100">{config.enableThinking ? '已显示' : '已隐藏'}</span></li>
                    <li>引用：<span className="font-medium text-slate-800 dark:text-slate-100">{config.enableCitations ? '已显示' : '已隐藏'}</span></li>
                  </ul>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/80 p-3.5 dark:border-indigo-900/50 dark:bg-indigo-950/25">
                  <div>
                    <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">保存页面设置</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-indigo-700/80 dark:text-indigo-300/80">
                      主题和显示偏好会即时生效；点击保存用于清除未保存状态并同步当前浏览器配置。
                    </p>
                  </div>
                  <Button
                    onClick={handleSavePreferences}
                    disabled={!hasUnsavedChanges || isSavingPreferences || isLoading}
                    className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-500"
                  >
                    {isSavingPreferences ? '保存中…' : '保存页面设置'}
                  </Button>
                </div>
              </div>
            </section>
          </div>

          <div className="min-w-0">
            <ModelConfig
              initialConfig={initialConfig}
              availableModels={availableModels}
              onSave={handleSave}
              onHasChangesChange={setSettingsHasChanges}
            />
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
