import { describe, expect, it } from 'vitest'
import type { Artifact, ArtifactRefreshProposal } from '@/api/nexus'
import {
  buildArtifactDraftAutosaveBeacon,
  buildArtifactDraftAutosaveKey,
  buildArtifactDraftAutosaveNotice,
  buildArtifactDraftAutosaveRecord,
  buildArtifactDraftDiscardConfirmation,
  buildArtifactDraftText,
  buildArtifactDraftEditorViewModel,
  buildArtifactCopyLinkViewModel,
  buildArtifactLifecycleActionViewModel,
  buildArtifactPageViewModel,
  buildArtifactRefreshDecisionViewModel,
  buildArtifactStatusConfirmation,
  parseArtifactDraftAutosaveRecord,
  parseRecoverableArtifactDraftAutosaveRecord,
} from './artifactPageViewModel'

function stubArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    artifact_type: 'research_report',
    canonical_document: {},
    coverage: {
      bound_evidence_count: 3,
      content_block_count: 3,
      coverage_percent: 100,
      supported_block_count: 3,
      user_block_count: 0,
    },
    created_at: '2026-07-21T00:00:00Z',
    evidence_revision_ids: ['e1', 'e2', 'e3'],
    id: 'artifact-a',
    pending_refresh_count: 0,
    revision_id: 'revision-alpha-123456',
    revision_no: 2,
    run_id: 'run-a',
    status: 'candidate',
    title: 'Launch brief',
    updated_at: '2026-07-21T00:00:00Z',
    ...overrides,
  } as Artifact
}

function stubRefresh(): ArtifactRefreshProposal {
  return {
    artifact_id: 'artifact-a',
    base_revision_id: 'revision-alpha',
    created_at: '2026-07-21T00:00:00Z',
    diff: {},
    id: 'refresh-a',
    impacted_evidence_revision_ids: ['e1', 'e2'],
    proposed_document: {},
    proposed_evidence_revision_ids: ['e3'],
    reason: 'source_changed',
    resolved_at: null,
    status: 'pending',
  } as ArtifactRefreshProposal
}

describe('Artifact detail release dossier', () => {
  it('shows an open publication gate for publishable candidates', () => {
    const vm = buildArtifactPageViewModel(stubArtifact())

    expect(vm.lifecycleLabel).toBe('Candidate artifact')
    expect(vm.tone).toBe('positive')
    expect(vm.releaseSteps.map((step) => step.state)).toEqual(['active', 'active', 'pending'])
    expect(vm.releaseSteps.map((step) => step.stateLabel)).toEqual(['Current', 'Current', 'Waiting'])
    expect(vm.releaseSignals.map((signal) => [signal.label, signal.value])).toContainEqual(['Coverage', '100%'])
    expect(vm.deliveryLabel).toBe('Review delivery pack')
    expect(vm.deliveryIdentity.filenameStem).toBe('launch-brief-candidate-v2-revision')
    expect(vm.deliveryIdentity.signals.map((signal) => [signal.label, signal.value])).toContainEqual([
      'Revision header',
      'X-Nexus-Artifact-Revision',
    ])
    expect(vm.deliveryIdentity.signals.map((signal) => [signal.label, signal.value])).toContainEqual([
      'Coverage header',
      '100%',
    ])
    expect(vm.deliveryFormats.map((format) => format.format)).toEqual(['html', 'pdf', 'markdown', 'json', 'csv', 'xlsx'])
    expect(vm.deliveryFormats.find((format) => format.format === 'html')).toMatchObject({
      available: true,
      behavior: 'Open',
      recommended: true,
    })
    expect(vm.deliveryFormats.find((format) => format.format === 'markdown')?.detail).toContain('citation labels')
    expect(vm.deliveryFormats.find((format) => format.format === 'csv')).toMatchObject({
      available: false,
      unavailableReason: 'No table blocks',
    })
  })

  it('marks published artifacts as live but still immutable', () => {
    const vm = buildArtifactPageViewModel(stubArtifact({ status: 'published' }))

    expect(vm.lifecycleLabel).toBe('Published artifact')
    expect(vm.releaseSteps.map((step) => step.state)).toEqual(['complete', 'complete', 'active'])
    expect(vm.releaseSteps.map((step) => step.stateLabel)).toEqual(['Cleared', 'Cleared', 'Live'])
    expect(vm.deliveryLabel).toBe('Live delivery pack')
    expect(vm.deliveryFormats.find((format) => format.format === 'pdf')).toMatchObject({
      available: true,
      behavior: 'Download',
      recommended: true,
    })
  })

  it('blocks publication when a refresh proposal is pending', () => {
    const vm = buildArtifactPageViewModel(stubArtifact({ pending_refresh_count: 1 }), stubRefresh())

    expect(vm.tone).toBe('negative')
    expect(vm.releaseSignals[3]).toMatchObject({ label: 'Refresh', value: 'pending', detail: '2 impacted bindings' })
    expect(vm.releaseSteps[1]).toMatchObject({ state: 'blocked', stateLabel: 'Blocked' })
    expect(vm.deliveryDetail).toContain('Resolve the blocked publication checks')
  })

  it('enables spreadsheet exports for canonical table documents', () => {
    const vm = buildArtifactPageViewModel(stubArtifact({
      canonical_document: {
        blocks: [{ type: 'table', columns: ['Metric'], rows: [['Seats']] }],
      },
    }))

    expect(vm.deliveryFormats.find((format) => format.format === 'csv')).toMatchObject({
      available: true,
      useCase: 'Single-table analysis',
    })
    expect(vm.deliveryFormats.find((format) => format.format === 'xlsx')).toMatchObject({
      available: true,
      detail: expect.stringContaining('delivery manifest sheet'),
      useCase: 'Spreadsheet review',
    })
  })

  it('keeps published workspace link copy guidance quiet before copying', () => {
    expect(buildArtifactCopyLinkViewModel({
      artifactTitle: 'Launch brief',
      revisionNo: 4,
      state: 'idle',
    })).toMatchObject({
      feedbackDetail: 'Copies the stable workspace URL for Launch brief revision v4. It does not change the Artifact lifecycle or evidence bindings.',
      feedbackLabel: 'Workspace link ready',
      feedbackTone: 'ready',
      role: 'status',
      submitLabel: 'Copy workspace link',
      visible: false,
    })
  })

  it('announces copied workspace links as durable receipts', () => {
    expect(buildArtifactCopyLinkViewModel({
      artifactTitle: 'Launch brief',
      revisionNo: 4,
      state: 'copied',
    })).toMatchObject({
      feedbackDetail: 'Launch brief revision v4 workspace link is on the clipboard. The URL resolves to the current published revision.',
      feedbackLabel: 'Workspace link copied',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    })
  })

  it('announces workspace link copying before clipboard settlement', () => {
    expect(buildArtifactCopyLinkViewModel({
      artifactTitle: 'Launch brief',
      revisionNo: 4,
      state: 'copying',
    })).toMatchObject({
      feedbackDetail: 'Copying the stable workspace URL for Launch brief revision v4. The Artifact lifecycle and evidence bindings remain unchanged.',
      feedbackLabel: 'Copying workspace link',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copying...',
      visible: true,
    })
  })

  it('turns clipboard failures into assertive retry guidance', () => {
    expect(buildArtifactCopyLinkViewModel({
      artifactTitle: 'Launch brief',
      revisionNo: 4,
      state: 'failed',
    })).toMatchObject({
      feedbackDetail: 'Clipboard access failed. Copy Launch brief revision v4 from the browser address bar; the published URL remains stable.',
      feedbackLabel: 'Workspace link was not copied',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try copy again',
      visible: true,
    })
  })

  it('builds guarded save states for canonical JSON editing', () => {
    const canonical = {
      blocks: [{ evidence_revision_ids: ['e1'], text: 'Grounded claim.', type: 'paragraph' }],
      schema: 'nexus.block-document.v1',
      title: 'Launch brief',
    }
    const artifact = stubArtifact({ canonical_document: canonical })
    const unchanged = buildArtifactDraftEditorViewModel(JSON.stringify(canonical, null, 2), artifact)
    const changed = buildArtifactDraftEditorViewModel(
      JSON.stringify({ ...canonical, title: 'Launch brief edited' }, null, 2),
      artifact,
    )

    expect(unchanged).toMatchObject({
      canSave: false,
      formatAction: { ariaDisabled: true, canSubmit: false, enabled: false, label: 'Format JSON' },
      restoreAction: { ariaDisabled: true, canSubmit: false, enabled: false, label: 'Restore current' },
      saveAriaDisabled: true,
      saveDisabledDetail: 'Edit the canonical JSON before saving a new Artifact revision.',
      saveLabel: 'No changes to save',
      state: 'unchanged',
    })
    expect(changed).toMatchObject({
      canSave: true,
      saveAriaDisabled: false,
      saveLabel: 'Save new revision',
      state: 'ready',
    })
    expect(changed.signals.map((signal) => [signal.label, signal.value])).toContainEqual([
      'Blocks',
      '1',
    ])
    expect(changed.parsedDocument?.title).toBe('Launch brief edited')
  })

  it('offers format and restore helpers for canonical JSON drafts', () => {
    const canonical = {
      blocks: [{ evidence_revision_ids: ['e1'], text: 'Grounded claim.', type: 'paragraph' }],
      schema: 'nexus.block-document.v1',
      title: 'Launch brief',
    }
    const artifact = stubArtifact({ canonical_document: canonical })
    const compactDraft = JSON.stringify({ ...canonical, title: 'Compact edit' })
    const vm = buildArtifactDraftEditorViewModel(compactDraft, artifact)

    expect(buildArtifactDraftText(artifact)).toBe(JSON.stringify(canonical, null, 2))
    expect(vm).toMatchObject({
      canSave: true,
      formatAction: { ariaDisabled: false, canSubmit: true, enabled: true, label: 'Format JSON' },
      restoreAction: { ariaDisabled: false, canSubmit: true, enabled: true, label: 'Restore current' },
    })
    expect(vm.formattedDraft).toBe(JSON.stringify({ ...canonical, title: 'Compact edit' }, null, 2))
    expect(vm.restoredDraft).toBe(JSON.stringify(canonical, null, 2))
  })

  it('scopes autosaved JSON drafts to the exact artifact revision', () => {
    const artifact = stubArtifact({
      canonical_document: { blocks: [], title: 'Current' },
      id: 'artifact-x',
      revision_id: 'revision-x',
      revision_no: 6,
    })
    const record = buildArtifactDraftAutosaveRecord(
      artifact,
      '{"blocks":[]}',
      new Date('2026-07-21T11:22:33.000Z'),
    )

    expect(buildArtifactDraftAutosaveKey(artifact)).toBe('nexus.artifact-draft.artifact-x.revision-x')
    expect(record).toMatchObject({
      artifactId: 'artifact-x',
      draft: '{"blocks":[]}',
      revisionId: 'revision-x',
      revisionNo: 6,
      savedAt: '2026-07-21T11:22:33.000Z',
    })
    expect(parseArtifactDraftAutosaveRecord(JSON.stringify(record), artifact)).toEqual(record)
    expect(parseArtifactDraftAutosaveRecord(JSON.stringify({
      ...record,
      revisionId: 'revision-y',
    }), artifact)).toBeNull()
    expect(parseArtifactDraftAutosaveRecord('not-json', artifact)).toBeNull()
    expect(parseRecoverableArtifactDraftAutosaveRecord(JSON.stringify({
      ...record,
      draft: buildArtifactDraftText(artifact),
    }), artifact)).toBeNull()
    expect(parseRecoverableArtifactDraftAutosaveRecord(JSON.stringify(record), artifact)).toEqual(record)
  })

  it('summarizes available session drafts before opening the editor', () => {
    const beacon = buildArtifactDraftAutosaveBeacon({
      artifactId: 'artifact-x',
      draft: '{"blocks":[]}',
      revisionId: 'revision-x',
      revisionNo: 6,
      savedAt: '2026-07-21T11:22:33.000Z',
    })

    expect(beacon).toMatchObject({
      actionLabel: 'Review draft',
      savedLabel: 'Session save · 2026-07-21 11:22:33Z',
      title: 'Session draft available',
    })
    expect(beacon.ariaLabel).toContain('revision v6')
    expect(beacon.detail).toContain('browser-saved canonical JSON draft')
    expect(beacon.detail).toContain('Open Advanced edit')
  })

  it('summarizes recovered session drafts with explicit recovery actions', () => {
    const notice = buildArtifactDraftAutosaveNotice({
      artifactId: 'artifact-x',
      draft: '{"blocks":[]}',
      revisionId: 'revision-x',
      revisionNo: 6,
      savedAt: '2026-07-21T11:22:33.000Z',
    })

    expect(notice).toMatchObject({
      discardLabel: 'Restore current',
      keepLabel: 'Keep editing',
      savedLabel: 'Session save · 2026-07-21 11:22:33Z',
      title: 'Session draft recovered',
    })
    expect(notice.detail).toContain('revision v6')
    expect(notice.detail).toContain('restore current to discard it')
  })

  it('uses consequence-specific copy before discarding a JSON draft', () => {
    const confirmation = buildArtifactDraftDiscardConfirmation(stubArtifact({ revision_no: 9 }))

    expect(confirmation).toMatchObject({
      confirmLabel: 'Discard draft',
      title: 'Discard unsaved JSON changes?',
      tone: 'danger',
    })
    expect(confirmation.body).toContain('discards the unsaved canonical JSON draft')
    expect(confirmation.body).toContain('No revision will be created')
    expect(confirmation.body).toContain('revision v9')
  })

  it('blocks canonical JSON saves with actionable repair copy', () => {
    const syntax = buildArtifactDraftEditorViewModel('{"blocks": [}', stubArtifact())
    const missingBlocks = buildArtifactDraftEditorViewModel('{"schema":"nexus"}', stubArtifact())

    expect(syntax).toMatchObject({
      canSave: false,
      errorTitle: 'JSON syntax error.',
      formatAction: { ariaDisabled: true, canSubmit: false, enabled: false },
      saveAriaDisabled: true,
      saveLabel: 'Resolve JSON issue',
      state: 'invalid',
    })
    expect(missingBlocks).toMatchObject({
      canSave: false,
      errorTitle: 'Blocks array is missing.',
      state: 'invalid',
    })
  })

  it('uses consequence-specific confirmation copy for lifecycle changes', () => {
    const publish = buildArtifactStatusConfirmation(stubArtifact({ revision_no: 4 }), 'published')
    const draft = buildArtifactStatusConfirmation(stubArtifact({ revision_no: 4, status: 'published' }), 'candidate')

    expect(publish).toMatchObject({
      confirmLabel: 'Publish artifact',
      title: 'Publish artifact?',
      tone: 'neutral',
    })
    expect(publish.body).toContain('revision v4')
    expect(publish.body).toContain('reusable workspace Artifact')
    expect(draft).toMatchObject({
      confirmLabel: 'Return to draft',
      title: 'Return to draft?',
      tone: 'danger',
    })
    expect(draft.body).toContain('removes the live published state')
  })

  it('explains ready and blocked publication actions', () => {
    expect(buildArtifactLifecycleActionViewModel({
      publishable: true,
      readinessDetail: 'Ready for explicit publication.',
      revisionNo: 4,
      targetStatus: 'published',
    })).toMatchObject({
      actionLabel: 'Publish',
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Ready to publish revision v4 as durable workspace knowledge. Future edits create a new candidate revision.',
      feedbackLabel: 'Publication ready',
      feedbackTone: 'ready',
      visible: false,
    })

    expect(buildArtifactLifecycleActionViewModel({
      publishable: false,
      readinessDetail: 'Resolve pending source refresh before publishing.',
      revisionNo: 4,
      targetStatus: 'published',
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Resolve pending source refresh before publishing.',
      feedbackDetail: 'Resolve pending source refresh before publishing.',
      feedbackLabel: 'Publication blocked',
      feedbackTone: 'blocked',
      visible: false,
    })
  })

  it('announces pending publication lifecycle changes', () => {
    expect(buildArtifactLifecycleActionViewModel({
      pendingTarget: 'published',
      publishable: true,
      readinessDetail: 'Ready.',
      revisionNo: 4,
      targetStatus: 'published',
    })).toMatchObject({
      actionLabel: 'Publishing...',
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Publish is locked while publishing artifact for revision v4. Evidence bindings and delivery identity remain preserved.',
      feedbackDetail: 'Publishing revision v4. Evidence bindings and delivery identity stay attached to this immutable revision.',
      feedbackLabel: 'Publishing artifact',
      feedbackTone: 'pending',
      role: 'status',
      visible: true,
    })
  })

  it('keeps failed publication lifecycle changes retryable', () => {
    expect(buildArtifactLifecycleActionViewModel({
      errorMessage: 'Revision changed elsewhere.',
      errorTarget: 'published',
      publishable: true,
      readinessDetail: 'Ready.',
      revisionNo: 4,
      targetStatus: 'published',
    })).toMatchObject({
      actionLabel: 'Publish',
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Revision changed elsewhere. Revision v4 remains in its previous lifecycle state and can be retried when the gate is still available.',
      feedbackLabel: 'Publish failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes published and returned-to-draft lifecycle receipts', () => {
    expect(buildArtifactLifecycleActionViewModel({
      completedTarget: 'published',
      publishable: true,
      readinessDetail: 'Ready.',
      revisionNo: 4,
      targetStatus: 'candidate',
    })).toMatchObject({
      feedbackDetail: 'Revision v4 is now the live workspace Artifact. Stable delivery links and exports are ready to reuse.',
      feedbackLabel: 'Artifact published',
      feedbackTone: 'ready',
      visible: true,
    })

    expect(buildArtifactLifecycleActionViewModel({
      completedTarget: 'candidate',
      publishable: true,
      readinessDetail: 'Already published.',
      revisionNo: 4,
      targetStatus: 'candidate',
    })).toMatchObject({
      actionLabel: 'Return to draft',
      feedbackDetail: 'Revision v4 returned to candidate review. The immutable revision remains intact; exports are review copies until republished.',
      feedbackLabel: 'Artifact returned to draft',
      feedbackTone: 'ready',
      visible: true,
    })
  })

  it('explains refresh proposal decisions before action', () => {
    expect(buildArtifactRefreshDecisionViewModel({
      impactedEvidenceCount: 3,
      removedEvidenceCount: 1,
    })).toMatchObject({
      acceptAriaDisabled: false,
      acceptLabel: 'Accept refresh',
      canAccept: true,
      canReject: true,
      feedbackDetail: 'Review the proposed source refresh before accepting or rejecting it. 3 impacted evidence bindings; 1 prior binding removed from the proposal.',
      feedbackLabel: 'Refresh decision ready',
      feedbackTone: 'ready',
      rejectAriaDisabled: false,
      rejectLabel: 'Reject',
      visible: false,
    })
  })

  it('announces pending refresh proposal decisions', () => {
    expect(buildArtifactRefreshDecisionViewModel({
      impactedEvidenceCount: 2,
      pendingDecision: 'accept',
      removedEvidenceCount: 0,
    })).toMatchObject({
      acceptAriaDisabled: true,
      acceptDisabledDetail: 'Refresh decisions are locked while accepting refresh. The current Artifact revision remains available.',
      acceptLabel: 'Accepting...',
      canAccept: false,
      canReject: false,
      feedbackDetail: 'Applying the proposed source refresh. Generated blocks move to the proposed document while user-authored blocks remain protected. 2 impacted evidence bindings; 0 prior bindings removed from the proposal.',
      feedbackLabel: 'Accepting refresh',
      feedbackTone: 'pending',
      rejectAriaDisabled: true,
      rejectDisabledDetail: 'Refresh decisions are locked while accepting refresh. The current Artifact revision remains available.',
      role: 'status',
      visible: true,
    })
  })

  it('keeps failed refresh decisions retryable', () => {
    expect(buildArtifactRefreshDecisionViewModel({
      errorDecision: 'reject',
      errorMessage: 'Proposal revision changed.',
      impactedEvidenceCount: 2,
      removedEvidenceCount: 1,
    })).toMatchObject({
      acceptAriaDisabled: false,
      canAccept: true,
      canReject: true,
      feedbackDetail: 'Proposal revision changed. The refresh proposal remains open; review the diff and retry either decision. 2 impacted evidence bindings; 1 prior binding removed from the proposal.',
      feedbackLabel: 'Reject refresh failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      rejectAriaDisabled: false,
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes accepted and rejected refresh decisions', () => {
    expect(buildArtifactRefreshDecisionViewModel({
      completedDecision: 'accept',
      impactedEvidenceCount: 2,
      removedEvidenceCount: 1,
    })).toMatchObject({
      feedbackDetail: 'Refresh accepted. The proposed candidate document is applied and the refresh queue is cleared. 2 impacted evidence bindings; 1 prior binding removed from the proposal.',
      feedbackLabel: 'Refresh accepted',
      feedbackTone: 'ready',
      visible: true,
    })

    expect(buildArtifactRefreshDecisionViewModel({
      completedDecision: 'reject',
      impactedEvidenceCount: 2,
      removedEvidenceCount: 1,
    })).toMatchObject({
      feedbackDetail: 'Refresh rejected. The current candidate document remains unchanged and the proposal is closed. 2 impacted evidence bindings; 1 prior binding removed from the proposal.',
      feedbackLabel: 'Refresh rejected',
      feedbackTone: 'ready',
      visible: true,
    })
  })
})
