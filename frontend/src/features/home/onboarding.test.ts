import { describe, expect, it } from 'vitest'
import { getOnboardingProgress } from './onboarding'

describe('first-use onboarding progress', () => {
  it('advances only when the preceding evidence workflow is real', () => {
    expect(getOnboardingProgress(0, 0, 0)).toEqual({ complete: false, completedCount: 0, currentStep: 'space' })
    expect(getOnboardingProgress(1, 0, 0)).toEqual({ complete: false, completedCount: 1, currentStep: 'source' })
    expect(getOnboardingProgress(1, 2, 0)).toEqual({ complete: false, completedCount: 2, currentStep: 'run' })
    expect(getOnboardingProgress(1, 2, 1)).toEqual({ complete: true, completedCount: 3, currentStep: null })
  })

  it('does not mistake an empty-scope run for an imported knowledge base', () => {
    expect(getOnboardingProgress(1, 0, 3).currentStep).toBe('source')
  })
})
