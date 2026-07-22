export type ArtifactTemplateComposerFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type ArtifactTemplateComposerViewModelInput = {
  eligibleCount: number
  errorMessage?: string
  pending: boolean
  reviewRequired: boolean
  reviewText: string
  sourceId: string
  templateId: string
  templatesLoading: boolean
  templateName?: string
  title: string
}

export type ArtifactTemplateComposerViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ArtifactTemplateComposerFeedbackTone
  reviewRequiredMissing: boolean
  sourceRequired: boolean
  submitLabel: string
  templateRequired: boolean
  titleRequired: boolean
}

export function buildArtifactTemplateComposerViewModel({
  eligibleCount,
  errorMessage,
  pending,
  reviewRequired,
  reviewText,
  sourceId,
  templateId,
  templatesLoading,
  templateName,
  title,
}: ArtifactTemplateComposerViewModelInput): ArtifactTemplateComposerViewModel {
  const hasSource = Boolean(sourceId)
  const hasTemplate = Boolean(templateId)
  const hasTitle = Boolean(title.trim())
  const hasReview = Boolean(reviewText.trim())
  const missingReview = reviewRequired && !hasReview

  if (!eligibleCount) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Choose or create an evidence-backed source Artifact before applying a reusable layout.',
      feedbackDetail: 'Complete a source Artifact with Evidence support before applying a reusable layout.',
      feedbackLabel: 'Evidence-backed source required',
      feedbackTone: 'blocked',
      reviewRequiredMissing: false,
      sourceRequired: true,
      submitLabel: 'Create candidate',
      templateRequired: false,
      titleRequired: false,
    }
  }

  if (templatesLoading) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Template creation is locked while governed layouts and review rules are loading.',
      feedbackDetail: 'Loading governed layouts and their required review rules.',
      feedbackLabel: 'Loading templates',
      feedbackTone: 'pending',
      reviewRequiredMissing: false,
      sourceRequired: !hasSource,
      submitLabel: 'Create candidate',
      templateRequired: false,
      titleRequired: !hasTitle,
    }
  }

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Template creation is locked while the candidate revision is being created with source Evidence bindings preserved.',
      feedbackDetail: 'Creating a candidate revision while preserving source Evidence bindings.',
      feedbackLabel: 'Creating candidate',
      feedbackTone: 'pending',
      reviewRequiredMissing: missingReview,
      sourceRequired: !hasSource,
      submitLabel: 'Creating candidate...',
      templateRequired: !hasTemplate,
      titleRequired: !hasTitle,
    }
  }

  if (errorMessage) {
    const canSubmit = hasSource && hasTemplate && hasTitle && !missingReview
    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Fix the required source, template, title and review fields before retrying.',
      feedbackDetail: errorMessage,
      feedbackLabel: 'Template was not applied',
      feedbackTone: 'error',
      reviewRequiredMissing: missingReview,
      sourceRequired: !hasSource,
      submitLabel: 'Try again',
      templateRequired: !hasTemplate,
      titleRequired: !hasTitle,
    }
  }

  if (!hasSource) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Choose the evidence-backed source Artifact before creating a derived candidate.',
      feedbackDetail: 'Choose the evidence-backed Artifact that should supply the immutable source bindings.',
      feedbackLabel: 'Source Artifact required',
      feedbackTone: 'blocked',
      reviewRequiredMissing: missingReview,
      sourceRequired: true,
      submitLabel: 'Create candidate',
      templateRequired: !hasTemplate,
      titleRequired: !hasTitle,
    }
  }

  if (!hasTemplate) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Select a governed template before creating the candidate Artifact.',
      feedbackDetail: 'Select a governed template before creating the candidate Artifact.',
      feedbackLabel: 'Template required',
      feedbackTone: 'blocked',
      reviewRequiredMissing: missingReview,
      sourceRequired: false,
      submitLabel: 'Create candidate',
      templateRequired: true,
      titleRequired: !hasTitle,
    }
  }

  if (!hasTitle) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Add a title before creating the derived candidate Artifact.',
      feedbackDetail: 'Add a title so the derived candidate is identifiable in Artifact Studio.',
      feedbackLabel: 'Title required',
      feedbackTone: 'blocked',
      reviewRequiredMissing: missingReview,
      sourceRequired: false,
      submitLabel: 'Create candidate',
      templateRequired: false,
      titleRequired: true,
    }
  }

  if (missingReview) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Add the required human review text before creating this candidate.',
      feedbackDetail: 'This template requires an explicit human review block before the candidate can be created.',
      feedbackLabel: 'Human review required',
      feedbackTone: 'blocked',
      reviewRequiredMissing: true,
      sourceRequired: false,
      submitLabel: 'Create candidate',
      templateRequired: false,
      titleRequired: false,
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: `${templateName ?? 'Selected template'} will create a candidate revision without changing the source Artifact.`,
    feedbackLabel: 'Ready to create candidate',
    feedbackTone: 'ready',
    reviewRequiredMissing: false,
    sourceRequired: false,
    submitLabel: 'Create candidate',
    templateRequired: false,
    titleRequired: false,
  }
}
