import { useState, useEffect, useId, useLayoutEffect, useRef, useMemo, type ComponentType } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Save, RotateCcw, AlertCircle, Brain, Image, MessageSquare, ArrowDownUp, Check, ChevronDown, Route, Mic, Film, BookText, Database, RefreshCw, Search, PlugZap, Square } from 'lucide-react'
import { useToastStore } from '@/store/useToastStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useModelRouteTests } from '@/hooks/useModelRouteTests'
import { modelRouteTestKey } from '@/lib/modelRouteTests'
import type { ModelRouteSelection, ModelRouteTestState } from '@/types/modelRouteTest'
import type { AvailableModels, AvailableModelType, ModelCatalogDetail } from '@/store/useConfigStore'
import { BrandIcon, BrandSelect } from './BrandSelect'
import './modelSettings.css'

export type TaskId =
  | 'intent'
  | 'rewrite'
  | 'embedding'
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

const CAPABILITY_LABELS: Record<AvailableModelType, string> = {
  chat: '文本对话',
  embedding: '向量化',
  vision: '图像理解',
  reranker: '重排',
  audio: '音频理解',
  video: '视频理解',
}

const TASK_BACKEND_KEYS: Record<TaskId, string> = {
  intent: 'intent_recognition',
  rewrite: 'query_rewriting',
  embedding: 'embedding',
  caption: 'image_captioning',
  audio: 'audio_transcription',
  video: 'video_parsing',
  portrait: 'kb_portrait_generation',
  generation: 'final_generation',
}

const FALLBACK_MODELS: Record<string, Partial<Record<AvailableModelType, string[]>>> = {
  siliconflow: {
    chat: ['Qwen/Qwen3.5-397B-A17B', 'Pro/moonshotai/Kimi-K2.6'],
    embedding: ['Qwen/Qwen3-Embedding-8B'],
    vision: ['Qwen/Qwen3-VL-30B-A3B-Instruct'],
    reranker: ['Qwen/Qwen3-Reranker-8B'],
    video: ['Qwen/Qwen3.5-397B-A17B'],
  },
  deepseek: {
    chat: ['deepseek:deepseek-flash'],
  },
  openrouter: {},
  aliyun_bailian: {
    chat: ['aliyun_bailian:qwen3.5-flash'],
    vision: ['aliyun_bailian:qwen3-vl-plus-2025-12-19'],
    reranker: ['aliyun_bailian:qwen3-rerank'],
    audio: ['aliyun_bailian:qwen3-omni-flash'],
    video: ['aliyun_bailian:qwen3.5-omni-plus-2026-03-15'],
  },
}

const DEFAULT_MATRIX: TaskModelEntry[] = [
  {
    taskId: 'intent',
    label: '意图识别',
    description: '查询理解与检索策略决策',
    category: 'chat',
    provider: 'deepseek',
    model: 'deepseek:deepseek-flash',
  },
  {
    taskId: 'rewrite',
    label: '查询改写',
    description: '补全检索表达、扩展召回线索',
    category: 'chat',
    provider: 'deepseek',
    model: 'deepseek:deepseek-flash',
  },
  {
    taskId: 'embedding',
    label: '文本向量化',
    description: '文档与查询的 Dense 向量生成',
    category: 'embedding',
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-8B',
  },
  {
    taskId: 'caption',
    label: '图像描述',
    description: '图像内容理解与描述生成',
    category: 'vision',
    provider: 'aliyun_bailian',
    model: 'aliyun_bailian:qwen3-vl-plus-2025-12-19',
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
    model: 'aliyun_bailian:qwen3.5-omni-plus-2026-03-15',
  },
  {
    taskId: 'portrait',
    label: '知识库画像',
    description: '主题画像与摘要生成',
    category: 'chat',
    provider: 'deepseek',
    model: 'deepseek:deepseek-flash',
  },
  {
    taskId: 'generation',
    label: '回答生成',
    description: '最终回答生成与流式输出',
    category: 'chat',
    provider: 'deepseek',
    model: 'deepseek:deepseek-flash',
  },
]

const DEFAULT_RERANK = {
  provider: 'siliconflow',
  model: 'Qwen/Qwen3-Reranker-8B',
}

const TASK_META: Record<TaskId, { icon: ComponentType<{ className?: string }>; isPrimary?: boolean }> = {
  intent: { icon: Brain },
  rewrite: { icon: Route },
  embedding: { icon: Database },
  caption: { icon: Image },
  audio: { icon: Mic },
  video: { icon: Film },
  portrait: { icon: BookText },
  generation: { icon: MessageSquare, isPrimary: true },
}

interface ModelConfigProps {
  isActive?: boolean
  onSave?: (config: {
    taskMatrix: TaskModelEntry[]
    reranker: { provider: string; model: string }
  }) => void | Promise<void>
  initialConfig?: {
    taskMatrix?: TaskModelEntry[]
    reranker?: { provider: string; model: string }
  }
  availableModels?: AvailableModels
  onRefreshCatalog?: () => void | Promise<void>
  catalogRefreshing?: boolean
  onHasChangesChange?: (hasChanges: boolean) => void
  className?: string
}

function formatTokenCount(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

function formatCatalogTime(value?: number | null): string {
  if (!value) return '尚未同步'
  return new Date(value * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function modelDisplayName(model: string): string {
  const raw = model.replace(/^(deepseek|openrouter|aliyun_bailian|siliconflow|siliconcloud):/, '')
  if (raw === 'deepseek-flash') return 'DeepSeek Flash'
  return raw.replace(/^Qwen\//, '')
}

function modelSummary(model: string, detail?: ModelCatalogDetail): string {
  const capabilities = (detail?.capabilities ?? []).map((item) => CAPABILITY_LABELS[item]).filter(Boolean)
  const context = formatTokenCount(detail?.context_length)
  return [model, ...capabilities, context && `${context} tokens 上下文`].filter(Boolean).join(' · ')
}

function ModelLogo({ modelId, provider, className }: { modelId: string; provider?: string; className?: string }) {
  return <BrandIcon modelId={modelId} provider={provider} size={22} className={className} />
}

function RouteTestFeedback({ id, state, label, capability }: { id: string; state?: ModelRouteTestState; label: string; capability: AvailableModelType }) {
  const result = state?.result
  return <div id={id} className={cn('settings-model-test-feedback', result && (result.success ? 'is-success' : 'is-failure'))}>
    {state && <>
      {result ? (result.success ? <Check size={14} aria-hidden /> : <AlertCircle size={14} aria-hidden />) : <RefreshCw size={14} className={state.status === 'running' ? 'animate-spin' : undefined} aria-hidden />}
      <span><span className="sr-only">{label}：</span>{result ? <><strong>{result.success ? '连接通过' : '测试未通过'}</strong><span className="settings-model-test-duration">{(result.duration_ms / 1000).toFixed(2)} 秒</span><span className="settings-model-test-message">{result.success ? result.details || result.message : result.message}</span></> : state.status === 'queued' ? '等待测试…' : `正在测试${CAPABILITY_LABELS[capability]}…`}</span>
    </>}
  </div>
}

function LogoModelSelect({
  value,
  list,
  provider,
  disabled,
  onChange,
  className,
  ariaLabel,
  isActive = true,
  details = {},
}: {
  value: string
  list: string[]
  provider: string
  disabled?: boolean
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
  isActive?: boolean
  details?: Record<string, ModelCatalogDetail>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const generatedId = useId().replace(/:/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLLIElement | null>>([])
  const focusOnOpenRef = useRef<'search' | 'option' | null>(null)
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const filteredModels = useMemo(() => list.filter((model) => `${model} ${modelDisplayName(model)}`.toLowerCase().includes(query.trim().toLowerCase())), [list, query])
  const searchable = list.length > 7
  const displayValue = value || list[0] || ''
  const listboxId = `${generatedId}-settings-model-listbox`
  const searchId = `${generatedId}-settings-model-search`
  const activeOptionId = open && filteredModels.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined
  const selectLabel = displayValue
    ? `选择模型，当前模型：${displayValue}，共 ${list.length} 个候选`
    : `选择模型，当前无可用模型，共 ${list.length} 个候选`

  const getSelectedIndex = (models = filteredModels) => Math.max(0, models.findIndex((model) => model === value))

  const focusOption = (idx: number) => {
    if (filteredModels.length === 0) return
    const boundedIdx = Math.max(0, Math.min(idx, filteredModels.length - 1))
    setActiveIndex(boundedIdx)
    requestAnimationFrame(() => {
      optionRefs.current[boundedIdx]?.focus()
      optionRefs.current[boundedIdx]?.scrollIntoView({ block: 'nearest' })
    })
  }

  const openMenu = (options?: { focus?: boolean; index?: number }) => {
    if (!isActive || disabled || list.length === 0) return
    if (open) {
      focusOption(options?.index ?? getSelectedIndex())
      return
    }
    setQuery('')
    setActiveIndex(Math.max(0, Math.min(options?.index ?? getSelectedIndex(list), list.length - 1)))
    focusOnOpenRef.current = options?.focus ? 'option' : searchable ? 'search' : null
    setOpen(true)
  }

  const closeMenu = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => buttonRef.current?.focus())
  }

  const selectModel = (model: string, restoreFocus = false) => {
    onChange(model)
    closeMenu(restoreFocus)
  }

  const updateMenuBox = () => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    if (!rect.width || !rect.height) {
      setOpen(false)
      return
    }
    const viewportPadding = 16
    const width = Math.min(560, window.innerWidth - viewportPadding * 2, Math.max(rect.width, 360))
    const left = Math.min(Math.max(viewportPadding, rect.right - width), Math.max(viewportPadding, window.innerWidth - width - viewportPadding))
    const below = window.innerHeight - rect.bottom - 8 - viewportPadding
    const above = rect.top - 8 - viewportPadding
    const showAbove = below < 240 && above > below
    const contentHeight = list.length * 62 + (searchable ? 60 : 0) + 16
    const maxHeight = Math.min(420, contentHeight, Math.max(120, showAbove ? above : below))
    const top = showAbove ? rect.top - maxHeight - 8 : rect.bottom + 8
    setMenuBox({ top, left, width, maxHeight })
  }

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    updateMenuBox()
    window.addEventListener('resize', updateMenuBox)
    window.addEventListener('scroll', updateMenuBox, true)
    return () => {
      window.removeEventListener('resize', updateMenuBox)
      window.removeEventListener('scroll', updateMenuBox, true)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!isActive) {
      setOpen(false)
      setQuery('')
    }
  }, [isActive])

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, filteredModels.length)
  }, [filteredModels.length])

  useEffect(() => {
    if (!open || !menuBox) return
    const pendingFocus = focusOnOpenRef.current
    if (pendingFocus === null) return
    requestAnimationFrame(() => {
      if (pendingFocus === 'search') searchRef.current?.focus()
      else {
        optionRefs.current[activeIndex]?.focus()
        optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
      }
      focusOnOpenRef.current = null
    })
  }, [open, menuBox, activeIndex])

  const handleButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || list.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMenu({ focus: true, index: getSelectedIndex(list) })
    } else if (event.key === 'ArrowUp' || event.key === 'End') {
      event.preventDefault()
      openMenu({ focus: true, index: list.length - 1 })
    } else if (event.key === 'Home') {
      event.preventDefault()
      openMenu({ focus: true, index: 0 })
    }
  }

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>, idx: number) => {
    if (event.nativeEvent.isComposing || filteredModels.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption((idx + 1) % filteredModels.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (idx === 0 && searchable) searchRef.current?.focus()
      else focusOption((idx - 1 + filteredModels.length) % filteredModels.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusOption(filteredModels.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const model = filteredModels[idx]
      if (model) selectModel(model, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
    }
  }

  const menu = isActive && open && menuBox && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          className="settings-model-picker"
          onBlurCapture={(event) => {
            const target = event.relatedTarget as Node | null
            if (target && !menuRef.current?.contains(target) && target !== buttonRef.current) closeMenu()
          }}
          style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width, maxHeight: menuBox.maxHeight }}
        >
          {searchable && (
            <div className="settings-model-picker-search">
              <Search className="h-4 w-4" aria-hidden />
              <label className="sr-only" htmlFor={searchId}>搜索模型</label>
              <input
                id={searchId}
                ref={searchRef}
                type="search"
                autoComplete="off"
                placeholder="输入模型名称搜索…"
                value={query}
                aria-controls={listboxId}
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'ArrowDown' || event.key === 'Enter') {
                    event.preventDefault()
                    focusOption(0)
                  }
                }}
              />
              <span>{filteredModels.length} 个</span>
            </div>
          )}
          <ul
            id={listboxId}
            role="listbox"
            aria-label={`模型列表，共 ${filteredModels.length} 个候选`}
            aria-activedescendant={activeOptionId}
            className="settings-model-picker-list"
          >
            {filteredModels.map((model, idx) => (
              <li
                key={model}
                ref={(node) => { optionRefs.current[idx] = node }}
                id={`${listboxId}-option-${idx}`}
                role="option"
                aria-selected={model === value}
                tabIndex={idx === activeIndex ? 0 : -1}
                onClick={() => selectModel(model, true)}
                onMouseEnter={() => setActiveIndex(idx)}
                onKeyDown={(event) => handleOptionKeyDown(event, idx)}
                className={cn('settings-model-picker-option', model === value && 'is-selected')}
              >
                <ModelLogo modelId={model} provider={provider} />
                <span className="settings-model-option-copy" title={modelSummary(model, details[model])}>
                  <span>{modelDisplayName(model)}</span>
                  <small>{model}</small>
                </span>
                {model === value && <Check className="h-4 w-4 shrink-0" aria-hidden />}
              </li>
            ))}
          </ul>
          {filteredModels.length === 0 && <p className="settings-model-picker-empty" role="status">没有匹配的模型，试试其他名称。</p>}
        </div>,
        document.body
      )
    : null

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={displayValue ? modelSummary(displayValue, details[displayValue]) : '当前无可用模型'}
        aria-label={ariaLabel ?? selectLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleButtonKeyDown}
        onBlur={(event) => {
          const target = event.relatedTarget as Node | null
          if (target && !menuRef.current?.contains(target)) closeMenu()
        }}
        className="settings-model-control settings-model-trigger"
      >
        {displayValue && <ModelLogo modelId={displayValue} provider={provider} />}
        <span className="min-w-0 flex-1 truncate">{displayValue ? modelDisplayName(displayValue) : '当前无可用模型'}</span>
        {formatTokenCount(details[displayValue]?.context_length) && (
          <span className="settings-model-context" aria-label={`上下文 ${formatTokenCount(details[displayValue]?.context_length)} tokens`}>
            {formatTokenCount(details[displayValue]?.context_length)}
          </span>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {menu}
    </div>
  )
}

export function ModelConfig({
  isActive = true,
  onSave,
  initialConfig,
  availableModels,
  onRefreshCatalog,
  catalogRefreshing = false,
  onHasChangesChange,
  className,
}: ModelConfigProps) {
  const [matrix, setMatrix] = useState<TaskModelEntry[]>(initialConfig?.taskMatrix ?? DEFAULT_MATRIX)
  const [reranker, setReranker] = useState(initialConfig?.reranker ?? DEFAULT_RERANK)
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedBrief, setSavedBrief] = useState(false)
  const savedBriefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftIsDirtyRef = useRef(false)
  const savedConfigRef = useRef({
    taskMatrix: initialConfig?.taskMatrix ?? DEFAULT_MATRIX,
    reranker: initialConfig?.reranker ?? DEFAULT_RERANK,
  })
  const { showSuccess, showError } = useToastStore()
  const modelDetails = availableModels?.model_details ?? {}
  const catalogStatus = availableModels?.catalog_status
  const syncedModelCount = Object.values(modelDetails).filter((detail) => detail.catalog_synced).length
  const totalModelCount = Object.keys(modelDetails).length
  const lastRefreshLabel = formatCatalogTime(catalogStatus?.last_refresh_finished_at)
  const testSelections = useMemo<ModelRouteSelection[]>(() => [
    ...matrix.map(task => ({ provider: task.provider, model: task.model, capability: task.category })),
    { ...reranker, capability: 'reranker' },
  ], [matrix, reranker])
  const routeTests = useModelRouteTests(testSelections)
  const batchActive = !!routeTests.batch && routeTests.batch.running + routeTests.batch.queued > 0
  const testHelpId = useId()
  const configStatusId = useId().replace(/:/g, '') + '-model-config-status'
  const configStatusText = saving
    ? '正在保存模型配置'
    : catalogRefreshing
      ? '正在刷新官方模型目录'
      : savedBrief
        ? '模型配置已保存'
        : hasChanges
          ? '模型配置有未保存更改'
          : '模型配置没有未保存更改'

  const providerList = (category: AvailableModelType, taskKey?: string) => {
    const taskCandidates = taskKey ? (availableModels?.task_candidates?.[taskKey] ?? []) : []
    if (taskCandidates.length > 0) {
      return Array.from(new Set(taskCandidates.map((item) => item.provider).filter(Boolean)))
    }
    if (availableModels?.models_by_provider && Object.keys(availableModels.models_by_provider).length > 0) {
      return Object.entries(availableModels.models_by_provider)
        .filter(([, models]) => (models?.[category] ?? []).length > 0)
        .map(([provider]) => provider)
    }
    return Object.entries(FALLBACK_MODELS)
      .filter(([, categories]) => (categories?.[category] ?? []).length > 0)
      .map(([provider]) => provider)
  }

  const modelList = (provider: string, category: AvailableModelType, taskKey?: string) => {
    const taskCandidates = taskKey ? (availableModels?.task_candidates?.[taskKey] ?? []) : []
    const rankedModels = taskCandidates
      .filter((item) => item.provider === provider)
      .map((item) => item.model)
    if (availableModels?.models_by_provider && Object.keys(availableModels.models_by_provider).length > 0) {
      const providerModels = availableModels.models_by_provider[provider]?.[category] ?? []
      if (rankedModels.length > 0) {
        const seen = new Set(rankedModels)
        return [...rankedModels, ...providerModels.filter((model) => !seen.has(model))]
      }
      return [...providerModels]
    }
    return [...(FALLBACK_MODELS[provider]?.[category] ?? [])]
  }

  const normalizeSelection = <T extends { provider: string; model: string }>(entry: T, category: AvailableModelType, taskKey?: string): T => {
    const providers = providerList(category, taskKey)
    if (providers.length === 0) {
      return { ...entry, provider: '', model: '' } as T
    }
    const nextProvider = providers.includes(entry.provider) ? entry.provider : providers[0]
    const models = modelList(nextProvider, category, taskKey)
    return {
      ...entry,
      provider: nextProvider,
      model: models.includes(entry.model) ? entry.model : (models[0] ?? ''),
    } as T
  }

  useEffect(() => {
    draftIsDirtyRef.current = hasChanges || saving
  }, [hasChanges, saving])

  useEffect(() => {
    if (draftIsDirtyRef.current) return
    if (initialConfig?.taskMatrix) setMatrix(initialConfig.taskMatrix)
    if (initialConfig?.reranker) setReranker(initialConfig.reranker)
    savedConfigRef.current = {
      taskMatrix: initialConfig?.taskMatrix ?? DEFAULT_MATRIX,
      reranker: initialConfig?.reranker ?? DEFAULT_RERANK,
    }
  }, [initialConfig?.taskMatrix, initialConfig?.reranker])

  useEffect(() => {
    onHasChangesChange?.(hasChanges)
  }, [hasChanges, onHasChangesChange])

  useEffect(() => {
    return () => {
      if (savedBriefTimerRef.current) {
        clearTimeout(savedBriefTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (draftIsDirtyRef.current) return
    savedConfigRef.current = {
      taskMatrix: savedConfigRef.current.taskMatrix.map((entry) => normalizeSelection(entry, entry.category, TASK_BACKEND_KEYS[entry.taskId])),
      reranker: normalizeSelection(savedConfigRef.current.reranker, 'reranker', 'reranking'),
    }
    setMatrix((prev) => {
      const next = prev.map((entry) => normalizeSelection(entry, entry.category, TASK_BACKEND_KEYS[entry.taskId]))
      const changed = next.some((entry, index) => entry.provider !== prev[index]?.provider || entry.model !== prev[index]?.model)
      return changed ? next : prev
    })
    setReranker((prev) => {
      const next = normalizeSelection(prev, 'reranker', 'reranking')
      return next.provider !== prev.provider || next.model !== prev.model ? next : prev
    })
  }, [availableModels])

  const markDraftChanges = (nextMatrix: TaskModelEntry[], nextReranker: { provider: string; model: string }) => {
    const saved = savedConfigRef.current
    setSavedBrief(false)
    setHasChanges(nextMatrix.some((task) => {
      const previous = saved.taskMatrix.find((entry) => entry.taskId === task.taskId)
      return previous?.provider !== task.provider || previous?.model !== task.model
    }) || saved.reranker.provider !== nextReranker.provider || saved.reranker.model !== nextReranker.model)
  }

  const updateTask = (taskId: TaskId, field: 'provider' | 'model', value: string) => {
    if (matrix.find((task) => task.taskId === taskId)?.[field] === value) return
    const nextMatrix = matrix.map((task) => {
      if (task.taskId !== taskId) return task
      if (field === 'provider') {
        const nextModels = modelList(value, task.category, TASK_BACKEND_KEYS[task.taskId])
        const nextModel = nextModels.includes(task.model) ? task.model : (nextModels[0] ?? '')
        return { ...task, provider: value, model: nextModel }
      }
      return { ...task, model: value }
    })
    setMatrix(nextMatrix)
    markDraftChanges(nextMatrix, reranker)
  }

  const updateReranker = (field: 'provider' | 'model', value: string) => {
    if (reranker[field] === value) return
    const nextModels = field === 'provider' ? modelList(value, 'reranker', 'reranking') : []
    const nextReranker = field === 'provider'
      ? { ...reranker, provider: value, model: nextModels.includes(reranker.model) ? reranker.model : (nextModels[0] ?? '') }
      : { ...reranker, model: value }
    setReranker(nextReranker)
    markDraftChanges(matrix, nextReranker)
  }

  const handleSave = async () => {
    if (invalidSelections.length > 0) {
      showError(`${invalidSelections.join('、')}的模型已不在当前目录中，请重新选择后保存。`)
      return
    }
    setSaving(true)
    setSavedBrief(false)
    try {
      await onSave?.({ taskMatrix: matrix, reranker })
      savedConfigRef.current = { taskMatrix: matrix, reranker }
      setHasChanges(false)
      showSuccess('配置已保存')
      setSavedBrief(true)
      if (savedBriefTimerRef.current) {
        clearTimeout(savedBriefTimerRef.current)
      }
      savedBriefTimerRef.current = setTimeout(() => setSavedBrief(false), 2000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败'
      showError(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setSavedBrief(false)
    setMatrix(savedConfigRef.current.taskMatrix)
    setReranker(savedConfigRef.current.reranker)
    setHasChanges(false)
  }

  const rerankerProviders = providerList('reranker', 'reranking')
  const rerankerModels = reranker.provider ? modelList(reranker.provider, 'reranker', 'reranking') : []
  const invalidSelections = matrix
    .filter((task) => !providerList(task.category, TASK_BACKEND_KEYS[task.taskId]).includes(task.provider)
      || !modelList(task.provider, task.category, TASK_BACKEND_KEYS[task.taskId]).includes(task.model))
    .map((task) => task.label)
  if (!rerankerProviders.includes(reranker.provider) || !rerankerModels.includes(reranker.model)) invalidSelections.push('检索结果重排')

  const failedCatalogProviders = Object.entries(catalogStatus?.providers ?? {})
    .filter(([, status]) => !status.ok)
    .map(([provider]) => PROVIDER_DISPLAY_NAMES[provider] ?? provider)

  const routeGroups: Array<{ id: string; label: string; tasks: Array<TaskId | 'reranker'> }> = [
    { id: 'conversation', label: '对话与检索', tasks: ['generation', 'intent', 'rewrite', 'embedding', 'reranker'] },
    { id: 'content', label: '内容理解', tasks: ['caption', 'audio', 'video', 'portrait'] },
  ]

  const renderRoute = (taskId: TaskId | 'reranker') => {
    const isReranker = taskId === 'reranker'
    const task = isReranker
      ? { ...reranker, taskId, label: '检索结果重排', description: '调整召回结果的相关性顺序', category: 'reranker' as const }
      : matrix.find((item) => item.taskId === taskId)
    if (!task) return null
    const Icon = isReranker ? ArrowDownUp : TASK_META[taskId].icon
    const isPrimary = taskId === 'generation'
    const taskKey = isReranker ? 'reranking' : TASK_BACKEND_KEYS[taskId]
    const providers = providerList(task.category, taskKey)
    const models = task.provider ? modelList(task.provider, task.category, taskKey) : []
    const updateSelection = (field: 'provider' | 'model', value: string) => {
      if (isReranker) updateReranker(field, value)
      else updateTask(taskId, field, value)
    }
    const saved = isReranker ? savedConfigRef.current.reranker : savedConfigRef.current.taskMatrix.find((item) => item.taskId === taskId)
    const changed = saved?.provider !== task.provider || saved?.model !== task.model
    const testSelection: ModelRouteSelection = { provider: task.provider, model: task.model, capability: task.category }
    const testState = routeTests.routes[modelRouteTestKey(testSelection)]
    const testPending = testState?.status === 'queued' || testState?.status === 'running'
    return (
      <div key={taskId} className={cn('settings-model-row', isPrimary && 'is-primary', changed && 'is-changed')}>
        <div className="settings-model-task">
          <span className="settings-model-task-icon" data-task={taskId}><Icon className="h-5 w-5" aria-hidden /></span>
          <div className="settings-model-task-copy">
            <div className="settings-model-task-title">
              {task.label}
              {isPrimary && <span className="settings-model-primary-label">主模型</span>}
              {changed && <span className="settings-model-change-dot" title="未保存的更改"><span className="sr-only">未保存的更改</span></span>}
            </div>
            <p id={`model-task-help-${taskId}`}>{task.description}</p>
          </div>
        </div>
        <div className="settings-model-route-area">
          <div className="settings-model-route-line">
            <div className="settings-model-route" role="group" aria-label={`${task.label}路由`} aria-describedby={`model-task-help-${taskId}`}>
              <div className="settings-model-provider-wrap">
                <BrandSelect
                  name={`${taskId}-provider`}
                  value={task.provider}
                  onChange={(value) => updateSelection('provider', value)}
                  className="settings-model-provider"
                  ariaLabel={isReranker ? 'Reranker Provider' : `${task.label} Provider`}
                  disabled={providers.length === 0 || saving}
                  options={[
                    ...(task.provider && !providers.includes(task.provider)
                      ? [{ value: task.provider, label: `${PROVIDER_DISPLAY_NAMES[task.provider] ?? task.provider}（不可用）`, provider: task.provider, disabled: true }]
                      : []),
                    ...providers.map((provider) => ({ value: provider, label: PROVIDER_DISPLAY_NAMES[provider] ?? provider, provider })),
                  ]}
                />
              </div>
              <LogoModelSelect
                value={task.model}
                list={models}
                provider={task.provider}
                details={modelDetails}
                disabled={models.length === 0 || saving}
                onChange={(value) => updateSelection('model', value)}
                ariaLabel={`${isReranker ? 'Reranker 模型' : `${task.label}模型`}，当前模型：${modelDisplayName(task.model) || '无'}`}
                isActive={isActive}
                className="settings-model-selection"
              />
            </div>
            <button type="button" className="settings-model-test-button"
              aria-label={`${testState?.status === 'done' ? '重新测试' : '测试'}${task.label}连接`}
              aria-describedby={`${testHelpId} model-route-test-${taskId}`}
              disabled={testPending || !task.provider || !task.model}
              onClick={() => routeTests.test(testSelection)}>
              {testPending ? <RefreshCw size={14} className={testState?.status === 'running' ? 'animate-spin' : undefined} aria-hidden /> : <PlugZap size={14} aria-hidden />}
              {testState?.status === 'running' ? '测试中' : testState?.status === 'queued' ? '排队中' : testState?.status === 'done' ? '重测' : '测试'}
            </button>
          </div>
          <RouteTestFeedback id={`model-route-test-${taskId}`} state={testState} label={task.label} capability={task.category} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('settings-model-config', className)}>
      <span id={configStatusId} className="sr-only" aria-live="polite">{configStatusText}</span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{routeTests.lastResult && `${modelDisplayName(routeTests.lastResult.model)}，${CAPABILITY_LABELS[routeTests.lastResult.capability]}：${routeTests.lastResult.success ? routeTests.lastResult.details || routeTests.lastResult.message : routeTests.lastResult.message}`}</span>
      <div className="settings-model-card">
        <header className="settings-model-header">
          <div className="settings-model-title-line">
            <Route className="h-5 w-5" aria-hidden />
            <h2>模型路由</h2>
          </div>
          <div className="settings-model-catalog">
            <span className="settings-model-catalog-status" title={`${totalModelCount} 个候选模型 · 已同步 ${syncedModelCount} 个官方模型 · ${lastRefreshLabel}`}>
              <span aria-hidden />{syncedModelCount} 个官方模型
              <span className="settings-model-catalog-time">{lastRefreshLabel === '尚未同步' ? lastRefreshLabel : `${lastRefreshLabel} 更新`}</span>
            </span>
            {onRefreshCatalog && (
              <button
                type="button"
                className="settings-model-refresh"
                disabled={catalogRefreshing || saving}
                aria-label={catalogRefreshing ? '正在刷新官方模型目录' : '刷新官方模型目录'}
                aria-describedby={configStatusId}
                onClick={() => void onRefreshCatalog()}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', catalogRefreshing && 'animate-spin')} aria-hidden />
                {catalogRefreshing ? '同步中' : '刷新'}
              </button>
            )}
          </div>
        </header>

        <div className="settings-model-test-toolbar">
          <div><p className="settings-model-test-heading">连通性检查</p><p id={testHelpId} className="settings-model-test-help">测试当前选择，不保存；会产生少量模型调用。相同服务商、模型和能力共用结果。</p></div>
          <div className="settings-model-test-toolbar-actions">
            {batchActive && <button type="button" className="settings-model-test-button" disabled={!routeTests.batch?.queued} onClick={routeTests.stopQueued}><Square size={12} aria-hidden />停止排队</button>}
            <button type="button" className="settings-model-test-button is-batch" disabled={batchActive || !testSelections.some(route => route.provider && route.model)} onClick={routeTests.testAll}>
              {batchActive ? <RefreshCw size={14} className="animate-spin" aria-hidden /> : <PlugZap size={14} aria-hidden />}{batchActive ? '正在测试' : '测试全部'}
            </button>
          </div>
          <p className="settings-model-test-progress">{routeTests.batch && <>
            已检测 {routeTests.batch.completed}/{routeTests.batch.total} 项 · {routeTests.batch.succeeded} 项通过 · {routeTests.batch.failed} 项未通过{routeTests.batch.cancelled > 0 ? ` · ${routeTests.batch.cancelled} 项已取消` : ''}
            {routeTests.batch.running > 0 ? ` · ${routeTests.batch.running} 项进行中` : ''}
            {routeTests.batch.queued > 0 ? ` · ${routeTests.batch.queued} 项排队中` : ''}
            {routeTests.batch.stopped && routeTests.batch.running > 0 ? '。已停止排队，进行中的测试会继续。' : ''}
          </>}</p>
        </div>

        {(failedCatalogProviders.length > 0 || (hasChanges && invalidSelections.length > 0)) && (
          <div className="settings-model-notices" role="status">
            {failedCatalogProviders.length > 0 && <p><AlertCircle className="h-4 w-4" aria-hidden />{failedCatalogProviders.join('、')} 更新失败，仍可使用已有目录。</p>}
            {hasChanges && invalidSelections.length > 0 && <p><AlertCircle className="h-4 w-4" aria-hidden />目录已更新，请为{invalidSelections.join('、')}重新选择模型。</p>}
          </div>
        )}

        <div className="settings-model-body">
          {routeGroups.map((group) => (
            <section key={group.id} aria-labelledby={`settings-model-group-${group.id}`} className="settings-model-group" data-group={group.id}>
              <div className="settings-model-section-heading">
                <h3 id={`settings-model-group-${group.id}`}>{group.label}</h3>
                <div className="settings-model-column-labels" aria-hidden><span>服务商</span><span>模型</span></div>
              </div>
              {group.tasks.map(renderRoute)}
            </section>
          ))}
        </div>

        <footer className={cn('settings-model-actions', hasChanges && 'has-changes')}>
          <p className={cn(savedBrief && 'is-saved')}>
            {savedBrief ? <Check className="h-4 w-4" aria-hidden /> : hasChanges ? <AlertCircle className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {saving ? '正在保存模型路由…' : savedBrief ? '模型路由已保存' : hasChanges ? '有未保存的更改' : '当前配置已保存'}
          </p>
          <div className="settings-model-action-buttons">
            <Button
              variant="outline"
              className="settings-model-secondary"
              disabled={!hasChanges || saving}
              aria-label={hasChanges ? '重置模型配置为上次保存状态' : '当前没有可重置的模型配置更改'}
              aria-describedby={configStatusId}
              onClick={handleReset}
            ><RotateCcw className="mr-2 h-4 w-4" aria-hidden />撤销更改</Button>
            <Button
              className="settings-model-save"
              disabled={!hasChanges || saving}
              aria-label={saving ? '正在保存模型配置' : hasChanges ? '保存模型配置' : '当前没有可保存的模型配置更改'}
              aria-describedby={configStatusId}
              onClick={handleSave}
            >
              {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : savedBrief ? <Check className="mr-2 h-4 w-4" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}
              {saving ? '保存中…' : savedBrief ? '已保存' : '保存模型路由'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default ModelConfig
