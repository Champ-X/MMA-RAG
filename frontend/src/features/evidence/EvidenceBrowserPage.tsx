import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, Filter, Search, SlidersHorizontal } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { EvidenceCard } from '@/components/nexus/EvidenceCard'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { buildEvidenceDetailPath } from '@/lib/evidenceRoutes'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import {
  buildEvidenceBrowserSummary,
  evidenceModalityOptions,
  parseEvidenceBrowserModality,
  type EvidenceBrowserModality,
} from './evidenceBrowserViewModel'
import './EvidenceBrowserPage.css'

export default function EvidenceBrowserPage() {
  const { spaceId } = useParams()
  const [params, setParams] = useSearchParams()
  const sourceId = params.get('source') ?? undefined
  const selectedModality = parseEvidenceBrowserModality(params.get('modality'))
  const modalityRefs = useRef<Partial<Record<EvidenceBrowserModality, HTMLButtonElement | null>>>({})
  const [filter, setFilter] = useState(() => params.get('q') ?? '')
  const deferredFilter = useDeferredValue(filter.trim())
  const evidence = useInfiniteQuery({
    queryKey: ['evidence', spaceId, sourceId, selectedModality, deferredFilter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => nexusApi.listEvidence({
      spaceId,
      sourceId,
      modality: selectedModality === 'all' ? undefined : selectedModality,
      query: deferredFilter || undefined,
      cursor: pageParam ?? undefined,
      limit: 48,
    }),
    getNextPageParam: (lastPage) => lastPage.page.next_cursor ?? null,
    placeholderData: keepPreviousData,
  })
  const overview = useQuery({
    queryKey: ['evidence-overview', spaceId, sourceId],
    queryFn: () => nexusApi.listEvidence({ spaceId, sourceId, limit: 200 }),
  })
  useEffect(() => {
    setFilter(params.get('q') ?? '')
  }, [params])

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (deferredFilter) next.set('q', deferredFilter)
    else next.delete('q')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [deferredFilter, params, setParams])

  const setModality = (nextModality: EvidenceBrowserModality) => {
    const next = new URLSearchParams(params)
    if (nextModality === 'all') next.delete('modality')
    else next.set('modality', nextModality)
    setParams(next, { replace: true })
  }
  const handleModalityKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextModality = moveRadioGroupValue(evidenceModalityOptions.map((option) => option.id), selectedModality, direction)
    setModality(nextModality)
    window.requestAnimationFrame(() => modalityRefs.current[nextModality]?.focus({ preventScroll: true }))
  }
  const clearFilters = () => {
    setFilter('')
    const next = new URLSearchParams(params)
    next.delete('q')
    next.delete('modality')
    setParams(next, { replace: true })
  }

  if ((evidence.isLoading && !evidence.data) || (overview.isLoading && !overview.data)) return <LoadingState label="Hydrating published Evidence" />
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: evidence.error, hasData: Boolean(evidence.data), label: 'Evidence', required: true },
    { error: overview.error, hasData: Boolean(overview.data), label: 'Overview' },
  ])
  const retryEvidence = () => {
    void evidence.refetch()
    void overview.refetch()
  }
  const pages = evidence.data?.pages ?? []
  const items = pages.flatMap((page) => page.items)
  const scopeItems = overview.data?.items ?? []
  const isRefreshingLens = evidence.isFetching && !evidence.isFetchingNextPage
  const summary = buildEvidenceBrowserSummary({
    loadedItems: items,
    query: deferredFilter,
    scopeHasMore: Boolean(overview.data?.page.next_cursor),
    scopeItems,
    selectedModality,
    sourceId,
    spaceId,
  })
  const emptyAction = summary.activeFilters.length > 0
    ? <button className="button" type="button" onClick={clearFilters}>Clear filters</button>
    : spaceId
      ? <Link className="button" to={`/spaces/${spaceId}/sources`}>Inspect Sources</Link>
      : <Link className="button" to="/spaces">Open Spaces</Link>

  return (
    <div className="page-shell">
      <PageHeader eyebrow="Immutable knowledge surface" title="Evidence browser" description="Preview published chunks, then open the exact page, figure, timeline or cell locator." actions={spaceId ? <Link className="button" to={`/spaces/${spaceId}`}><ArrowLeft />Back to Space</Link> : undefined} />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryEvidence} />
      {queryErrorNotice.tone === 'blocking' ? (
        <EmptyState title="Evidence could not be loaded" body="Nexus could not read the published Evidence index for this scope. Retry before treating this view as empty or changing filters." action={spaceId ? <Link className="button" to={`/spaces/${spaceId}/sources`}>Inspect Sources</Link> : <Link className="button" to="/spaces">Open Spaces</Link>} />
      ) : <>
      <section className="evidence-control-room" aria-label="Evidence query controls">
        <div className="evidence-command-card">
          <p className="eyebrow"><SlidersHorizontal size={12} />Query ledger</p>
          <h2>{summary.scopeTitle}</h2>
          <p>
            Showing <strong>{items.length}</strong> loaded spans from a scope sample of <strong>{summary.scopeCountLabel}</strong>{'.'}
            {evidence.hasNextPage ? ' More published evidence is available below.' : ' This view is fully loaded for the active lens.'}
          </p>
          <div className="evidence-scope-grid" aria-label="Current evidence signals">
            <span><strong>{items.length}</strong><small>loaded spans</small></span>
            <span><strong>{summary.sourceCount}</strong><small>visible sources</small></span>
            <span><strong>{summary.flaggedCount}</strong><small>quality flags</small></span>
          </div>
        </div>

        <div className="evidence-search-card">
          <label>
            <span><Search size={16} />Search published Evidence</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search source names, OCR text, captions, transcripts..." />
          </label>
          <div className="active-filter-strip" aria-live="polite">
            <span><Filter size={13} />Result lens</span>
            {summary.activeFilters.length ? summary.activeFilters.map((item) => <em key={item}>{item}</em>) : <small>All modalities, all published sources</small>}
            {summary.activeFilters.length > 0 && <button type="button" onClick={clearFilters}>Clear lens</button>}
          </div>
        </div>
      </section>

      <div className="modality-ledger" role="radiogroup" aria-label="Filter by modality">
        {evidenceModalityOptions.map((option) => (
          <button type="button" key={option.id} ref={(node) => { modalityRefs.current[option.id] = node }} role="radio" aria-checked={selectedModality === option.id} tabIndex={selectedModality === option.id ? 0 : -1} className={selectedModality === option.id ? 'active' : ''} onKeyDown={handleModalityKeyDown} onClick={() => setModality(option.id)}>
            <span className={`modality-pulse modality-${option.id}`} />
            <strong>{option.label}</strong>
            <small>{option.detail}</small>
            <em>{summary.modalityCounts[option.id]}</em>
          </button>
        ))}
      </div>

      {items.length ? (
        <>
          <div className="evidence-result-summary">
            <span>{summary.currentModalityLabel} evidence</span>
            <strong>{items.length} loaded</strong>
            <small aria-live="polite">{isRefreshingLens ? 'Refreshing lens...' : deferredFilter ? `Filtered by ${deferredFilter}` : 'No text filter applied'}</small>
          </div>
          <div className={`evidence-grid ${isRefreshingLens ? 'is-refreshing' : ''}`} aria-busy={isRefreshingLens}>
            {items.map((item) => <Link key={item.id} to={buildEvidenceDetailPath(item.id)}><EvidenceCard evidence={item} /></Link>)}
          </div>
          {evidence.hasNextPage && (
            <div className="load-more-row">
              <button className="button" type="button" aria-disabled={evidence.isFetchingNextPage || undefined} onClick={() => { if (!evidence.isFetchingNextPage) evidence.fetchNextPage() }}>
                <ArrowDown size={15} />{evidence.isFetchingNextPage ? 'Loading more evidence' : 'Load more evidence'}
              </button>
            </div>
          )}
        </>
      ) : <EmptyState title={deferredFilter ? `No Evidence matches "${deferredFilter}"` : 'No published Evidence matches'} body="Adjust the active modality or clear the text lens. If the scope is empty, inspect Source readiness and finish parsing before expecting published spans here." action={emptyAction} />}
      </>}
    </div>
  )
}
