import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation } from 'react-router-dom'
import type { TaskModelEntry } from '@/components/settings/ModelConfig'
import { DecisionSettings } from '@/components/settings/DecisionSettings'
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
  Route,
  Settings2,
  Sun,
  Zap,
} from 'lucide-react'
import './settingsPage.css'

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
  icon: typeof Sun
}> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const SETTINGS_SECTIONS = [
  { id: 'interface', label: '界面与显示', icon: Palette },
  { id: 'models', label: '模型与路由', icon: Route },
  { id: 'decision', label: 'Decision 模型', icon: Zap },
] as const

type SettingsSection = typeof SETTINGS_SECTIONS[number]['id']

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
  const helpId = useId()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={title}
      aria-describedby={helpId}
      onClick={onToggle}
      className="settings-preference"
    >
      <span className="settings-preference-icon">
        <Icon size={20} aria-hidden />
      </span>
      <span className="settings-preference-copy">
        <span className="settings-preference-title">{title}</span>
        <span id={helpId} className="settings-help">{description}</span>
      </span>
      <span className="settings-preference-state" aria-hidden>{enabled ? '已开启' : '已关闭'}</span>
      <span className={cn('settings-switch', enabled && 'is-on')} aria-hidden>
        <span />
      </span>
    </button>
  )
}

function ModelConfigLoading() {
  return (
    <section
      className="settings-panel settings-loading-panel"
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
    <ScrollArea className="settings-page h-full">
      <div className="settings-container">
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
    updateSystemConfig,
    markAsSaved,
    isLoading,
    error,
    hasLoadedConfigOnce,
    setError,
  } = useConfigStore()
  const { theme, setTheme } = useTheme()
  const { showSuccess, showError } = useToastStore()
  const [modelSettingsHaveChanges, setModelSettingsHaveChanges] = useState(false)
  const [decisionSettingsHaveChanges, setDecisionSettingsHaveChanges] = useState(false)
  const [isRefreshingCatalog, setIsRefreshingCatalog] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('interface')
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [hasActivatedModelMatrix, setHasActivatedModelMatrix] = useState(
    () => location.pathname === '/settings'
  )
  const pendingChanges = modelSettingsHaveChanges || decisionSettingsHaveChanges
  const isSettingsActive = location.pathname === '/settings'

  const activateSection = (section: SettingsSection) => {
    setActiveSection(section)
    const viewport = scrollRef.current?.firstElementChild
    if (viewport instanceof HTMLElement) viewport.scrollTo({ top: 0 })
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % SETTINGS_SECTIONS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = SETTINGS_SECTIONS.length - 1
    else return
    event.preventDefault()
    activateSection(SETTINGS_SECTIONS[nextIndex].id)
    tabRefs.current[nextIndex]?.focus()
  }

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
  const preferencesStatusText = `界面偏好已自动保存，当前主题为${themeLabel}`

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
    const selections = new Map(data.taskMatrix.map((task) => {
      const meta = TASK_MATRIX_META.find((item) => item.taskId === task.taskId)
      return [meta?.modelId, { model: task.model, provider: task.provider, name: task.label }] as const
    }))
    selections.set('rerank', { ...data.reranker, name: 'Reranker' })
    const nextModels = useConfigStore.getState().config.models.map((model) => {
      const selection = selections.get(model.id)
      return selection ? { ...model, ...selection } : model
    })
    await saveConfig(nextModels)
  }

  const handleThemeChange = (nextTheme: SystemConfig['theme']) => {
    if (config.theme === nextTheme) return
    setTheme(nextTheme)
    updateSystemConfig({ theme: nextTheme })
    markAsSaved()
  }

  const handleToggle = (key: 'enableThinking' | 'enableCitations') => {
    updateSystemConfig({ [key]: !config[key] } as Pick<SystemConfig, typeof key>)
    markAsSaved()
  }

  if (!hasLoadedConfigOnce) {
    return <SettingsPageLoading />
  }

  const sectionDirty: Record<SettingsSection, boolean> = {
    interface: false,
    models: modelSettingsHaveChanges,
    decision: decisionSettingsHaveChanges,
  }

  return (
    <ScrollArea ref={scrollRef} className="settings-page h-full">
      <div className="settings-container">
        <span className="sr-only" aria-live="polite">{preferencesStatusText}</span>

        <header className="settings-page-header">
          <div className="settings-page-heading">
            <span className="settings-page-emblem" aria-hidden><Settings2 size={24} /></span>
            <div>
              <h1>设置</h1>
              <p>调整外观、模型和检索行为，让工具更合你的习惯。</p>
            </div>
          </div>
          <div className={cn('settings-sync-status', pendingChanges && 'has-changes')} role="status">
            {pendingChanges ? <span className="settings-status-dot" aria-hidden /> : <Check size={15} aria-hidden />}
            {pendingChanges ? '有未保存的更改' : '所有更改已保存'}
          </div>
        </header>

        <div className="settings-navigation">
          <div role="tablist" aria-label="设置分区" className="settings-tabs">
            {SETTINGS_SECTIONS.map((section, index) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  ref={(node) => { tabRefs.current[index] = node }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${section.id}`}
                  aria-controls={`settings-panel-${section.id}`}
                  aria-selected={activeSection === section.id}
                  tabIndex={activeSection === section.id ? 0 : -1}
                  className={cn('settings-tab', activeSection === section.id && 'is-active')}
                  onClick={() => activateSection(section.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  <Icon size={18} aria-hidden />
                  {section.label}
                  {sectionDirty[section.id] && <span className="settings-tab-dirty"><span aria-hidden /><span className="sr-only">有未保存更改</span></span>}
                </button>
              )
            })}
          </div>
          <span className="settings-navigation-hint">界面偏好自动保存</span>
        </div>

        {error && (
          <div className="settings-error" role="alert">
            <AlertCircle size={20} aria-hidden />
            <div>
              <p className="settings-error-title">配置同步失败</p>
              <p>当前显示本地或默认配置。{error}</p>
            </div>
            <Button variant="outline" className="settings-secondary-button" aria-label="重试加载设置配置" onClick={handleRetry}>
              重试加载
            </Button>
          </div>
        )}

        <div
          id="settings-panel-interface"
          role="tabpanel"
          aria-labelledby="settings-tab-interface"
          hidden={activeSection !== 'interface'}
          tabIndex={0}
          className="settings-tabpanel"
        >
          <section id="interface" className="settings-panel" aria-labelledby="settings-interface-title">
            <header className="settings-panel-header">
              <span className="settings-section-icon" aria-hidden><Palette size={21} /></span>
              <div>
                <h2 id="settings-interface-title">界面与显示</h2>
              </div>
            </header>

            <div className="settings-interface-body">
              <fieldset className="settings-fieldset">
                <legend>颜色模式</legend>
                <div className="settings-theme-options">
                  {THEME_OPTIONS.map((item) => {
                    const Icon = item.icon
                    const active = config.theme === item.value
                    return (
                      <label key={item.value} className={cn('settings-theme-card', active && 'is-selected')}>
                        <input
                          type="radio"
                          name="settings-theme"
                          value={item.value}
                          checked={active}
                          onChange={() => handleThemeChange(item.value)}
                          className="sr-only"
                        />
                        <span className={cn('settings-theme-preview', `settings-theme-preview--${item.value}`)} aria-hidden>
                          <span className="settings-preview-sidebar"><i /><i /><i /></span>
                          <span className="settings-preview-content">
                            <span className="settings-preview-heading" />
                            <span className="settings-preview-notes"><i /><i /><i /></span>
                            <span className="settings-preview-composer"><i /><i /></span>
                          </span>
                          {item.value === 'system' && <span className="settings-preview-system"><Sun size={13} /><Moon size={13} /></span>}
                        </span>
                        <span className="settings-theme-label">
                          <Icon size={18} aria-hidden />
                          <span>{item.label}</span>
                          <span className="settings-theme-check" aria-hidden>{active && <Check size={13} />}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              <div className="settings-answer-preferences">
                <div className="settings-group-heading">
                  <h3>回答辅助信息</h3>
                </div>
                <div className="settings-preference-list">
                  <PreferenceToggle
                    icon={Brain}
                    title="显示思考链"
                    description="展开查询理解、路由与检索策略，方便了解回答过程。"
                    enabled={config.enableThinking}
                    onToggle={() => handleToggle('enableThinking')}
                  />
                  <PreferenceToggle
                    icon={Quote}
                    title="显示引用"
                    description="展示引用编号和来源卡片，方便查看原始材料。"
                    enabled={config.enableCitations}
                    onToggle={() => handleToggle('enableCitations')}
                  />
                </div>
              </div>
            </div>

          </section>
        </div>

        <div
          id="settings-panel-models"
          role="tabpanel"
          aria-labelledby="settings-tab-models"
          hidden={activeSection !== 'models'}
          tabIndex={0}
          className="settings-tabpanel"
        >
          {(isSettingsActive || hasActivatedModelMatrix) && (
            <Suspense fallback={<ModelConfigLoading />}>
              <ModelConfig
                isActive={activeSection === 'models' && isSettingsActive}
                initialConfig={initialConfig}
                availableModels={availableModels}
                onSave={handleSaveModels}
                onRefreshCatalog={handleRefreshCatalog}
                catalogRefreshing={isRefreshingCatalog || isLoading}
                onHasChangesChange={setModelSettingsHaveChanges}
              />
            </Suspense>
          )}
        </div>

        <div
          id="settings-panel-decision"
          role="tabpanel"
          aria-labelledby="settings-tab-decision"
          hidden={activeSection !== 'decision'}
          tabIndex={0}
          className="settings-tabpanel"
        >
          {hasActivatedModelMatrix && <DecisionSettings onHasChangesChange={setDecisionSettingsHaveChanges} />}
        </div>
      </div>
    </ScrollArea>
  )
}
