import type { SearchExplanation } from '@/api/nexus'

export const searchOutcomeCopy: Record<string, { title: string; body: string }> = {
  evidence_found_degraded: {
    title: 'Answer produced with reduced search coverage',
    body: 'Relevant evidence was found, but one or more retrieval capabilities were unavailable. Review the channel facts before treating the result as exhaustive.',
  },
  scope_empty: {
    title: 'This scope has no published evidence yet',
    body: 'The selected Spaces and Sources contain no evidence visible to this turn. Add material or inspect ingestion before retrying.',
  },
  retrieval_unavailable: {
    title: 'Search services were unavailable',
    body: 'No retrieval channel completed, so the system could not evaluate whether the scope contains an answer.',
  },
  retrieval_incomplete: {
    title: 'Search could not rule out a match',
    body: 'Some retrieval channels failed. This is an incomplete search, not a reliable “no answer” result.',
  },
  scope_projection_mismatch: {
    title: 'The search index and frozen scope disagree',
    body: 'The index returned candidates, but none survived source, version or watermark checks. Inspect the snapshot and rebuild the projection.',
  },
  no_relevant_evidence: {
    title: 'No relevant evidence matched this question',
    body: 'Search completed normally across the frozen scope. Try different wording or review the selected Spaces and Sources.',
  },
}

export function readSearchExplanation(result: Record<string, unknown> | null): SearchExplanation | null {
  const quality = result?.quality
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)) return null
  const explanation = (quality as Record<string, unknown>).explanation
  if (!explanation || typeof explanation !== 'object' || Array.isArray(explanation)) return null
  if (typeof (explanation as Record<string, unknown>).outcome !== 'string') return null
  return explanation as SearchExplanation
}
