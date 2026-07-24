import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { TaskModelEntry } from '@/components/settings/ModelConfig'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import { useConfigStore, type SystemConfig } from '@/store/useConfigStore'
import { useToastStore } from '@/store/useToastStore'
import {
  AlertCircle,
  Brain,
  Check,
  Monitor,
  Moon,
  Palette,
  Quote,
  Save,
  Sun,
} from 'lucide-react'

const ModelConfig = lazy(() =>
  import('@/components/settings/ModelConfig').then((module) => ({ default: module.ModelConfig }))
)

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
    taskId: 'embedding' as const,
    modelId: 'embedding',
    label: '文本向量化',
    description: '文档与查询的 Dense 向量生成',
    category: 'embedding' as const,
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

function configToTaskMatrix(config: {
  models: Array<{ id: string; model?: string; provider?: string; name?: string }>
}) {
  const rerank = config.models.find((model) => model.id === 'rerank')
  return {
    taskMatrix: TASK_MATRIX_META.map((task) => {
      const current = config.models.find((model) => model.id === task.modelId)
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
  { value: 'light', label: '浅色', description: '明亮环境与投屏', icon: Sun },
  { value: 'dark', label: '深色', description: '夜间与长时间阅读', icon: Moon },
  { value: 'system', label: '跟随系统', description: '自动匹配设备外观', icon: Monitor },
]

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
      aria-label={`${enabled ? '关闭' : '开启'}${title}`}
      onClick={onToggle}
      className="group flex w-full items-center gap-4 rounded-[6px] border border-slate-200 bg-white px-4 py-3.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 max-[480px]:gap-2.5 max-[480px]:px-3 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700 dark:hover:bg-slate-900/70"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-slate-100 text-slate-600 max-[480px]:hidden dark:bg-slate-800 dark:text-slate-300">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          enabled
            ? 'border-indigo-600 bg-indigo-600'
            : 'border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-slate-700'
        )}
        aria-hidden
      >
        <span
          className={cn(
            'absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-[21px]' : 'translate-x-0.5'
          )}
        />
      </span>
    </button>
  )
}

function ModelConfigLoading() {
  return (
    <section
      className="rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950"
      role="status"
      aria-live="polite"
      aria-label="正在载入模型路由"
    >
      <div className="mb-6 flex items-center gap-3">
        <span className="h-10 w-10 animate-pulse rounded-[6px] bg-slate-100 dark:bg-slate-800" aria-hidden />
        <div className="space-y-2">
          <span className="block h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <span className="block h-3 w-56 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-16 animate-pulse rounded-[6px] border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60"
          />
        ))}
      </div>
    </section>
  )
}

function SettingsPageLoading() {
  return (
    <ScrollArea className="h-full bg-slate-50/70 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="h-8 w-20 animate-pulse rounded-[8px] bg-slate-200 dark:bg-slate-800" />
          <div className="h-7 w-20 animate-pulse rounded-full bg-slate-100 dark:bg-slate-900" />
        </div>
        <div className="h-[32rem] animate-pulse rounded-[8px] bg-white dark:bg-slate-900" />
      </div>
    </ScrollArea>
  )
}

export function SettingsPage() {
  const location = useLocation()
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
    hasLoadedConfigOnce,
    setError,
  } = useConfigStore()
  const { theme, setTheme } = useTheme()
  const { showSuccess, showError } = useToastStore()
  const [modelSettingsHaveChanges, setModelSettingsHaveChanges] = useState(false)
  const [isSavingPreferences, setIsSavingPreferences] = useState(false)
  const [isRefreshingCatalog, setIsRefreshingCatalog] = useState(false)
  const [hasActivatedModelMatrix, setHasActivatedModelMatrix] = useState(
    () => location.pathname === '/settings'
  )
  const pendingChanges = modelSettingsHaveChanges || hasUnsavedChanges
  const isSettingsActive = location.pathname === '/settings'

  useEffect(() => {
    if (config.theme && theme !== config.theme) {
      setTheme(config.theme)
    }
  }, [config.theme, setTheme, theme])

  useEffect(() => {
    if (isSettingsActive) {
      setHasActivatedModelMatrix(true)
    }
  }, [isSettingsActive])

  useEffect(() => {
    if (!pendingChanges) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = '当前配置未保存，是否离开？'
      return event.returnValue
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [pendingChanges])

  const initialConfig = useMemo(() => configToTaskMatrix({ models: config.models }), [config.models])
  const themeLabel = useMemo(
    () => THEME_OPTIONS.find((item) => item.value === config.theme)?.label ?? '浅色',
    [config.theme]
  )
  const preferencesStatusText = isSavingPreferences
    ? '正在保存页面设置'
    : hasUnsavedChanges
      ? `页面设置有未保存更改，当前主题为${themeLabel}`
      : `页面设置已同步，当前主题为${themeLabel}`

  const handleRetry = useCallback(() => {
    setError(null)
    void loadConfig()
  }, [loadConfig, setError])

  const handleRefreshCatalog = useCallback(async () => {
    setError(null)
    setIsRefreshingCatalog(true)
    try {
      await loadConfig({ refreshCatalog: true })
      const latestError = useConfigStore.getState().error
      if (latestError) {
        showError(`模型目录刷新失败：${latestError}`)
      } else {
        showSuccess('官网模型目录已刷新')
      }
    } finally {
      setIsRefreshingCatalog(false)
    }
  }, [loadConfig, setError, showError, showSuccess])

  const handleSaveModels = async (data: {
    taskMatrix: TaskModelEntry[]
    reranker: { provider: string; model: string }
  }) => {
    data.taskMatrix.forEach((task) => {
      const meta = TASK_MATRIX_META.find((item) => item.taskId === task.taskId)
      if (!meta) return
      updateModelConfig(meta.modelId, {
        model: task.model,
        provider: task.provider,
        name: task.label,
      })
    })
    updateModelConfig('rerank', {
      model: data.reranker.model,
      provider: data.reranker.provider,
      name: 'Reranker',
    })
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
      showSuccess('界面设置已保存')
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : '保存失败'
      showError(message)
    } finally {
      setIsSavingPreferences(false)
    }
  }

  if (!hasLoadedConfigOnce) {
    return <SettingsPageLoading />
  }

  return (
    <ScrollArea className="h-full rounded-[8px] border border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <span className="sr-only" aria-live="polite">
          {preferencesStatusText}
        </span>

        <header className="mb-5 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-slate-950 dark:text-white">设置</h1>
          <div
            className={cn(
              'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold',
              pendingChanges
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
            )}
          >
            <span
              className={cn('h-1.5 w-1.5 rounded-full', pendingChanges ? 'bg-amber-500' : 'bg-emerald-500')}
              aria-hidden
            />
            {pendingChanges ? '未保存' : '已同步'}
          </div>
        </header>

        {error && (
          <div
            className="mb-6 flex flex-col gap-3 rounded-[8px] border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div>
                <p className="text-sm font-semibold">配置同步失败</p>
                <p className="mt-0.5 text-xs leading-5 text-amber-800 dark:text-amber-300">
                  当前显示本地或默认配置。{error}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 rounded-[6px] border-amber-300 bg-white text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-950"
              aria-label="重试加载设置配置"
              onClick={handleRetry}
            >
              重试加载
            </Button>
          </div>
        )}

        <div className="min-w-0 space-y-6">
            <section
              id="interface"
              className="scroll-mt-6 overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="grid h-1 grid-cols-6" aria-hidden>
                <span className="bg-sky-400" />
                <span className="bg-cyan-400" />
                <span className="bg-teal-400" />
                <span className="bg-violet-400" />
                <span className="bg-amber-400" />
                <span className="bg-rose-400" />
              </div>
              <div className="border-b border-slate-100 px-5 py-5 dark:border-slate-800 sm:px-6">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                    <Palette className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-slate-950 dark:text-white">界面与显示</h2>
                    <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">
                      设置颜色模式，以及回答中要显示的辅助信息。
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-7 p-5 sm:p-6">
                <fieldset>
                  <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">颜色模式</legend>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">切换后立即预览，保存后记住选择。</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {THEME_OPTIONS.map((item) => {
                      const Icon = item.icon
                      const active = config.theme === item.value
                      return (
                        <button
                          key={item.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => handleThemeChange(item.value)}
                          className={cn(
                            'relative flex items-center gap-3 rounded-[6px] border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
                            active
                              ? 'border-indigo-500 bg-indigo-50/70 dark:border-indigo-500 dark:bg-indigo-950/40'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700 dark:hover:bg-slate-900'
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]',
                              active
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            )}
                          >
                            <Icon className="h-[18px] w-[18px]" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {item.label}
                              {active && <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-300" aria-hidden />}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                              {item.description}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">回答辅助信息</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    控制回答中展示多少推理与来源信息，不影响后端检索流程。
                  </p>
                  <div className="mt-3 grid gap-2 xl:grid-cols-2">
                    <PreferenceToggle
                      icon={Brain}
                      title="显示思考链"
                      description="展示意图识别、路由与检索策略。"
                      enabled={config.enableThinking}
                      onToggle={() => handleToggle('enableThinking')}
                    />
                    <PreferenceToggle
                      icon={Quote}
                      title="显示引用"
                      description="展示引用编号、来源卡片与消息引用条。"
                      enabled={config.enableCitations}
                      onToggle={() => handleToggle('enableCitations')}
                    />
                  </div>
                </div>
              </div>

              <footer className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-800 dark:bg-slate-900/35">
                <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {hasUnsavedChanges ? '界面设置已修改，保存后记住当前选择。' : '界面设置已保存。'}
                </div>
                <Button
                  onClick={handleSavePreferences}
                  disabled={!hasUnsavedChanges || isSavingPreferences || isLoading}
                  aria-label={
                    isSavingPreferences
                      ? '正在保存界面设置'
                      : hasUnsavedChanges
                        ? '保存界面设置'
                        : '当前没有需要保存的界面设置'
                  }
                  className="rounded-[6px] bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 focus-visible:ring-indigo-500"
                >
                  {isSavingPreferences ? (
                    <>
                      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                      保存中
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" aria-hidden />
                      保存界面设置
                    </>
                  )}
                </Button>
              </footer>
            </section>

            <section id="models" className="scroll-mt-6">
              {(isSettingsActive || hasActivatedModelMatrix) ? (
                <Suspense fallback={<ModelConfigLoading />}>
                  <ModelConfig
                    initialConfig={initialConfig}
                    availableModels={availableModels}
                    onSave={handleSaveModels}
                    onRefreshCatalog={handleRefreshCatalog}
                    catalogRefreshing={isRefreshingCatalog || isLoading}
                    onHasChangesChange={setModelSettingsHaveChanges}
                  />
                </Suspense>
              ) : null}
            </section>
        </div>
      </div>
    </ScrollArea>
  )
}
