import { describe, expect, it } from 'vitest'
import { buildArtifactTemplateComposerViewModel } from './artifactTemplateComposerViewModel'

const baseInput = {
  eligibleCount: 2,
  errorMessage: undefined,
  pending: false,
  reviewRequired: false,
  reviewText: '',
  sourceId: 'artifact-1',
  templateId: 'evidence_brief',
  templatesLoading: false,
  templateName: 'Evidence brief',
  title: 'Q4 evidence brief',
}

describe('buildArtifactTemplateComposerViewModel', () => {
  it('blocks when no evidence-backed source artifact is eligible', () => {
    expect(buildArtifactTemplateComposerViewModel({ ...baseInput, eligibleCount: 0 })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Choose or create an evidence-backed source Artifact before applying a reusable layout.',
      feedbackLabel: 'Evidence-backed source required',
      feedbackTone: 'blocked',
      sourceRequired: true,
    })
  })

  it('blocks missing source selection', () => {
    expect(buildArtifactTemplateComposerViewModel({ ...baseInput, sourceId: '' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Choose the evidence-backed source Artifact before creating a derived candidate.',
      feedbackDetail: 'Choose the evidence-backed Artifact that should supply the immutable source bindings.',
      feedbackLabel: 'Source Artifact required',
      sourceRequired: true,
    })
  })

  it('surfaces template loading as pending feedback', () => {
    expect(buildArtifactTemplateComposerViewModel({ ...baseInput, templatesLoading: true })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Template creation is locked while governed layouts and review rules are loading.',
      feedbackDetail: 'Loading governed layouts and their required review rules.',
      feedbackLabel: 'Loading templates',
      feedbackTone: 'pending',
      templateRequired: false,
    })
  })

  it('blocks missing template selection', () => {
    expect(buildArtifactTemplateComposerViewModel({ ...baseInput, templateId: '' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Select a governed template before creating the candidate Artifact.',
      feedbackDetail: 'Select a governed template before creating the candidate Artifact.',
      feedbackLabel: 'Template required',
      templateRequired: true,
    })
  })

  it('blocks missing candidate title', () => {
    expect(buildArtifactTemplateComposerViewModel({ ...baseInput, title: '   ' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Add a title before creating the derived candidate Artifact.',
      feedbackDetail: 'Add a title so the derived candidate is identifiable in Artifact Studio.',
      feedbackLabel: 'Title required',
      titleRequired: true,
    })
  })

  it('blocks required human review text', () => {
    expect(buildArtifactTemplateComposerViewModel({
      ...baseInput,
      reviewRequired: true,
      reviewText: '',
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Add the required human review text before creating this candidate.',
      feedbackDetail: 'This template requires an explicit human review block before the candidate can be created.',
      feedbackLabel: 'Human review required',
      reviewRequiredMissing: true,
    })
  })

  it('summarizes ready creation without mutating source content', () => {
    expect(buildArtifactTemplateComposerViewModel(baseInput)).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Evidence brief will create a candidate revision without changing the source Artifact.',
      feedbackLabel: 'Ready to create candidate',
      feedbackTone: 'ready',
      submitLabel: 'Create candidate',
    })
  })

  it('surfaces pending state through live-region friendly copy', () => {
    expect(buildArtifactTemplateComposerViewModel({ ...baseInput, pending: true })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Template creation is locked while the candidate revision is being created with source Evidence bindings preserved.',
      feedbackDetail: 'Creating a candidate revision while preserving source Evidence bindings.',
      feedbackLabel: 'Creating candidate',
      feedbackTone: 'pending',
      submitLabel: 'Creating candidate...',
    })
  })

  it('keeps retry available after a failed create when fields remain valid', () => {
    expect(buildArtifactTemplateComposerViewModel({
      ...baseInput,
      errorMessage: 'Template service unavailable.',
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Template service unavailable.',
      feedbackLabel: 'Template was not applied',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    })
  })
})
