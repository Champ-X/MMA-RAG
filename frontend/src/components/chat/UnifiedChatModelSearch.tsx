import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getModelProvider, PROVIDER_LOGOS, type ProviderKey } from '@/lib/modelVendors'
import { OpenRouterModelBrandIcon } from './OpenRouterModelBrandIcon'

export type ChatCatalogItem = {
  registry_id: string
  provider: string
  id: string
  name?: string
  context_length?: number
}

const LIST_LIMIT = 50

const listScrollClass = cn(
  'overflow-y-auto overscroll-contain',
  '[scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]',
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:bg-slate-300/90 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600'
)

function providerLabel(provider: string): string {
  const m: Record<string, string> = {
    siliconflow: 'SiliconFlow',
    deepseek: 'DeepSeek',
    openrouter: 'OpenRouter',
    aliyun_bailian: '阿里云百炼',
  }
  return m[provider] ?? provider
}

function CatalogRowIcon({ item }: { item: ChatCatalogItem }) {
  if (item.provider === 'openrouter') {
    return <OpenRouterModelBrandIcon modelId={item.id} size={26} className="mt-0.5" ariaHidden />
  }
  const pk: ProviderKey = getModelProvider(item.registry_id)
  const src = pk ? PROVIDER_LOGOS[pk] : undefined
  if (src) {
    return <img src={src} alt="" className="mt-0.5 h-[26px] w-[26px] rounded object-contain" width={26} height={26} aria-hidden />
  }
  return <div className="mt-0.5 h-[26px] w-[26px] rounded bg-slate-200/80 dark:bg-slate-600/80" aria-hidden />
}

interface UnifiedChatModelSearchProps {
  catalog: ChatCatalogItem[]
  loading: boolean
  fetchError?: string | null
  currentChatModel: string
  onSelect: (registryId: string) => void
  className?: string
}

export function UnifiedChatModelSearch({
  catalog,
  loading,
  fetchError,
  currentChatModel,
  onSelect,
  className,
}: UnifiedChatModelSearchProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog.slice(0, LIST_LIMIT)
    return catalog
      .filter(m => {
        const id = (m.id || '').toLowerCase()
        const rid = (m.registry_id || '').toLowerCase()
        const name = (m.name || '').toLowerCase()
        const prov = (m.provider || '').toLowerCase()
        return id.includes(q) || rid.includes(q) || name.includes(q) || prov.includes(q)
      })
      .slice(0, LIST_LIMIT)
  }, [catalog, query])

  const matchCount = filtered.length
  const disabled = loading && catalog.length === 0
  const listboxId = 'chat-model-search-results'
  const activeOptionId = matchCount > 0 ? `${listboxId}-option-${activeIndex}` : undefined

  useEffect(() => {
    setActiveIndex(0)
  }, [query, matchCount])

  const focusOption = (idx: number) => {
    if (matchCount === 0) return
    const boundedIdx = Math.max(0, Math.min(idx, matchCount - 1))
    setActiveIndex(boundedIdx)
    requestAnimationFrame(() => optionRefs.current[boundedIdx]?.scrollIntoView({ block: 'nearest' }))
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (matchCount === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption((activeIndex + 1) % matchCount)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption((activeIndex - 1 + matchCount) % matchCount)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusOption(matchCount - 1)
      return
    }
    if (event.key === 'Enter') {
      const target = filtered[activeIndex]
      if (!target) return
      event.preventDefault()
      onSelect(target.registry_id)
      return
    }
    if (event.key === 'Escape') {
      setActiveIndex(0)
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <Search className="h-4 w-4 text-indigo-500 dark:text-indigo-400" aria-hidden />
        <span>搜索对话模型（已配置 API Key 的供应商）</span>
      </label>

      <div
        className={cn(
          'group relative rounded-xl border-2 border-slate-200/90 bg-white shadow-sm transition-all duration-200',
          'focus-within:border-indigo-400/80 focus-within:shadow-md focus-within:ring-2 focus-within:ring-indigo-500/15',
          'dark:border-slate-600 dark:bg-slate-800/95 dark:focus-within:border-indigo-500/55 dark:focus-within:ring-indigo-500/20',
          disabled ? 'opacity-70' : undefined
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
          onKeyDown={handleSearchKeyDown}
          placeholder={
            loading && catalog.length === 0
              ? '正在从各供应商同步模型目录…'
              : '模型 id、注册名、展示名或供应商…'
          }
          disabled={disabled}
          className={cn(
            'h-11 border-0 bg-transparent pl-10 pr-3 text-sm shadow-none',
            'placeholder:text-slate-400 dark:placeholder:text-slate-500',
            'focus-visible:ring-0 focus-visible:ring-offset-0'
          )}
          aria-label="搜索所有已启用供应商的对话模型"
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
        />
      </div>

      {fetchError && (
        <p
          className="flex items-start gap-2 rounded-xl border border-red-200/70 bg-red-50/80 px-3 py-2 text-[11px] text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span>目录提示：{fetchError}</span>
        </p>
      )}

      {!loading && catalog.length === 0 && !fetchError && (
        <p className="text-center text-[11px] text-slate-500 dark:text-slate-400" role="status">
          未获取到对话模型（请检查后端与 API Key）
        </p>
      )}

      {!disabled && catalog.length > 0 && (
        <>
          <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400" aria-live="polite">
            匹配结果（{matchCount} / 最多 {LIST_LIMIT} 条）
          </p>
          <div
            className={cn(
              listScrollClass,
              'max-h-[10rem] rounded-xl border-2 border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800/80'
            )}
          >
            <ul
              id={listboxId}
              className="divide-y divide-slate-100 py-0.5 dark:divide-slate-700/80"
              role="listbox"
              aria-label="对话模型搜索结果"
            >
              {matchCount === 0 ? (
                <li className="px-4 py-6 text-center text-[11px] text-slate-500 dark:text-slate-400" role="status">
                  无匹配结果，请调整关键词
                </li>
              ) : (
                filtered.map((m, idx) => {
                  const active = currentChatModel === m.registry_id
                  const focused = idx === activeIndex
                  return (
                    <li key={m.registry_id}>
                      <button
                        ref={(node) => {
                          optionRefs.current[idx] = node
                        }}
                        id={`${listboxId}-option-${idx}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        tabIndex={-1}
                        onClick={() => onSelect(m.registry_id)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={cn(
                          'flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition-colors',
                          active
                            ? 'bg-indigo-50/90 dark:bg-indigo-950/50'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/50',
                          focused && !active
                            ? 'bg-slate-50 ring-1 ring-inset ring-indigo-200 dark:bg-slate-700/50 dark:ring-indigo-500/35'
                            : undefined
                        )}
                      >
                        <CatalogRowIcon item={m} />
                        <div className="min-w-0 flex-1">
                          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {providerLabel(m.provider)}
                          </span>
                          <span
                            className={cn(
                              'block font-mono text-[12px] font-semibold leading-tight',
                              active ? 'text-indigo-800 dark:text-indigo-200' : 'text-slate-800 dark:text-slate-100'
                            )}
                          >
                            {m.registry_id}
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
    </div>
  )
}
