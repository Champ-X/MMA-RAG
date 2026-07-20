import { describe, expect, it } from 'vitest'
import { readSearchExplanation, searchOutcomeCopy } from './searchOutcome'

describe('search outcome presentation', () => {
  it('reads the stable explanation from run quality metadata', () => {
    const explanation = readSearchExplanation({
      quality: {
        explanation: {
          outcome: 'scope_empty',
          severity: 'warning',
          scope_evidence_count: 0,
          candidate_count: 0,
          completed_channels: 1,
          failed_channels: 0,
          unavailable_channels: 0,
          suggested_actions: ['add_sources'],
        },
      },
    })

    expect(explanation?.outcome).toBe('scope_empty')
    expect(searchOutcomeCopy[explanation!.outcome].title).toContain('no published evidence')
  })

  it('does not invent an explanation for legacy results', () => {
    expect(readSearchExplanation({ answer: 'Legacy answer' })).toBeNull()
    expect(readSearchExplanation(null)).toBeNull()
  })
})
