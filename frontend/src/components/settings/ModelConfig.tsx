import { useState, useEffect, useId, useLayoutEffect, useRef, type ComponentType } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Save, RotateCcw, Settings, AlertCircle, Brain, Image, MessageSquare, ArrowDownUp, Check, ChevronDown, Route, Mic, Film, BookText, Database, RefreshCw, Type } from 'lucide-react'
import { useToastStore } from '@/store/useToastStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { AvailableModels, AvailableModelType, ModelCatalogDetail } from '@/store/useConfigStore'
import { getModelProvider, getModelVendor, PROVIDER_LOGOS, VENDOR_LOGOS } from '@/lib/modelVendors'
import { OpenRouterModelBrandIcon } from '@/components/chat/OpenRouterModelBrandIcon'

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

const CAPABILITY_ICON_META: Record<AvailableModelType, { icon: ComponentType<{ className?: string }>; className: string }> = {
  chat: { icon: Type, className: 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300' },
  embedding: { icon: BookText, className: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300' },
  vision: { icon: Image, className: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300' },
  reranker: { icon: ArrowDownUp, className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300' },
  audio: { icon: Mic, className: 'bg-violet-100 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300' },
  video: { icon: Film, className: 'bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300' },
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
    chat: [],
  },
  openrouter: {
    chat: ['openrouter:google/gemini-2.5-flash'],
    vision: ['openrouter:google/gemini-2.5-flash'],
    audio: ['openrouter:google/gemini-2.5-flash'],
    video: ['openrouter:google/gemini-2.5-flash'],
  },
  aliyun_bailian: {
    chat: ['aliyun_bailian:qwen3.5-plus'],
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
    provider: 'aliyun_bailian',
    model: 'aliyun_bailian:qwen3.5-plus',
  },
  {
    taskId: 'rewrite',
    label: '查询改写',
    description: '补全检索表达、扩展召回线索',
    category: 'chat',
    provider: 'siliconflow',
    model: 'Qwen/Qwen3.5-397B-A17B',
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
    provider: 'siliconflow',
    model: 'Pro/moonshotai/Kimi-K2.6',
  },
  {
    taskId: 'generation',
    label: '回答生成',
    description: '最终回答生成与流式输出',
    category: 'chat',
    provider: 'siliconflow',
    model: 'Pro/moonshotai/Kimi-K2.6',
  },
]

const DEFAULT_RERANK = {
  provider: 'siliconflow',
  model: 'Qwen/Qwen3-Reranker-8B',
}

const TASK_META: Record<TaskId, { icon: ComponentType<{ className?: string }>; barClass: string; isPrimary?: boolean }> = {
  intent: { icon: Brain, barClass: 'bg-blue-400/80 dark:bg-blue-500/80' },
  rewrite: { icon: Route, barClass: 'bg-cyan-400/80 dark:bg-cyan-500/80' },
  embedding: { icon: Database, barClass: 'bg-teal-400/80 dark:bg-teal-500/80' },
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

function ModelMetaLine({ detail, className }: { detail?: ModelCatalogDetail; className?: string }) {
  if (!detail) return null
  const capabilities = (detail.capabilities ?? []).filter((item): item is AvailableModelType => item in CAPABILITY_ICON_META)
  const context = formatTokenCount(detail.context_length)
  return (
    <div className={cn('flex max-w-full flex-wrap items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400', className)}>
      {capabilities.map((capability) => {
        const meta = CAPABILITY_ICON_META[capability]
        const Icon = meta.icon
        return (
          <span
            key={capability}
            title={CAPABILITY_LABELS[capability]}
            aria-label={CAPABILITY_LABELS[capability]}
            className={cn('inline-flex h-7 w-7 items-center justify-center rounded-[6px]', meta.className)}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
        )
      })}
      {context && (
        <span
          title={`上下文约 ${detail.context_length?.toLocaleString()} tokens`}
          className="inline-flex h-7 items-center rounded-[6px] bg-slate-100 px-2 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300"
        >
          {context} ctx
        </span>
      )}
    </div>
  )
}

function ModelLogo({ modelId, provider, className }: { modelId: string; provider?: string; className?: string }) {
  if (modelId.startsWith('openrouter:')) {
    return (
      <OpenRouterModelBrandIcon
        modelId={modelId.slice('openrouter:'.length)}
        size={24}
        className={cn('rounded-[6px] bg-transparent p-0 ring-0 dark:bg-transparent dark:ring-0', className)}
        ariaHidden
      />
    )
  }

  const vendor = getModelVendor(modelId)
  const vendorLogo = VENDOR_LOGOS[vendor]
  const providerKey = getModelProvider(modelId)
  const providerLogo = providerKey ? PROVIDER_LOGOS[providerKey] : undefined
  const src = vendorLogo ?? providerLogo ?? (provider === 'aliyun_bailian' ? PROVIDER_LOGOS.AliyunBailian : undefined)

  if (!src) {
    return (
      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300', className)} aria-hidden>
        AI
      </span>
    )
  }

  return <img src={src} alt="" className={cn('h-6 w-6 shrink-0 rounded-[6px] object-contain', className)} width={24} height={24} aria-hidden />
}

function LogoModelSelect({
  value,
  list,
  provider,
  disabled,
  onChange,
  className,
  ariaLabel,
}: {
  value: string
  list: string[]
  provider: string
  disabled?: boolean
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const generatedId = useId().replace(/:/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLLIElement | null>>([])
  const focusOnOpenRef = useRef<number | null>(null)
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const displayValue = value || list[0] || ''
  const listboxId = `${generatedId}-settings-model-listbox`
  const activeOptionId = open && list.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined
  const selectLabel = displayValue
    ? `选择模型，当前模型：${displayValue}，共 ${list.length} 个候选`
    : `选择模型，当前无可用模型，共 ${list.length} 个候选`

  const getSelectedIndex = () => Math.max(0, list.findIndex((model) => model === value))

  const focusOption = (idx: number) => {
    if (list.length === 0) return
    const boundedIdx = Math.max(0, Math.min(idx, list.length - 1))
    setActiveIndex(boundedIdx)
    requestAnimationFrame(() => {
      optionRefs.current[boundedIdx]?.focus()
      optionRefs.current[boundedIdx]?.scrollIntoView({ block: 'nearest' })
    })
  }

  const openMenu = (options?: { focus?: boolean; index?: number }) => {
    if (disabled || list.length === 0) return
    const nextIndex = Math.max(0, Math.min(options?.index ?? getSelectedIndex(), list.length - 1))
    setActiveIndex(nextIndex)
    focusOnOpenRef.current = options?.focus ? nextIndex : null
    setOpen(true)
  }

  const closeMenu = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) {
      requestAnimationFrame(() => buttonRef.current?.focus())
    }
  }

  const selectModel = (model: string, restoreFocus = false) => {
    onChange(model)
    closeMenu(restoreFocus)
  }

  const updateMenuBox = () => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const viewportPadding = 16
    const maxWidth = Math.max(240, window.innerWidth - viewportPadding * 2)
    const width = Math.min(544, maxWidth, Math.max(rect.width, 320))
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    )
    const top = rect.bottom + 8
    const maxHeight = Math.max(180, window.innerHeight - top - viewportPadding)
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
    optionRefs.current = optionRefs.current.slice(0, list.length)
  }, [list.length])

  useEffect(() => {
    if (!open || !menuBox || list.length === 0) return
    const pendingFocusIndex = focusOnOpenRef.current
    const nextIndex = Math.max(0, Math.min(pendingFocusIndex ?? getSelectedIndex(), list.length - 1))
    setActiveIndex(nextIndex)
    requestAnimationFrame(() => {
      const option = optionRefs.current[nextIndex]
      if (pendingFocusIndex !== null) option?.focus()
      option?.scrollIntoView({ block: 'nearest' })
      focusOnOpenRef.current = null
    })
  }, [open, menuBox, list, value])

  const handleButtonClick = () => {
    if (open) {
      closeMenu()
      return
    }
    openMenu()
  }

  const handleButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || list.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMenu({ focus: true, index: getSelectedIndex() })
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'End') {
      event.preventDefault()
      openMenu({ focus: true, index: list.length - 1 })
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      openMenu({ focus: true, index: 0 })
    }
  }

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>, idx: number) => {
    if (list.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption((idx + 1) % list.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption((idx - 1 + list.length) % list.length)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusOption(list.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const model = list[idx]
      if (model) selectModel(model, true)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
    }
  }

  const menu =
    open && menuBox && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000] overflow-y-auto rounded-[8px] border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/15 dark:border-slate-700 dark:bg-slate-900"
            style={{
              top: menuBox.top,
              left: menuBox.left,
              width: menuBox.width,
              maxHeight: menuBox.maxHeight,
            }}
          >
            <ul
              id={listboxId}
              role="listbox"
              aria-label={`模型列表，共 ${list.length} 个候选`}
              aria-activedescendant={activeOptionId}
              className="space-y-0.5"
            >
              {list.map((model, idx) => {
                const active = model === value
                const focused = idx === activeIndex
                return (
                  <li
                    key={model}
                    ref={(node) => {
                      optionRefs.current[idx] = node
                    }}
                    id={`${listboxId}-option-${idx}`}
                    role="option"
                    aria-selected={active}
                    tabIndex={focused ? 0 : -1}
                    onClick={() => selectModel(model)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onKeyDown={(event) => handleOptionKeyDown(event, idx)}
                    className={cn(
                      'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/40',
                      active
                        ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800',
                      focused && !active
                        ? 'bg-slate-50 ring-1 ring-inset ring-indigo-200 dark:bg-slate-800 dark:ring-indigo-500/30'
                        : undefined
                    )}
                  >
                    <span className="w-5 text-center text-base leading-none">{active ? '✓' : ''}</span>
                    <ModelLogo modelId={model} provider={provider} />
                    <span className="min-w-0 flex-1 truncate font-medium" title={model}>
                      {model}
                    </span>
                  </li>
                )
              })}
            </ul>
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
        title={displayValue || '当前无可用模型'}
        aria-label={ariaLabel ?? selectLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={handleButtonClick}
        onKeyDown={handleButtonKeyDown}
        className={cn(
          'relative flex h-10 w-full min-w-0 items-center gap-2 rounded-[6px] border border-slate-300 bg-white py-2 pl-3 pr-10 text-left text-sm font-medium text-slate-800 shadow-sm transition-colors hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20'
        )}
      >
        {displayValue ? <ModelLogo modelId={displayValue} provider={provider} /> : null}
        <span className="min-w-0 flex-1 truncate">{displayValue || '当前无可用模型'}</span>
        <ChevronDown className={cn('pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-transform dark:text-slate-400', open && 'rotate-180')} />
      </button>
      {menu}
    </div>
  )
}

export function ModelConfig({
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
  const { showSuccess, showError } = useToastStore()
  const modelDetails = availableModels?.model_details ?? {}
  const catalogStatus = availableModels?.catalog_status
  const syncedModelCount = Object.values(modelDetails).filter((detail) => detail.catalog_synced).length
  const totalModelCount = Object.keys(modelDetails).length
  const lastRefreshLabel = formatCatalogTime(catalogStatus?.last_refresh_finished_at)
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
    if (initialConfig?.taskMatrix) setMatrix(initialConfig.taskMatrix)
    if (initialConfig?.reranker) setReranker(initialConfig.reranker)
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

  const updateTask = (taskId: TaskId, field: 'provider' | 'model', value: string) => {
    setMatrix((prev) =>
      prev.map((task) => {
        if (task.taskId !== taskId) return task
        if (field === 'provider') {
          const nextModels = modelList(value, task.category, TASK_BACKEND_KEYS[task.taskId])
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
        const nextModels = modelList(value, 'reranker', 'reranking')
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
    if (!window.confirm('将恢复为上次保存的配置，是否继续？')) return
    setMatrix(initialConfig?.taskMatrix ?? DEFAULT_MATRIX)
    setReranker(initialConfig?.reranker ?? DEFAULT_RERANK)
    setHasChanges(false)
  }

  const rerankerProviders = providerList('reranker', 'reranking')
  const rerankerModels = reranker.provider ? modelList(reranker.provider, 'reranker', 'reranking') : []

  const selectBase =
    'relative flex h-10 w-full min-w-0 cursor-pointer appearance-none truncate rounded-[6px] border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20'

  return (
    <div className={cn('animate-in fade-in duration-300', className)}>
      <span id={configStatusId} className="sr-only" aria-live="polite">
        {configStatusText}
      </span>
      <div className="rounded-[8px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <header className="sticky top-0 z-20 rounded-t-[8px] border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <Settings className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-950 dark:text-white">模型路由</h2>
                  {hasChanges && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      <AlertCircle className="h-3 w-3" aria-hidden />
                      未保存
                    </span>
                  )}
                </div>
                <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 dark:text-slate-400">
                  为每个任务步骤指定 Provider 与模型，保存后用于新的请求。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {onRefreshCatalog && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-[6px] border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                  disabled={catalogRefreshing || saving}
                  aria-label={catalogRefreshing ? '正在刷新官方模型目录' : '刷新官方模型目录'}
                  aria-describedby={configStatusId}
                  onClick={() => void onRefreshCatalog()}
                >
                  <RefreshCw className={cn('mr-2 h-4 w-4', catalogRefreshing && 'animate-spin')} aria-hidden />
                  {catalogRefreshing ? '同步中' : '刷新目录'}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-[6px] border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                disabled={!hasChanges || saving}
                aria-label={hasChanges ? '重置模型配置为上次保存状态' : '当前没有可重置的模型配置更改'}
                aria-describedby={configStatusId}
                onClick={handleReset}
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                重置
              </Button>
              <Button
                size="sm"
                className="rounded-[6px] bg-indigo-600 font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:ring-indigo-500"
                disabled={!hasChanges || saving}
                aria-label={saving ? '正在保存模型配置' : hasChanges ? '保存模型配置' : '当前没有可保存的模型配置更改'}
                aria-describedby={configStatusId}
                onClick={handleSave}
              >
                {saving ? (
                  <>
                    <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
                    保存中…
                  </>
                ) : savedBrief ? (
                  <>
                    已保存
                    <Check className="ml-2 h-4 w-4 text-emerald-200" aria-hidden />
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" aria-hidden />
                    保存模型路由
                  </>
                )}
              </Button>
            </div>
          </div>
        </header>

        <div className="space-y-7 p-5 sm:p-6">
          <div className="flex flex-col gap-3 rounded-[6px] border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900/50">
            <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
              候选模型会按任务能力自动过滤；目录合并官方数据与本地注册表。
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{syncedModelCount}/{totalModelCount || 0}</span>
                {' '}官网同步
              </span>
              <span>更新于 {lastRefreshLabel}</span>
            </div>
          </div>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950 dark:text-white">任务模型映射</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">沿着处理链路，为每一步选择最合适的模型。</p>
              </div>
              <span className="shrink-0 font-mono text-xs font-semibold text-slate-400 dark:text-slate-500">
                {matrix.length} STEPS
              </span>
            </div>
            <div className="overflow-hidden rounded-[8px] border border-slate-200 dark:border-slate-800">
              <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(8.5rem,0.65fr)_minmax(0,1.7fr)] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 lg:grid">
                <div>任务</div>
                <div>Provider</div>
                <div>模型</div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {matrix.map((task) => {
                const meta = TASK_META[task.taskId]
                const Icon = meta.icon
                const taskKey = TASK_BACKEND_KEYS[task.taskId]
                const providers = providerList(task.category, taskKey)
                const models = task.provider ? modelList(task.provider, task.category, taskKey) : []
                const selectedDetail = modelDetails[task.model]

                return (
                  <div
                    key={task.taskId}
                    className={cn(
                      'group relative bg-white px-4 py-4 transition-colors hover:bg-slate-50/80 dark:bg-slate-950 dark:hover:bg-slate-900/45',
                      meta.isPrimary
                        ? 'bg-indigo-50/45 hover:bg-indigo-50/70 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/30'
                        : undefined
                    )}
                  >
                    <span className={cn('absolute inset-y-3 left-0 w-1 rounded-r-full', meta.barClass)} aria-hidden />
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(8.5rem,0.65fr)_minmax(0,1.7fr)] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-slate-200 bg-white text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            <Icon className="h-[18px] w-[18px]" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                              <span>{task.label}</span>
                              {meta.isPrimary && (
                                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                                  主模型
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-[11px] leading-4 text-slate-500 dark:text-slate-400" title={task.description}>
                              {task.description}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 lg:hidden">
                          Provider
                        </div>
                        <div className="relative">
                          <select
                            value={task.provider}
                            onChange={(e) => updateTask(task.taskId, 'provider', e.target.value)}
                            className={selectBase}
                            aria-label={`${task.label} Provider`}
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
                        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 lg:hidden">
                          模型
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <LogoModelSelect
                            value={task.model}
                            list={models}
                            provider={task.provider}
                            disabled={models.length === 0}
                            onChange={(value) => updateTask(task.taskId, 'model', value)}
                            ariaLabel={`${task.label}模型，当前模型：${task.model || '无'}`}
                            className="w-full min-w-0 flex-none sm:min-w-[12rem] sm:flex-1"
                          />
                          <ModelMetaLine detail={selectedDetail} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-300">
                <ArrowDownUp className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Reranker</h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">对召回结果重新排序，提高最终上下文的相关性。</p>
              </div>
            </div>
            <div className="rounded-[8px] border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/35">
              <div className="grid gap-4 lg:grid-cols-[minmax(8.5rem,0.65fr)_minmax(0,1.7fr)]">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                    Provider
                  </Label>
                  <div className="relative">
                    <select
                      value={reranker.provider}
                      onChange={(e) => updateReranker('provider', e.target.value)}
                      className={selectBase}
                      aria-label="Reranker Provider"
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
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                    模型
                  </Label>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <LogoModelSelect
                      value={reranker.model}
                      list={rerankerModels}
                      provider={reranker.provider}
                      disabled={rerankerModels.length === 0}
                      onChange={(value) => updateReranker('model', value)}
                      ariaLabel={`Reranker 模型，当前模型：${reranker.model || '无'}`}
                      className="w-full min-w-0 flex-none sm:min-w-[12rem] sm:flex-1"
                    />
                    <ModelMetaLine detail={modelDetails[reranker.model]} />
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
