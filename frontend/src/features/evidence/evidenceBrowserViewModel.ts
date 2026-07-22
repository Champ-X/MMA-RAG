import type { Evidence } from '@/api/nexus'

export const evidenceModalityOptions = [
  { id: 'all', label: 'All', detail: 'Every published span' },
  { id: 'text', label: 'Text', detail: 'Pages and paragraphs' },
  { id: 'image', label: 'Image', detail: 'Figures and visual evidence' },
  { id: 'audio', label: 'Audio', detail: 'Timestamped speech' },
  { id: 'video', label: 'Video', detail: 'Frames and scenes' },
  { id: 'table', label: 'Table', detail: 'Cells and structured ranges' },
] as const

export type EvidenceBrowserModality = (typeof evidenceModalityOptions)[number]['id']

export type EvidenceBrowserSummary = {
  activeFilters: string[]
  currentModalityLabel: string
  flaggedCount: number
  modalityCounts: Record<EvidenceBrowserModality, number>
  scopeCountLabel: string
  scopeTitle: string
  sourceCount: number
}

export const parseEvidenceBrowserModality = (value: string | null): EvidenceBrowserModality =>
  evidenceModalityOptions.some((option) => option.id === value)
    ? (value as EvidenceBrowserModality)
    : 'all'

export function buildEvidenceBrowserSummary({
  loadedItems,
  query,
  scopeHasMore,
  scopeItems,
  selectedModality,
  sourceId,
  spaceId,
}: {
  loadedItems: Evidence[]
  query: string
  scopeHasMore: boolean
  scopeItems: Evidence[]
  selectedModality: EvidenceBrowserModality
  sourceId?: string
  spaceId?: string
}): EvidenceBrowserSummary {
  const selectedOption = evidenceModalityOptions.find((item) => item.id === selectedModality)
  const normalizedQuery = query.trim()
  const activeFilters = [
    selectedModality !== 'all' ? selectedOption?.label : undefined,
    normalizedQuery ? `"${normalizedQuery}"` : undefined,
    sourceId ? 'Single source' : undefined,
  ].filter((item): item is string => Boolean(item))

  return {
    activeFilters,
    currentModalityLabel: selectedOption?.label ?? 'All',
    flaggedCount: loadedItems.filter((item) => item.quality_flags.length > 0).length,
    modalityCounts: countModalities(scopeItems),
    scopeCountLabel: `${scopeItems.length}${scopeHasMore ? '+' : ''}`,
    scopeTitle: sourceId ? 'Source-scoped evidence' : spaceId ? 'Space-scoped evidence' : 'Global evidence index',
    sourceCount: new Set(loadedItems.map((item) => item.source_id)).size,
  }
}

function countModalities(items: Evidence[]): Record<EvidenceBrowserModality, number> {
  return evidenceModalityOptions.reduce<Record<EvidenceBrowserModality, number>>((counts, option) => {
    counts[option.id] = option.id === 'all'
      ? items.length
      : items.filter((item) => item.modality === option.id).length
    return counts
  }, {} as Record<EvidenceBrowserModality, number>)
}
