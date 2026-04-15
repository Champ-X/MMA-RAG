import { useState, useEffect, useMemo } from 'react'
import { Search, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { systemApi } from '@/services/api_client'
import { cn } from '@/lib/utils'
import { PROVIDER_LOGOS } from '@/lib/modelVendors'
import { OpenRouterModelBrandIcon } from './OpenRouterModelBrandIcon'

export type OpenRouterCatalogItem = {
  id: string
  registry_id: string
  name?: string
  context_length?: number
  modality?: string
  input_modalities?: string[]
  output_modalities?: string[]
}

type CatalogResponse = {
  openrouter_configured?: boolean
  model_count?: number
  models: OpenRouterCatalogItem[]
  error?: string
  source?: string
}

const LIST_LIMIT = 50

const listScrollClass = cn(
  'overflow-y-auto overscroll-contain',
  '[scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]',
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:bg-slate-300/90 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600'
)

function toRegistryId(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  const body = t.startsWith('openrouter:') ? t.slice('openrouter:'.length).trim() : t
  if (!body) return ''
  return `openrouter:${body}`
}

interface OpenRouterModelSearchProps {
  enabled: boolean
  currentChatModel: string
  onSelect: (registryId: string) => void
  className?: string
}

export function OpenRouterModelSearch({
  enabled,
  currentChatModel,
  onSelect,
  className,
}: OpenRouterModelSearchProps) {
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<OpenRouterCatalogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(true)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setFetchError(null)
    systemApi
      .getOpenRouterModels()
      .then((data: CatalogResponse) => {
        if (cancelled) return
        setConfigured(Boolean(data.openrouter_configured))
        if (data.error) {
          setFetchError(data.error)
          setCatalog(Array.isArray(data.models) ? data.models : [])
        } else {
          setCatalog(Array.isArray(data.models) ? data.models : [])
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setFetchError(e instanceof Error ? e.message : '加载失败')
        setCatalog([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog.slice(0, LIST_LIMIT)
    return catalog
      .filter(m => {
        const id = (m.id || '').toLowerCase()
        const name = (m.name || '').toLowerCase()
        return id.includes(q) || name.includes(q)
      })
      .slice(0, LIST_LIMIT)
  }, [catalog, query])

  const matchCount = filtered.length
  const isCurrentOpenRouter = currentChatModel.startsWith('openrouter:')
  const selectionDisabled = !configured

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* 与 Qwen / ChatGPT 等一致：标题在卡片外 */}
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <img
          src={PROVIDER_LOGOS.OpenRouter}
          alt=""
          className="h-5 w-5 rounded object-contain"
          width={20}
          height={20}
        />
        <span>OpenRouter</span>
        {isCurrentOpenRouter && (
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-normal text-indigo-600 dark:text-indigo-400">
            当前使用
          </span>
        )}
      </label>

      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3 shadow-sm dark:border-slate-600/60 dark:bg-slate-900/40">
        {!configured && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200/60 bg-amber-50/90 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-950/40 dark:text-amber-100">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <span>未配置 OPENROUTER_API_KEY，已禁用 OpenRouter 模型选择。</span>
          </div>
        )}

        {fetchError && (
          <p className="mb-3 rounded-xl border border-red-200/70 bg-red-50/80 px-3 py-2 text-[11px] text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
            目录加载失败：{fetchError}
          </p>
        )}

        {!loading && catalog.length === 0 && !fetchError && (
          <p className="mb-3 text-center text-[11px] text-slate-500 dark:text-slate-400">未获取到模型列表</p>
        )}

        <p className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">搜索模型</p>
        <div
          className={cn(
            'group relative mb-3 rounded-xl border-2 border-slate-200/90 bg-white shadow-sm transition-all duration-200',
            'focus-within:border-indigo-400/80 focus-within:shadow-md focus-within:ring-2 focus-within:ring-indigo-500/15',
            'dark:border-slate-600 dark:bg-slate-800/95 dark:focus-within:border-indigo-500/55 dark:focus-within:ring-indigo-500/20',
            (loading && catalog.length === 0) || selectionDisabled ? 'opacity-70' : undefined
          )}
        >
          <Search
            className={cn(
              'pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors',
              'text-slate-400 group-focus-within:text-indigo-500 dark:text-slate-500 dark:group-focus-within:text-indigo-400'
            )}
            aria-hidden
          />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={
              selectionDisabled
                ? '配置 OPENROUTER_API_KEY 后可搜索并选择模型'
                : loading && catalog.length === 0
                  ? '加载目录中…'
                  : '输入模型 id 或展示名称…'
            }
            disabled={selectionDisabled || (loading && catalog.length === 0)}
            className={cn(
              'h-11 border-0 bg-transparent pl-10 pr-3 text-sm shadow-none',
              'placeholder:text-slate-400 dark:placeholder:text-slate-500',
              'focus-visible:ring-0 focus-visible:ring-offset-0'
            )}
            aria-label="搜索 OpenRouter 模型"
          />
        </div>

        {!selectionDisabled && !loading && catalog.length > 0 && (
          <>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
              匹配结果（{matchCount} / 最多 {LIST_LIMIT} 条）
            </p>
            <div
              className={cn(
                listScrollClass,
                'max-h-[8rem] rounded-xl border-2 border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800/80'
              )}
            >
              <ul className="divide-y divide-slate-100 py-0.5 dark:divide-slate-700/80" role="listbox">
                {matchCount === 0 ? (
                  <li className="px-4 py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    无匹配结果，请调整上方搜索关键词
                  </li>
                ) : (
                  filtered.map(m => {
                    const reg = m.registry_id || toRegistryId(m.id)
                    const active = currentChatModel === reg
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            if (!selectionDisabled) onSelect(reg)
                          }}
                          disabled={selectionDisabled}
                          className={cn(
                            'flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition-colors',
                            active
                              ? 'bg-indigo-50/90 dark:bg-indigo-950/50'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/50',
                            selectionDisabled && 'cursor-not-allowed opacity-60'
                          )}
                        >
                          <OpenRouterModelBrandIcon modelId={m.id} size={26} className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block font-mono text-[12px] font-semibold leading-tight',
                                active ? 'text-indigo-800 dark:text-indigo-200' : 'text-slate-800 dark:text-slate-100'
                              )}
                            >
                              {m.id}
                            </span>
                            {(m.name || typeof m.context_length === 'number') && (
                              <span className="line-clamp-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                {m.name}
                                {m.name && typeof m.context_length === 'number' && (
                                  <span className="text-slate-400 dark:text-slate-500"> · </span>
                                )}
                                {typeof m.context_length === 'number' && (
                                  <span className="text-slate-400 dark:text-slate-500">
                                    上下文约 {m.context_length.toLocaleString()} tokens
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            </div>
          </>
        )}

        {selectionDisabled && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            当前仅展示 OpenRouter 入口说明；配置完成后才会开放搜索与点选。
          </p>
        )}
      </div>
    </div>
  )
}
