import type { Artifact } from '@/api/nexus'
import { getArtifactReadiness } from './artifactReadiness'

export type StudioFilter = 'all' | 'candidate' | 'published' | 'attention'

export type StudioSummary = {
  attentionCount: number
  averageCoverage: number
  candidateCount: number
  publishableCount: number
  publishedCount: number
  total: number
}

export type ArtifactCardPresentation = {
  gateLabel: string
  gateDetail: string
  readinessTone: 'positive' | 'warning' | 'negative'
  statusLabel: string
}

export const studioFilterOptions: Array<{ value: StudioFilter; label: string; detail: string }> = [
  { value: 'all', label: 'All', detail: 'Every candidate and published Artifact.' },
  { value: 'candidate', label: 'Candidates', detail: 'Draft outputs waiting for explicit publication.' },
  { value: 'published', label: 'Published', detail: 'Artifacts promoted into durable workspace knowledge.' },
  { value: 'attention', label: 'Needs review', detail: 'Artifacts blocked by coverage gaps or pending refreshes.' },
]

export function parseStudioFilter(value: string | null): StudioFilter {
  return studioFilterOptions.some((option) => option.value === value)
    ? (value as StudioFilter)
    : 'all'
}

export function summarizeArtifacts(items: Artifact[]): StudioSummary {
  const publishedCount = items.filter((item) => item.status === 'published').length
  const publishableCount = items.filter((item) => getArtifactReadiness(item).publishable).length
  const attentionCount = items.filter((item) => getArtifactReadiness(item).tone !== 'positive').length
  return {
    attentionCount,
    averageCoverage: items.length ? Math.round(items.reduce((total, item) => total + item.coverage.coverage_percent, 0) / items.length) : 0,
    candidateCount: items.filter((item) => item.status === 'candidate').length,
    publishableCount,
    publishedCount,
    total: items.length,
  }
}

export function filterArtifacts(items: Artifact[], query: string, filter: StudioFilter): Artifact[] {
  const normalizedQuery = query.trim().toLowerCase()
  return items.filter((item) => {
    const matchesQuery = `${item.title} ${item.artifact_type}`.toLowerCase().includes(normalizedQuery)
    const matchesFilter = filter === 'all'
      || (filter === 'attention' ? getArtifactReadiness(item).tone !== 'positive' : item.status === filter)
    return matchesQuery && matchesFilter
  })
}

export function presentArtifactCard(artifact: Artifact): ArtifactCardPresentation {
  const readiness = getArtifactReadiness(artifact)
  return {
    gateLabel: readiness.publishable ? 'Publication gate open' : 'Publication gate blocked',
    gateDetail: readiness.detail,
    readinessTone: readiness.tone,
    statusLabel: artifact.status.replaceAll('_', ' '),
  }
}
