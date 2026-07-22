import { useState, useEffect, useLayoutEffect, useRef, type ComponentType } from 'react'
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
    <div className={cn('flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400', className)}>
      {capabilities.map((capability) => {
        const meta = CAPABILITY_ICON_META[capability]
        const Icon = meta.icon
        return (
          <span
            key={capability}
            title={CAPABILITY_LABELS[capability]}
            aria-label={CAPABILITY_LABELS[capability]}
            className={cn('inline-flex h-8 w-8 items-center justify-center rounded-xl', meta.className)}
          >
            <Icon className="h-4 w-4" />
          </span>
        )
      })}
      {context && (
        <span
          title={`上下文约 ${detail.context_length?.toLocaleString()} tokens`}
          className="inline-flex h-8 items-center rounded-xl bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300"
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
        className={cn('rounded-md bg-transparent p-0 ring-0 dark:bg-transparent dark:ring-0', className)}
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
      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300', className)}>
        AI
      </span>
    )
  }

  return <img src={src} alt="" className={cn('h-6 w-6 shrink-0 rounded-md object-contain', className)} width={24} height={24} />
}

function LogoModelSelect({
  value,
  list,
  provider,
  disabled,
  onChange,
  className,
}: {
  value: string
  list: string[]
  provider: string
  disabled?: boolean
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const displayValue = value || list[0] || ''

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
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
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

  const menu =
    open && menuBox && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-900/15 dark:border-slate-700 dark:bg-slate-900"
            style={{
              top: menuBox.top,
              left: menuBox.left,
              width: menuBox.width,
              maxHeight: menuBox.maxHeight,
            }}
          >
            <ul role="listbox" className="space-y-0.5">
              {list.map((model) => {
                const active = model === value
                return (
                  <li key={model} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(model)
                        setOpen(false)
                      }}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                      )}
                    >
                      <span className="w-5 text-center text-base leading-none">{active ? '✓' : ''}</span>
                      <ModelLogo modelId={model} provider={provider} />
                      <span className="min-w-0 flex-1 truncate font-medium" title={model}>
                        {model}
                      </span>
                    </button>
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
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        className={cn(
          'relative flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white/95 py-2 pl-3 pr-10 text-left text-sm font-semibold text-slate-800 shadow-sm transition-all duration-200 hover:border-indigo-300 hover:shadow-md focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-fuchsia-500/50 dark:focus:border-fuchsia-500 dark:focus:ring-fuchsia-500/50'
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
  const { showSuccess, showError } = useToastStore()
  const modelDetails = availableModels?.model_details ?? {}
  const catalogStatus = availableModels?.catalog_status
  const syncedModelCount = Object.values(modelDetails).filter((detail) => detail.catalog_synced).length
  const totalModelCount = Object.keys(modelDetails).length
  const lastRefreshLabel = formatCatalogTime(catalogStatus?.last_refresh_finished_at)

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
      setTimeout(() => setSavedBrief(false), 2000)
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
    'relative flex h-10 w-full min-w-0 truncate rounded-xl border bg-white/95 dark:bg-slate-900/70 pl-3 pr-9 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500/50 dark:focus:ring-fuchsia-500/50 cursor-pointer border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-fuchsia-500/50 focus:border-indigo-400 dark:focus:border-fuchsia-500 appearance-none shadow-sm hover:shadow-md'

  return (
    <div className={cn('space-y-6 animate-in fade-in duration-300', className)}>
      <div className="overflow-hidden rounded-3xl border border-white/75 bg-white/84 shadow-lg shadow-slate-200/40 backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-950/80 dark:shadow-black/20">
        <header className="relative overflow-hidden border-b border-slate-100/80 bg-gradient-to-r from-slate-50/90 via-white/90 to-indigo-50/45 px-6 py-5 dark:border-slate-800/60 dark:from-slate-900/90 dark:via-slate-950/90 dark:to-indigo-950/25 sm:px-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-indigo-400/15 blur-3xl dark:bg-indigo-500/10" />
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="relative flex items-start gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/25">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <h2 className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-xl font-bold tracking-tight text-transparent dark:from-slate-50 dark:to-slate-300">
                  模块化模型配置
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm font-medium text-slate-500 dark:text-slate-400">
                  为各个链路步骤分别指定 Provider 与模型，保存后新的后端请求会立即使用最新配置
                </p>
              </div>
            </div>
            <div className="relative flex flex-wrap items-center gap-2.5 xl:justify-end">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300">
                官网同步：{syncedModelCount}/{totalModelCount || 0} · {lastRefreshLabel}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/80 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/45 dark:text-indigo-200">
                {matrix.length} 个任务链路
              </span>
              {hasChanges && (
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-200/60 bg-amber-100/90 px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-800/50 dark:bg-amber-900/50 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  未保存
                </span>
              )}
              {onRefreshCatalog && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl border border-sky-200 text-sky-700 shadow-sm transition-all duration-200 hover:border-sky-300 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:hover:border-sky-700 dark:hover:bg-sky-950/30 disabled:opacity-40"
                  disabled={catalogRefreshing || saving}
                  onClick={() => void onRefreshCatalog()}
                >
                  <RefreshCw className={cn('mr-2 h-4 w-4', catalogRefreshing && 'animate-spin')} />
                  {catalogRefreshing ? '同步中…' : '刷新官网目录'}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border border-slate-300 text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800 disabled:opacity-40"
                disabled={!hasChanges || saving}
                onClick={handleReset}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                重置
              </Button>
              <Button
                size="sm"
                className="rounded-xl border-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 font-semibold text-white shadow-md shadow-indigo-500/25 transition-all duration-200 hover:from-indigo-500 hover:via-purple-500 hover:to-fuchsia-500 hover:shadow-lg hover:shadow-indigo-500/35 disabled:opacity-50"
                disabled={!hasChanges || saving}
                onClick={handleSave}
              >
                {saving ? (
                  <>
                    <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    保存中…
                  </>
                ) : savedBrief ? (
                  <>
                    已保存
                    <Check className="ml-2 h-4 w-4 text-emerald-200" />
                  </>
                ) : (
                  <>
                    保存
                    <Save className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </header>

        <div className="space-y-8 p-5 sm:p-8">
          <div className="flex items-start gap-3 rounded-2xl border border-sky-200/70 bg-gradient-to-r from-sky-50/90 to-indigo-50/60 px-4 py-3 text-sm leading-relaxed text-sky-900 shadow-sm dark:border-sky-900/50 dark:from-sky-950/30 dark:to-indigo-950/20 dark:text-sky-100">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500 shadow-sm shadow-sky-500/40" />
            <span>模型列表来自后端已配置 Provider 的官方模型目录与本地注册表合并结果；任务下拉会按模型能力自动过滤与排序，保存后直接更新运行中的任务路由。</span>
          </div>

          <section className="animate-in slide-up duration-500">
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-flex h-10 w-1.5 rounded-full bg-gradient-to-b from-indigo-500 via-purple-500 to-fuchsia-500 shadow-sm" />
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                任务 - 模型映射
              </h3>
            </div>
            <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-50/90 to-white/80 p-3 shadow-sm dark:border-slate-700/70 dark:from-slate-900/50 dark:to-slate-950/80 sm:p-4">
              <div className="hidden grid-cols-[minmax(0,0.72fr)_minmax(9.5rem,0.62fr)_minmax(0,2.35fr)] gap-4 rounded-xl border border-slate-200/80 bg-slate-100/80 px-5 py-3 text-xs font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300 lg:grid">
                <div>任务</div>
                <div>Provider</div>
                <div>模型</div>
              </div>

              {matrix.map((task, index) => {
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
                      'group relative overflow-visible rounded-2xl border border-slate-200/70 bg-white/84 p-3.5 shadow-sm transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-slate-700/70 dark:bg-slate-950/55 dark:hover:shadow-black/30',
                      meta.isPrimary
                        ? 'border-indigo-200/80 bg-gradient-to-r from-indigo-50/90 to-violet-50/60 dark:border-indigo-800/60 dark:from-indigo-950/40 dark:to-violet-950/20'
                        : index % 2 === 0
                          ? 'hover:border-indigo-200/70 hover:bg-slate-50/95 dark:hover:border-indigo-800/40 dark:hover:bg-slate-900/60'
                          : 'bg-slate-50/60 hover:border-indigo-200/70 hover:bg-slate-50/95 dark:bg-slate-900/25 dark:hover:border-indigo-800/40 dark:hover:bg-slate-900/60'
                    )}
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.72fr)_minmax(9.5rem,0.62fr)_minmax(0,2.35fr)] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-4">
                          <span className={cn('absolute inset-y-3.5 left-0 w-1 rounded-r-full', meta.barClass)} />
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 text-slate-600 shadow-sm ring-1 ring-white/70 transition-all duration-200 group-hover:scale-105 group-hover:shadow-md dark:from-slate-800 dark:to-slate-900 dark:text-slate-400 dark:ring-slate-700/70">
                            <Icon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2.5 font-semibold text-slate-800 dark:text-slate-100">
                              <span>{task.label}</span>
                              {meta.isPrimary && (
                                <span className="rounded-lg border border-indigo-200/50 bg-gradient-to-r from-indigo-100 to-purple-100 px-2.5 py-1 text-xs font-bold text-indigo-700 shadow-sm dark:border-indigo-800/50 dark:from-indigo-900/60 dark:to-purple-900/60 dark:text-indigo-300">
                                  主模型
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 lg:hidden">
                          Provider
                        </div>
                        <div className="relative">
                          <select
                            value={task.provider}
                            onChange={(e) => updateTask(task.taskId, 'provider', e.target.value)}
                            className={selectBase}
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
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 lg:hidden">
                          模型
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <LogoModelSelect
                            value={task.model}
                            list={models}
                            provider={task.provider}
                            disabled={models.length === 0}
                            onChange={(value) => updateTask(task.taskId, 'model', value)}
                            className="min-w-0 flex-1 lg:w-[clamp(16rem,30vw,24rem)] lg:flex-none"
                          />
                          <ModelMetaLine detail={selectedDetail} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="animate-in slide-up duration-500 delay-100">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600 shadow-sm border border-emerald-200/50 dark:from-emerald-900/40 dark:to-teal-900/40 dark:text-emerald-400 dark:border-emerald-800/50">
                  <ArrowDownUp className="h-5 w-5" />
                </div>
                <span className="inline-flex h-10 w-1.5 rounded-full bg-gradient-to-b from-emerald-400 via-teal-400 to-emerald-500 shadow-sm dark:from-emerald-500 dark:via-teal-500 dark:to-emerald-600" />
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                    Reranker 模型
                  </h3>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200/60 shadow-sm dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-300 dark:border-emerald-800/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    检索结果排序用
                  </span>
                </div>
              </div>
            </div>
            <div className="relative overflow-visible rounded-2xl border border-emerald-200/50 bg-gradient-to-br from-emerald-50/60 via-white/90 to-teal-50/40 p-6 shadow-sm dark:border-emerald-800/40 dark:from-emerald-950/30 dark:via-slate-950/80 dark:to-teal-950/20">
              <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-emerald-300/15 blur-3xl dark:bg-emerald-600/10" />
              <div className="grid gap-6 lg:grid-cols-[minmax(9.5rem,0.42fr)_minmax(0,1.58fr)]">
                <div className="relative min-w-0 space-y-2.5">
                  <Label className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                    Provider
                  </Label>
                  <div className="relative">
                    <select
                      value={reranker.provider}
                      onChange={(e) => updateReranker('provider', e.target.value)}
                      className={cn(selectBase, 'border-emerald-200/60 dark:border-emerald-800/60 hover:border-emerald-300 dark:hover:border-emerald-700/60 focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-emerald-500/50 dark:focus:ring-emerald-500/50')}
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
                <div className="relative min-w-0 space-y-2.5">
                  <Label className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                    模型
                  </Label>
                  <div className="flex min-w-0 items-center gap-2">
                    <LogoModelSelect
                      value={reranker.model}
                      list={rerankerModels}
                      provider={reranker.provider}
                      disabled={rerankerModels.length === 0}
                      onChange={(value) => updateReranker('model', value)}
                      className="min-w-0 flex-1 lg:w-[clamp(16rem,30vw,24rem)] lg:flex-none"
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
