import type { Evidence } from '@/api/nexus'
import type { RunCitation } from './runEvidenceBindingsViewModel'

export type RunCitationRenderState = {
  citationOccurrences: Map<string, number>
  seenMedia: Set<string>
}

export type RunCitationRenderModel = {
  evidence?: Evidence
  id: string | null
  mediaTriggerKey?: string
  shouldRenderMedia: boolean
  triggerKey?: string
}

export function buildCitationMarkdown(answer: string, citations: RunCitation[]): string {
  const citationNumbers = new Map(citations.map((citation, index) => [citation.evidence_revision_id, index + 1]))
  return answer.replace(/\[evidence:([0-9a-f-]{36})\]/gi, (_match, id: string) => (
    `[${citationNumbers.get(id) ?? 'source'}](#evidence-${id})`
  ))
}

export function evidenceIdFromHref(href: string | undefined): string | null {
  return href?.startsWith('#evidence-') ? href.slice('#evidence-'.length) : null
}

export function createCitationRenderState(): RunCitationRenderState {
  return {
    citationOccurrences: new Map<string, number>(),
    seenMedia: new Set<string>(),
  }
}

export function buildCitationRenderModel({
  evidenceById,
  href,
  state,
}: {
  evidenceById: Map<string, Evidence>
  href: string | undefined
  state: RunCitationRenderState
}): RunCitationRenderModel {
  const id = evidenceIdFromHref(href)
  if (!id) return { id: null, shouldRenderMedia: false }

  const evidence = evidenceById.get(id)
  if (!evidence) return { id, shouldRenderMedia: false }

  const hasMedia = ['image', 'audio', 'video'].includes(evidence.modality)
    || Boolean(evidence.locator.extra?.object_key)
  const shouldRenderMedia = hasMedia && !state.seenMedia.has(id)
  if (shouldRenderMedia) state.seenMedia.add(id)

  const occurrence = (state.citationOccurrences.get(id) ?? 0) + 1
  state.citationOccurrences.set(id, occurrence)

  return {
    evidence,
    id,
    mediaTriggerKey: `media-${id}`,
    shouldRenderMedia,
    triggerKey: `citation-${id}-${occurrence}`,
  }
}
