import { describe, expect, it } from 'vitest'
import { suggestionProvenance } from './runSuggestions'

describe('Run suggestion provenance', () => {
  it('keeps the evidence reason and bounded source names visible', () => {
    expect(suggestionProvenance({
      id: 'suggestion-1',
      question: 'What should we compare?',
      reason: 'cross_source_comparison',
      evidence_revision_ids: ['one', 'two'],
      source_names: ['alpha.md', 'beta.md', 'gamma.md'],
      modalities: ['text'],
    })).toBe('Compare independent sources · alpha.md + beta.md +1')
  })
})
