import type { Artifact, ArtifactRefreshProposal } from '@/api/nexus'
import { getArtifactReadiness } from './artifactReadiness'

export type ArtifactReleaseSignal = {
  label: string
  value: string
  detail: string
}

export type ArtifactReleaseStep = {
  label: string
  detail: string
  stateLabel: string
  state: 'complete' | 'active' | 'blocked' | 'pending'
}

export type ArtifactDeliveryFormat = {
  available: boolean
  behavior: 'Download' | 'Open'
  detail: string
  format: 'markdown' | 'json' | 'html' | 'pdf' | 'csv' | 'xlsx'
  href: string
  label: string
  recommended: boolean
  unavailableReason?: string
  useCase: string
}

export type ArtifactDeliveryIdentitySignal = {
  detail: string
  label: string
  value: string
}

export type ArtifactDeliveryIdentity = {
  detail: string
  filenameStem: string
  label: string
  signals: ArtifactDeliveryIdentitySignal[]
}

export type ArtifactStatusConfirmation = {
  body: string
  confirmLabel: string
  title: string
  tone: 'danger' | 'neutral'
}

export type ArtifactLifecycleFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type ArtifactLifecycleActionViewModelInput = {
  completedTarget?: ArtifactStatusTarget
  errorMessage?: string
  errorTarget?: ArtifactStatusTarget
  pendingTarget?: ArtifactStatusTarget
  publishable: boolean
  readinessDetail: string
  revisionNo: number
  targetStatus: ArtifactStatusTarget
}

export type ArtifactLifecycleActionViewModel = {
  actionLabel: string
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ArtifactLifecycleFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

export type ArtifactRefreshDecision = 'accept' | 'reject'
export type ArtifactRefreshDecisionFeedbackTone = 'error' | 'pending' | 'ready'

export type ArtifactRefreshDecisionViewModelInput = {
  completedDecision?: ArtifactRefreshDecision
  errorDecision?: ArtifactRefreshDecision
  errorMessage?: string
  impactedEvidenceCount: number
  pendingDecision?: ArtifactRefreshDecision
  removedEvidenceCount: number
}

export type ArtifactRefreshDecisionViewModel = {
  acceptAriaDisabled: boolean
  acceptDisabledDetail?: string
  acceptLabel: string
  canAccept: boolean
  canReject: boolean
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ArtifactRefreshDecisionFeedbackTone
  liveMode: 'assertive' | 'polite'
  rejectAriaDisabled: boolean
  rejectDisabledDetail?: string
  rejectLabel: string
  role: 'alert' | 'status'
  visible: boolean
}

export type ArtifactCopyLinkState = 'copied' | 'copying' | 'failed' | 'idle'

export type ArtifactCopyLinkViewModelInput = {
  artifactTitle: string
  revisionNo: number
  state: ArtifactCopyLinkState
}

export type ArtifactCopyLinkViewModel = {
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  submitLabel: string
  visible: boolean
}

export type ArtifactDraftEditorSignal = {
  detail: string
  label: string
  value: string
}

export type ArtifactDraftEditorAction = {
  ariaDisabled: boolean
  canSubmit: boolean
  detail: string
  disabledDetail?: string
  enabled: boolean
  label: string
}

export type ArtifactDraftAutosaveRecord = {
  artifactId: string
  draft: string
  revisionId: string
  revisionNo: number
  savedAt: string
}

export type ArtifactDraftAutosaveNotice = {
  detail: string
  discardLabel: string
  keepLabel: string
  savedLabel: string
  title: string
}

export type ArtifactDraftAutosaveBeacon = {
  actionLabel: string
  ariaLabel: string
  detail: string
  savedLabel: string
  title: string
}

export type ArtifactDraftEditorState = 'invalid' | 'ready' | 'unchanged'

export type ArtifactDraftEditorViewModel = {
  canSave: boolean
  detail: string
  errorDetail?: string
  errorTitle?: string
  formatAction: ArtifactDraftEditorAction
  formattedDraft?: string
  parsedDocument?: Record<string, unknown>
  restoreAction: ArtifactDraftEditorAction
  restoredDraft: string
  saveAriaDisabled: boolean
  saveDisabledDetail?: string
  saveLabel: string
  signals: ArtifactDraftEditorSignal[]
  state: ArtifactDraftEditorState
  stateLabel: string
  title: string
}

export type ArtifactPageViewModel = {
  deliveryDetail: string
  deliveryFormats: ArtifactDeliveryFormat[]
  deliveryIdentity: ArtifactDeliveryIdentity
  deliveryLabel: string
  lifecycleDetail: string
  lifecycleLabel: string
  releaseSignals: ArtifactReleaseSignal[]
  releaseSteps: ArtifactReleaseStep[]
  tone: 'positive' | 'warning' | 'negative'
}

export type ArtifactStatusTarget = 'candidate' | 'published'

export function buildArtifactPageViewModel(
  artifact: Artifact,
  pendingRefresh?: ArtifactRefreshProposal | null,
): ArtifactPageViewModel {
  const readiness = getArtifactReadiness(artifact)
  const isPublished = artifact.status === 'published'
  return {
    deliveryDetail: isPublished
      ? 'Published exports are safe to reuse as the current durable Artifact revision.'
      : readiness.publishable
        ? 'Candidate exports are review copies until you make an explicit publication decision.'
        : 'Resolve the blocked publication checks before treating exports as durable deliverables.',
    deliveryFormats: buildDeliveryFormats(artifact),
    deliveryIdentity: buildDeliveryIdentity(artifact),
    deliveryLabel: isPublished ? 'Live delivery pack' : 'Review delivery pack',
    lifecycleDetail: isPublished
      ? 'Stable workspace link is live; edits create a new candidate revision.'
      : readiness.publishable
        ? 'Ready for a deliberate publication decision.'
        : 'Resolve blocking checks before this Artifact can become durable knowledge.',
    lifecycleLabel: isPublished ? 'Published artifact' : 'Candidate artifact',
    releaseSignals: [
      {
        label: 'Revision',
        value: `v${artifact.revision_no}`,
        detail: artifact.revision_id.slice(0, 8),
      },
      {
        label: 'Coverage',
        value: `${artifact.coverage.coverage_percent}%`,
        detail: `${artifact.coverage.supported_block_count}/${artifact.coverage.content_block_count} blocks`,
      },
      {
        label: 'Evidence',
        value: String(artifact.coverage.bound_evidence_count),
        detail: `${artifact.evidence_revision_ids.length} bound IDs`,
      },
      {
        label: 'Refresh',
        value: pendingRefresh ? 'pending' : 'clear',
        detail: pendingRefresh
          ? `${pendingRefresh.impacted_evidence_revision_ids.length} impacted bindings`
          : 'no source refresh waiting',
      },
    ],
    releaseSteps: [
      {
        label: 'Candidate',
        detail: 'Generated or edited content is isolated from published knowledge.',
        stateLabel: isPublished ? 'Cleared' : 'Current',
        state: isPublished ? 'complete' : 'active',
      },
      {
        label: 'Publication gate',
        detail: readiness.detail,
        stateLabel: readiness.publishable ? (isPublished ? 'Cleared' : 'Current') : 'Blocked',
        state: readiness.publishable ? (isPublished ? 'complete' : 'active') : 'blocked',
      },
      {
        label: 'Published',
        detail: 'Stable link, export routes and evidence bindings are ready for reuse.',
        stateLabel: isPublished ? 'Live' : 'Waiting',
        state: isPublished ? 'active' : 'pending',
      },
    ],
    tone: readiness.tone,
  }
}

function buildDeliveryIdentity(artifact: Artifact): ArtifactDeliveryIdentity {
  return {
    detail: (
      'Saved files and HTTP responses carry the same identity, so forwarded exports '
      + 'remain traceable back to this exact Artifact revision.'
    ),
    filenameStem: artifactDeliveryFilenameStem(artifact),
    label: 'Delivery identity',
    signals: [
      {
        detail: 'Used by automated archives and downstream audit tools.',
        label: 'Revision header',
        value: 'X-Nexus-Artifact-Revision',
      },
      {
        detail: 'Mirrors the publication state embedded in the delivery cover.',
        label: 'Lifecycle header',
        value: artifact.status,
      },
      {
        detail: `${artifact.coverage.bound_evidence_count} evidence bindings travel with each rendered packet.`,
        label: 'Coverage header',
        value: `${artifact.coverage.coverage_percent}%`,
      },
    ],
  }
}

function buildDeliveryFormats(artifact: Artifact): ArtifactDeliveryFormat[] {
  const base = `/api/v1/artifacts/${artifact.id}/render?format=`
  const hasTableBlocks = artifactHasTableBlocks(artifact)
  return [
    {
      available: true,
      behavior: 'Open',
      detail: 'Readable in any browser for fast stakeholder review.',
      format: 'html',
      href: `${base}html`,
      label: 'HTML preview',
      recommended: artifact.status !== 'published',
      useCase: 'Review in browser',
    },
    {
      available: true,
      behavior: 'Download',
      detail: 'Stable layout for board packs, external handoff and archival.',
      format: 'pdf',
      href: `${base}pdf`,
      label: 'PDF packet',
      recommended: artifact.status === 'published',
      useCase: 'Formal delivery',
    },
    {
      available: true,
      behavior: 'Open',
      detail: 'Portable plain-text report with citation labels and source receipts intact.',
      format: 'markdown',
      href: `${base}markdown`,
      label: 'Markdown',
      recommended: false,
      useCase: 'Knowledge base handoff',
    },
    {
      available: true,
      behavior: 'Open',
      detail: 'Exact canonical schema for automation, diffing and audits.',
      format: 'json',
      href: `${base}json`,
      label: 'Canonical JSON',
      recommended: false,
      useCase: 'Structured archive',
    },
    {
      available: hasTableBlocks,
      behavior: 'Download',
      detail: hasTableBlocks
        ? 'Flat table extract for quick imports and lightweight analysis.'
        : 'Requires at least one canonical table block.',
      format: 'csv',
      href: `${base}csv`,
      label: 'CSV extract',
      recommended: false,
      unavailableReason: hasTableBlocks ? undefined : 'No table blocks',
      useCase: hasTableBlocks ? 'Single-table analysis' : 'Table export unavailable',
    },
    {
      available: hasTableBlocks,
      behavior: 'Download',
      detail: hasTableBlocks
        ? 'Spreadsheet workbook with a delivery manifest sheet for analyst handoff.'
        : 'Requires at least one canonical table block.',
      format: 'xlsx',
      href: `${base}xlsx`,
      label: 'XLSX workbook',
      recommended: false,
      unavailableReason: hasTableBlocks ? undefined : 'No table blocks',
      useCase: hasTableBlocks ? 'Spreadsheet review' : 'Table export unavailable',
    },
  ]
}

function safeSlug(value: unknown, fallback: string, maxLength = 72) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return slug || fallback
}

function artifactDeliveryFilenameStem(artifact: Artifact) {
  const title = safeSlug(artifact.title, '', 72) || `artifact-${safeSlug(artifact.id, 'unknown', 8)}`
  const status = safeSlug(artifact.status, 'candidate', 24)
  const revision = safeSlug(artifact.revision_id, 'revision', 8)
  return `${title}-${status}-v${artifact.revision_no}-${revision}`
}

function artifactHasTableBlocks(artifact: Artifact) {
  const blocks = artifact.canonical_document.blocks
  return Array.isArray(blocks) && blocks.some((block) =>
    block && typeof block === 'object' && !Array.isArray(block) && (block as { type?: unknown }).type === 'table',
  )
}

export function buildArtifactCopyLinkViewModel({
  artifactTitle,
  revisionNo,
  state,
}: ArtifactCopyLinkViewModelInput): ArtifactCopyLinkViewModel {
  const title = artifactTitle.trim() || 'this Artifact'

  if (state === 'copying') {
    return {
      feedbackDetail: `Copying the stable workspace URL for ${title} revision v${revisionNo}. The Artifact lifecycle and evidence bindings remain unchanged.`,
      feedbackLabel: 'Copying workspace link',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copying...',
      visible: true,
    }
  }

  if (state === 'copied') {
    return {
      feedbackDetail: `${title} revision v${revisionNo} workspace link is on the clipboard. The URL resolves to the current published revision.`,
      feedbackLabel: 'Workspace link copied',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copy workspace link',
      visible: true,
    }
  }

  if (state === 'failed') {
    return {
      feedbackDetail: `Clipboard access failed. Copy ${title} revision v${revisionNo} from the browser address bar; the published URL remains stable.`,
      feedbackLabel: 'Workspace link was not copied',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try copy again',
      visible: true,
    }
  }

  return {
    feedbackDetail: `Copies the stable workspace URL for ${title} revision v${revisionNo}. It does not change the Artifact lifecycle or evidence bindings.`,
    feedbackLabel: 'Workspace link ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    submitLabel: 'Copy workspace link',
    visible: false,
  }
}

export function buildArtifactDraftEditorViewModel(
  draft: string,
  artifact: Artifact,
): ArtifactDraftEditorViewModel {
  const validation = parseArtifactDraftDocument(draft)
  const nextRevision = artifact.revision_no + 1
  const restoredDraft = buildArtifactDraftText(artifact)
  const restoreAction = buildRestoreDraftAction(draft, restoredDraft)
  if (!validation.ok) {
    return {
      canSave: false,
      detail: 'Repair the canonical JSON before creating a new revision.',
      errorDetail: validation.detail,
      errorTitle: validation.title,
      formatAction: {
        ariaDisabled: true,
        canSubmit: false,
        detail: 'Repair JSON syntax before the editor can safely format this draft.',
        disabledDetail: 'Repair JSON syntax before formatting the canonical draft.',
        enabled: false,
        label: 'Format JSON',
      },
      restoreAction,
      restoredDraft,
      saveAriaDisabled: true,
      saveDisabledDetail: 'Repair the canonical JSON before creating a new revision.',
      saveLabel: 'Resolve JSON issue',
      signals: [
        {
          detail: 'The editor cannot create a revision until the JSON parses cleanly.',
          label: 'Syntax',
          value: 'Blocked',
        },
        {
          detail: `A valid save will create revision v${nextRevision}.`,
          label: 'Next revision',
          value: `v${nextRevision}`,
        },
        {
          detail: 'Evidence bindings stay immutable unless the canonical document changes them explicitly.',
          label: 'Evidence',
          value: 'Guarded',
        },
      ],
      state: 'invalid',
      stateLabel: 'Needs repair',
      title: 'Canonical JSON editor',
    }
  }

  const document = validation.document
  const unchanged = JSON.stringify(document) === JSON.stringify(artifact.canonical_document)
  const formattedDraft = JSON.stringify(document, null, 2)
  const canFormat = formattedDraft !== draft
  const blocks = Array.isArray(document.blocks) ? document.blocks.length : 0
  const schema = typeof document.schema === 'string' ? document.schema : 'missing'
  return {
    canSave: !unchanged,
    detail: unchanged
      ? 'This draft matches the current canonical revision.'
      : 'Saving creates a new candidate revision with immutable evidence boundaries preserved.',
    formatAction: {
      ariaDisabled: !canFormat,
      canSubmit: canFormat,
      detail: 'Normalize indentation without changing canonical content.',
      disabledDetail: canFormat ? undefined : 'Canonical JSON is already formatted.',
      enabled: canFormat,
      label: 'Format JSON',
    },
    formattedDraft,
    parsedDocument: document,
    restoreAction,
    restoredDraft,
    saveAriaDisabled: unchanged,
    saveDisabledDetail: unchanged ? 'Edit the canonical JSON before saving a new Artifact revision.' : undefined,
    saveLabel: unchanged ? 'No changes to save' : 'Save new revision',
    signals: [
      {
        detail: 'The document keeps the canonical block envelope.',
        label: 'Schema',
        value: schema,
      },
      {
        detail: 'Headings, paragraphs, tables and evidence lists remain ordered in this array.',
        label: 'Blocks',
        value: String(blocks),
      },
      {
        detail: 'Saving never mutates the currently published revision in place.',
        label: 'Next revision',
        value: `v${nextRevision}`,
      },
    ],
    state: unchanged ? 'unchanged' : 'ready',
    stateLabel: unchanged ? 'No changes' : 'Ready to save',
    title: 'Canonical JSON editor',
  }
}

export function buildArtifactDraftText(artifact: Artifact) {
  return JSON.stringify(artifact.canonical_document, null, 2)
}

export function buildArtifactDraftAutosaveKey(artifact: Artifact) {
  return `nexus.artifact-draft.${artifact.id}.${artifact.revision_id}`
}

export function buildArtifactDraftAutosaveRecord(
  artifact: Artifact,
  draft: string,
  savedAt: Date = new Date(),
): ArtifactDraftAutosaveRecord {
  return {
    artifactId: artifact.id,
    draft,
    revisionId: artifact.revision_id,
    revisionNo: artifact.revision_no,
    savedAt: savedAt.toISOString(),
  }
}

export function parseArtifactDraftAutosaveRecord(
  value: string | null,
  artifact: Artifact,
): ArtifactDraftAutosaveRecord | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Partial<ArtifactDraftAutosaveRecord>
  if (
    record.artifactId !== artifact.id
    || record.revisionId !== artifact.revision_id
    || typeof record.draft !== 'string'
    || typeof record.savedAt !== 'string'
  ) {
    return null
  }
  return {
    artifactId: record.artifactId,
    draft: record.draft,
    revisionId: record.revisionId,
    revisionNo: typeof record.revisionNo === 'number' ? record.revisionNo : artifact.revision_no,
    savedAt: record.savedAt,
  }
}

export function parseRecoverableArtifactDraftAutosaveRecord(
  value: string | null,
  artifact: Artifact,
): ArtifactDraftAutosaveRecord | null {
  const record = parseArtifactDraftAutosaveRecord(value, artifact)
  if (!record || record.draft === buildArtifactDraftText(artifact)) return null
  return record
}

export function buildArtifactDraftAutosaveBeacon(
  record: ArtifactDraftAutosaveRecord,
): ArtifactDraftAutosaveBeacon {
  const savedLabel = buildArtifactDraftAutosaveSavedLabel(record)
  return {
    actionLabel: 'Review draft',
    ariaLabel: (
      `Session draft available for revision v${record.revisionNo}. `
      + `${savedLabel}. Review the browser-saved draft.`
    ),
    detail: (
      `A browser-saved canonical JSON draft exists for revision v${record.revisionNo}. `
      + 'Open Advanced edit to review it before creating a new revision.'
    ),
    savedLabel,
    title: 'Session draft available',
  }
}

export function buildArtifactDraftAutosaveNotice(
  record: ArtifactDraftAutosaveRecord,
): ArtifactDraftAutosaveNotice {
  return {
    detail: (
      `Recovered an unsaved canonical JSON draft for revision v${record.revisionNo}. `
      + 'Keep editing to turn it into a new revision, or restore current to discard it.'
    ),
    discardLabel: 'Restore current',
    keepLabel: 'Keep editing',
    savedLabel: buildArtifactDraftAutosaveSavedLabel(record),
    title: 'Session draft recovered',
  }
}

export function buildArtifactDraftDiscardConfirmation(
  artifact: Artifact,
): ArtifactStatusConfirmation {
  return {
    body: (
      `This closes the editor and discards the unsaved canonical JSON draft. `
      + `No revision will be created; the Artifact remains on revision v${artifact.revision_no}.`
    ),
    confirmLabel: 'Discard draft',
    title: 'Discard unsaved JSON changes?',
    tone: 'danger',
  }
}

type DraftParseResult =
  | { document: Record<string, unknown>; ok: true }
  | { detail: string; ok: false; title: string }

function buildRestoreDraftAction(draft: string, restoredDraft: string): ArtifactDraftEditorAction {
  const canSubmit = draft !== restoredDraft
  return {
    ariaDisabled: !canSubmit,
    canSubmit,
    detail: 'Replace the editor contents with the current immutable revision.',
    disabledDetail: canSubmit ? undefined : 'The editor already matches the current immutable revision.',
    enabled: canSubmit,
    label: 'Restore current',
  }
}

function buildArtifactDraftAutosaveSavedLabel(record: ArtifactDraftAutosaveRecord) {
  return `Session save · ${record.savedAt.replace('T', ' ').replace('.000Z', 'Z')}`
}

function parseArtifactDraftDocument(draft: string): DraftParseResult {
  if (!draft.trim()) {
    return {
      detail: 'Paste or restore a canonical block document before saving.',
      ok: false,
      title: 'Draft is empty.',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(draft)
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : 'The draft is not valid JSON.',
      ok: false,
      title: 'JSON syntax error.',
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      detail: 'The canonical Artifact document must be a JSON object, not an array or scalar.',
      ok: false,
      title: 'Document envelope is invalid.',
    }
  }

  const document = parsed as Record<string, unknown>
  if (!Array.isArray(document.blocks)) {
    return {
      detail: 'Keep `blocks` as an array so renderers can preserve the document order.',
      ok: false,
      title: 'Blocks array is missing.',
    }
  }

  return { document, ok: true }
}

export function buildArtifactStatusConfirmation(
  artifact: Artifact,
  targetStatus: ArtifactStatusTarget,
): ArtifactStatusConfirmation {
  if (targetStatus === 'published') {
    return {
      body: `This promotes revision v${artifact.revision_no} as the reusable workspace Artifact. Future edits create a new candidate revision; existing evidence bindings remain auditable.`,
      confirmLabel: 'Publish artifact',
      title: 'Publish artifact?',
      tone: 'neutral',
    }
  }

  return {
    body: `This removes the live published state from revision v${artifact.revision_no}. The revision stays intact, but exports become review copies until the Artifact is published again.`,
    confirmLabel: 'Return to draft',
    title: 'Return to draft?',
    tone: 'danger',
  }
}

const artifactLifecycleActionCopy = {
  candidate: {
    actionLabel: 'Return to draft',
    blockedLabel: 'Return to draft unavailable',
    completedDetail: (revisionNo: number) => `Revision v${revisionNo} returned to candidate review. The immutable revision remains intact; exports are review copies until republished.`,
    completedLabel: 'Artifact returned to draft',
    idleDetail: (revisionNo: number) => `Ready to remove the live published state from revision v${revisionNo}. The revision stays auditable and can be republished later.`,
    idleLabel: 'Return to draft ready',
    pendingDetail: (revisionNo: number) => `Returning revision v${revisionNo} to candidate review. Existing revision data and evidence bindings remain intact.`,
    pendingLabel: 'Returning to draft',
    pendingSubmitLabel: 'Returning...',
  },
  published: {
    actionLabel: 'Publish',
    blockedLabel: 'Publication blocked',
    completedDetail: (revisionNo: number) => `Revision v${revisionNo} is now the live workspace Artifact. Stable delivery links and exports are ready to reuse.`,
    completedLabel: 'Artifact published',
    idleDetail: (revisionNo: number) => `Ready to publish revision v${revisionNo} as durable workspace knowledge. Future edits create a new candidate revision.`,
    idleLabel: 'Publication ready',
    pendingDetail: (revisionNo: number) => `Publishing revision v${revisionNo}. Evidence bindings and delivery identity stay attached to this immutable revision.`,
    pendingLabel: 'Publishing artifact',
    pendingSubmitLabel: 'Publishing...',
  },
} satisfies Record<ArtifactStatusTarget, {
  actionLabel: string
  blockedLabel: string
  completedDetail: (revisionNo: number) => string
  completedLabel: string
  idleDetail: (revisionNo: number) => string
  idleLabel: string
  pendingDetail: (revisionNo: number) => string
  pendingLabel: string
  pendingSubmitLabel: string
}>

export function buildArtifactLifecycleActionViewModel({
  completedTarget,
  errorMessage,
  errorTarget,
  pendingTarget,
  publishable,
  readinessDetail,
  revisionNo,
  targetStatus,
}: ArtifactLifecycleActionViewModelInput): ArtifactLifecycleActionViewModel {
  const copy = artifactLifecycleActionCopy[targetStatus]
  const busy = Boolean(pendingTarget)
  const canSubmit = !busy && (targetStatus === 'candidate' || publishable)
  const actionLabel = pendingTarget === targetStatus
    ? copy.pendingSubmitLabel
    : copy.actionLabel

  if (pendingTarget) {
    const pendingCopy = artifactLifecycleActionCopy[pendingTarget]
    return {
      actionLabel,
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: `${copy.actionLabel} is locked while ${pendingCopy.pendingLabel.toLowerCase()} for revision v${revisionNo}. Evidence bindings and delivery identity remain preserved.`,
      feedbackDetail: pendingCopy.pendingDetail(revisionNo),
      feedbackLabel: pendingCopy.pendingLabel,
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorTarget && errorMessage) {
    const errorCopy = artifactLifecycleActionCopy[errorTarget]
    return {
      actionLabel,
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : readinessDetail,
      feedbackDetail: `${errorMessage} Revision v${revisionNo} remains in its previous lifecycle state and can be retried when the gate is still available.`,
      feedbackLabel: `${errorCopy.actionLabel} failed`,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (completedTarget) {
    const completedCopy = artifactLifecycleActionCopy[completedTarget]
    return {
      actionLabel,
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : readinessDetail,
      feedbackDetail: completedCopy.completedDetail(revisionNo),
      feedbackLabel: completedCopy.completedLabel,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (targetStatus === 'published' && !publishable) {
    return {
      actionLabel,
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: readinessDetail,
      feedbackDetail: readinessDetail,
      feedbackLabel: copy.blockedLabel,
      feedbackTone: 'blocked',
      liveMode: 'polite',
      role: 'status',
      visible: false,
    }
  }

  return {
    actionLabel,
    ariaDisabled: !canSubmit,
    canSubmit,
    disabledDetail: canSubmit ? undefined : readinessDetail,
    feedbackDetail: copy.idleDetail(revisionNo),
    feedbackLabel: copy.idleLabel,
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}

function evidenceBindingSummary(impactedEvidenceCount: number, removedEvidenceCount: number) {
  const impacted = `${impactedEvidenceCount} impacted evidence binding${impactedEvidenceCount === 1 ? '' : 's'}`
  const removed = `${removedEvidenceCount} prior binding${removedEvidenceCount === 1 ? '' : 's'} removed from the proposal`
  return `${impacted}; ${removed}.`
}

const artifactRefreshDecisionCopy = {
  accept: {
    completedDetail: (summary: string) => `Refresh accepted. The proposed candidate document is applied and the refresh queue is cleared. ${summary}`,
    completedLabel: 'Refresh accepted',
    errorLabel: 'Accept refresh failed',
    pendingDetail: (summary: string) => `Applying the proposed source refresh. Generated blocks move to the proposed document while user-authored blocks remain protected. ${summary}`,
    pendingLabel: 'Accepting refresh',
  },
  reject: {
    completedDetail: (summary: string) => `Refresh rejected. The current candidate document remains unchanged and the proposal is closed. ${summary}`,
    completedLabel: 'Refresh rejected',
    errorLabel: 'Reject refresh failed',
    pendingDetail: (summary: string) => `Rejecting the proposed source refresh. The current Artifact revision and evidence bindings remain unchanged. ${summary}`,
    pendingLabel: 'Rejecting refresh',
  },
} satisfies Record<ArtifactRefreshDecision, {
  completedDetail: (summary: string) => string
  completedLabel: string
  errorLabel: string
  pendingDetail: (summary: string) => string
  pendingLabel: string
}>

export function buildArtifactRefreshDecisionViewModel({
  completedDecision,
  errorDecision,
  errorMessage,
  impactedEvidenceCount,
  pendingDecision,
  removedEvidenceCount,
}: ArtifactRefreshDecisionViewModelInput): ArtifactRefreshDecisionViewModel {
  const summary = evidenceBindingSummary(impactedEvidenceCount, removedEvidenceCount)
  const acceptLabel = pendingDecision === 'accept' ? 'Accepting...' : 'Accept refresh'
  const rejectLabel = pendingDecision === 'reject' ? 'Rejecting...' : 'Reject'
  const busy = Boolean(pendingDecision)

  if (pendingDecision) {
    const copy = artifactRefreshDecisionCopy[pendingDecision]
    const lockedDetail = `Refresh decisions are locked while ${copy.pendingLabel.toLowerCase()}. The current Artifact revision remains available.`
    return {
      acceptAriaDisabled: true,
      acceptDisabledDetail: lockedDetail,
      acceptLabel,
      canAccept: false,
      canReject: false,
      feedbackDetail: copy.pendingDetail(summary),
      feedbackLabel: copy.pendingLabel,
      feedbackTone: 'pending',
      liveMode: 'polite',
      rejectAriaDisabled: true,
      rejectDisabledDetail: lockedDetail,
      rejectLabel,
      role: 'status',
      visible: true,
    }
  }

  if (errorDecision && errorMessage) {
    const copy = artifactRefreshDecisionCopy[errorDecision]
    return {
      acceptAriaDisabled: false,
      acceptLabel,
      canAccept: true,
      canReject: true,
      feedbackDetail: `${errorMessage} The refresh proposal remains open; review the diff and retry either decision. ${summary}`,
      feedbackLabel: copy.errorLabel,
      feedbackTone: 'error',
      liveMode: 'assertive',
      rejectAriaDisabled: false,
      rejectLabel,
      role: 'alert',
      visible: true,
    }
  }

  if (completedDecision) {
    const copy = artifactRefreshDecisionCopy[completedDecision]
    return {
      acceptAriaDisabled: false,
      acceptLabel,
      canAccept: true,
      canReject: true,
      feedbackDetail: copy.completedDetail(summary),
      feedbackLabel: copy.completedLabel,
      feedbackTone: 'ready',
      liveMode: 'polite',
      rejectAriaDisabled: false,
      rejectLabel,
      role: 'status',
      visible: true,
    }
  }

  return {
    acceptAriaDisabled: false,
    acceptLabel,
    canAccept: !busy,
    canReject: !busy,
    feedbackDetail: `Review the proposed source refresh before accepting or rejecting it. ${summary}`,
    feedbackLabel: 'Refresh decision ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    rejectAriaDisabled: false,
    rejectLabel,
    role: 'status',
    visible: false,
  }
}
