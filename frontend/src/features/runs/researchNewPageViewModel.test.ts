import { describe, expect, it } from 'vitest'
import {
  buildResearchComposerViewModel,
  resolveResearchExecutionChoice,
} from './researchNewPageViewModel'

const baseInput = {
  attachmentCount: 0,
  autoRoute: true,
  errorMessage: undefined,
  goal: 'Compare the reliability evidence.',
  pending: false,
  selectedSpaceCount: 0,
  stage: '',
}

describe('buildResearchComposerViewModel', () => {
  it('blocks submission until a research question exists', () => {
    expect(buildResearchComposerViewModel({ ...baseInput, goal: '   ' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Enter a question or research outcome before starting a Run.',
      feedbackLabel: 'Question required',
      feedbackTone: 'blocked',
      goalRequired: true,
      submitLabel: 'Start conversation',
    })
  })

  it('explains missing manual scope instead of leaving a disabled button silent', () => {
    expect(buildResearchComposerViewModel({
      ...baseInput,
      autoRoute: false,
      selectedSpaceCount: 0,
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Choose at least one Space or switch back to Auto-route Spaces before starting a Run.',
      feedbackDetail: 'Choose at least one Space or switch back to Auto-route Spaces.',
      feedbackLabel: 'Scope required',
      feedbackTone: 'blocked',
    })
  })

  it('blocks submission after auto-route resolves to an empty searchable scope', () => {
    expect(buildResearchComposerViewModel({
      ...baseInput,
      autoRoute: true,
      autoRouteSelectedSpaceCount: 0,
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Auto-route did not select a searchable Space. Pin a Space manually or add searchable evidence before starting.',
      feedbackDetail: 'Auto-route did not select a searchable Space. Pin a Space manually or add searchable evidence before starting.',
      feedbackLabel: 'Scope required',
      feedbackTone: 'blocked',
    })
  })

  it('summarizes queued attachments before starting', () => {
    expect(buildResearchComposerViewModel({
      ...baseInput,
      attachmentCount: 2,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: '2 attachments will be retained and parsed before the Run starts.',
      feedbackLabel: 'Ready to start',
      feedbackTone: 'ready',
    })
  })

  it('surfaces pending stage copy through a live-region friendly model', () => {
    expect(buildResearchComposerViewModel({
      ...baseInput,
      pending: true,
      stage: 'Importing attachment 1/2: field-notes.png',
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Run start is locked while evidence attachments are retained and parsed.',
      feedbackDetail: 'Importing attachment 1/2: field-notes.png',
      feedbackLabel: 'Preparing evidence',
      feedbackTone: 'pending',
      submitLabel: 'Preparing evidence...',
    })
  })

  it('keeps retry available after an async failure when the form is otherwise valid', () => {
    expect(buildResearchComposerViewModel({
      ...baseInput,
      errorMessage: 'Attachment ingestion failed.',
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Attachment ingestion failed.',
      feedbackLabel: 'Run could not start',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    })
  })
})

describe('research execution choice policy', () => {
  it('keeps execution depth and retrieval depth policy-coupled', () => {
    expect(resolveResearchExecutionChoice({ kind: 'research', quality: 'fast' })).toEqual({
      kind: 'research',
      quality: 'deep',
    })
    expect(resolveResearchExecutionChoice({ kind: 'quick', quality: 'deep' })).toEqual({
      kind: 'quick',
      quality: 'quality',
    })
    expect(resolveResearchExecutionChoice({ kind: 'quick', quality: 'fast' })).toEqual({
      kind: 'quick',
      quality: 'fast',
    })
  })
})
