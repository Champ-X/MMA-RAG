export type OnboardingStepId = 'space' | 'source' | 'run'

export type OnboardingProgress = {
  complete: boolean
  completedCount: number
  currentStep: OnboardingStepId | null
}

export function getOnboardingProgress(
  spaceCount: number,
  sourceCount: number,
  citedRunCount: number,
): OnboardingProgress {
  if (spaceCount === 0) return { complete: false, completedCount: 0, currentStep: 'space' }
  if (sourceCount === 0) return { complete: false, completedCount: 1, currentStep: 'source' }
  if (citedRunCount === 0) return { complete: false, completedCount: 2, currentStep: 'run' }
  return { complete: true, completedCount: 3, currentStep: null }
}
