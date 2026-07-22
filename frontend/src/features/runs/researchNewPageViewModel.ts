export type ResearchComposerFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'
export type ResearchExecutionKind = 'quick' | 'research'
export type ResearchQuality = 'fast' | 'quality' | 'deep'
export type ResearchScopeMode = 'auto' | 'manual'

export const researchExecutionKindOptions: ReadonlyArray<ResearchExecutionKind> = ['quick', 'research']
export const researchScopeModeOptions: ReadonlyArray<ResearchScopeMode> = ['auto', 'manual']

export type ResearchComposerViewModelInput = {
  attachmentCount: number
  autoRoute: boolean
  autoRouteSelectedSpaceCount?: number | null
  errorMessage?: string
  goal: string
  pending: boolean
  selectedSpaceCount: number
  stage: string
}

export type ResearchComposerViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ResearchComposerFeedbackTone
  goalRequired: boolean
  submitLabel: string
}

export function resolveResearchExecutionChoice({
  kind,
  quality,
}: {
  kind: ResearchExecutionKind
  quality: ResearchQuality
}): { kind: ResearchExecutionKind; quality: ResearchQuality } {
  if (kind === 'research') return { kind, quality: 'deep' }
  return {
    kind,
    quality: quality === 'deep' ? 'quality' : quality,
  }
}

export function buildResearchComposerViewModel({
  attachmentCount,
  autoRoute,
  autoRouteSelectedSpaceCount,
  errorMessage,
  goal,
  pending,
  selectedSpaceCount,
  stage,
}: ResearchComposerViewModelInput): ResearchComposerViewModel {
  const hasGoal = Boolean(goal.trim())
  const autoRouteScopeResolved = autoRouteSelectedSpaceCount != null
  const autoRouteHasScope = !autoRouteScopeResolved || autoRouteSelectedSpaceCount > 0
  const hasScope = autoRoute ? autoRouteHasScope : selectedSpaceCount > 0

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Run start is locked while evidence attachments are retained and parsed.',
      feedbackDetail: stage || 'Preparing the Run snapshot.',
      feedbackLabel: 'Preparing evidence',
      feedbackTone: 'pending',
      goalRequired: !hasGoal,
      submitLabel: 'Preparing evidence...',
    }
  }

  if (errorMessage) {
    const canSubmit = hasGoal && hasScope
    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Fix the required question and scope before retrying this Run.',
      feedbackDetail: errorMessage,
      feedbackLabel: 'Run could not start',
      feedbackTone: 'error',
      goalRequired: !hasGoal,
      submitLabel: 'Try again',
    }
  }

  if (!hasGoal) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Enter a question or research outcome before starting a Run.',
      feedbackDetail: 'Enter a question or research outcome before starting a Run.',
      feedbackLabel: 'Question required',
      feedbackTone: 'blocked',
      goalRequired: true,
      submitLabel: 'Start conversation',
    }
  }

  if (!hasScope) {
    const detail = autoRoute
      ? 'Auto-route did not select a searchable Space. Pin a Space manually or add searchable evidence before starting.'
      : 'Choose at least one Space or switch back to Auto-route Spaces.'
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: autoRoute ? detail : 'Choose at least one Space or switch back to Auto-route Spaces before starting a Run.',
      feedbackDetail: detail,
      feedbackLabel: 'Scope required',
      feedbackTone: 'blocked',
      goalRequired: false,
      submitLabel: 'Start conversation',
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: attachmentCount
      ? `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} will be retained and parsed before the Run starts.`
      : 'Ready to freeze the selected scope, model and retrieval settings.',
    feedbackLabel: 'Ready to start',
    feedbackTone: 'ready',
    goalRequired: false,
    submitLabel: 'Start conversation',
  }
}
