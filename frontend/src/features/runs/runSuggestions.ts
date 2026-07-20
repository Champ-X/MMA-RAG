import type { RunSuggestedQuestions } from '@/api/nexus'

export type RunSuggestion = RunSuggestedQuestions['items'][number]

export const suggestionReasonCopy: Record<RunSuggestion['reason'], string> = {
  uncovered_retrieved_evidence: 'Retrieved, not yet discussed',
  cross_source_comparison: 'Compare independent sources',
  native_modality_deep_dive: 'Inspect native media evidence',
  cited_evidence_deep_dive: 'Examine a cited detail',
}

export function suggestionProvenance(item: RunSuggestion) {
  const sources = item.source_names.slice(0, 2).join(' + ')
  const extra = item.source_names.length > 2 ? ` +${item.source_names.length - 2}` : ''
  return `${suggestionReasonCopy[item.reason]} · ${sources}${extra}`
}
