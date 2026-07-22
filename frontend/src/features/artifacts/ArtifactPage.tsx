import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Clipboard, Code2, Download, FileJson, FileSpreadsheet, FileText, Pencil, RefreshCw, Save, Send, ShieldAlert, ShieldCheck, Undo2, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { ConfirmDialog } from '@/components/nexus/ConfirmDialog'
import { EmptyState } from '@/components/nexus/EmptyState'
import { InlineNotice } from '@/components/nexus/InlineNotice'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { StatusMark } from '@/components/nexus/StatusMark'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { readBrowserStorageItem, removeBrowserStorageItem, writeBrowserStorageItem } from '@/lib/browserStorage'
import { copyTextToClipboard } from '@/lib/clipboard'
import { ArtifactCoverageMeter } from './ArtifactCoverageMeter'
import { ArtifactDocument } from './ArtifactDocument'
import {
  buildArtifactDraftAutosaveBeacon,
  buildArtifactDraftAutosaveKey,
  buildArtifactDraftAutosaveNotice,
  buildArtifactDraftAutosaveRecord,
  buildArtifactDraftDiscardConfirmation,
  buildArtifactDraftText,
  buildArtifactCopyLinkViewModel,
  buildArtifactDraftEditorViewModel,
  buildArtifactLifecycleActionViewModel,
  buildArtifactPageViewModel,
  buildArtifactRefreshDecisionViewModel,
  buildArtifactStatusConfirmation,
  parseRecoverableArtifactDraftAutosaveRecord,
} from './artifactPageViewModel'
import { getArtifactReadiness } from './artifactReadiness'
import './ArtifactPage.css'
import type {
  ArtifactDeliveryFormat,
  ArtifactCopyLinkState,
  ArtifactDraftAutosaveNotice,
  ArtifactDraftAutosaveRecord,
  ArtifactDraftEditorViewModel,
  ArtifactRefreshDecision,
  ArtifactStatusTarget,
} from './artifactPageViewModel'

const artifactLifecycleFeedbackId = 'artifact-lifecycle-feedback'
const artifactLifecycleGateId = 'artifact-lifecycle-gate'
const artifactCopyFeedbackId = 'artifact-copy-feedback'
const artifactRefreshFeedbackId = 'artifact-refresh-feedback'
const artifactRefreshAcceptGateId = 'artifact-refresh-accept-gate'
const artifactRefreshRejectGateId = 'artifact-refresh-reject-gate'

type ArtifactRefreshDecisionReceipt = {
  decision: ArtifactRefreshDecision
  impactedEvidenceCount: number
  removedEvidenceCount: number
}

function DeliveryFormatIcon({ format }: { format: ArtifactDeliveryFormat['format'] }) {
  if (format === 'json') return <FileJson size={17} />
  if (format === 'html') return <Code2 size={17} />
  if (format === 'csv' || format === 'xlsx') return <FileSpreadsheet size={17} />
  if (format === 'pdf') return <Download size={17} />
  return <FileText size={17} />
}

function DeliveryFormatContent({ format }: { format: ArtifactDeliveryFormat }) {
  return <>
    <span><DeliveryFormatIcon format={format.format} /></span>
    <strong>{format.label}</strong>
    <small>{format.useCase}</small>
    <em>{format.detail}</em>
    <b>{format.available ? (format.recommended ? 'Recommended' : format.behavior) : 'Unavailable'}</b>
  </>
}

function ArtifactJsonEditor({
  autosaveNotice,
  draft,
  editor,
  error,
  pending,
  onChange,
  onClose,
  onDiscardAutosave,
  onDismissAutosave,
  onFormat,
  onSave,
  onRestore,
}: {
  autosaveNotice?: ArtifactDraftAutosaveNotice | null
  draft: string
  editor: ArtifactDraftEditorViewModel
  error?: Error | null
  pending: boolean
  onChange: (value: string) => void
  onClose: () => void
  onDiscardAutosave: () => void
  onDismissAutosave: () => void
  onFormat: () => void
  onSave: () => void
  onRestore: () => void
}) {
  const formatGateId = 'artifact-json-editor-format-gate'
  const restoreGateId = 'artifact-json-editor-restore-gate'
  const saveGateId = 'artifact-json-editor-save-gate'
  const saveDisabledDetail = pending
    ? 'Revision save is locked while the new Artifact revision is being persisted.'
    : editor.saveDisabledDetail
  return <section className={`artifact-json-editor ${editor.state}`}>
    <div>
      <span>
        <strong>Advanced · {editor.title}</strong>
        <small>{editor.detail}</small>
      </span>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Close editor">
        <X size={16} />
      </button>
    </div>
    <div
      aria-label="Canonical JSON save checks"
      className="artifact-json-editor-ledger"
      id="artifact-json-editor-status"
    >
      <strong>{editor.stateLabel}</strong>
      {editor.signals.map((signal) => (
        <span key={signal.label} aria-label={`${signal.label}: ${signal.value}. ${signal.detail}`}>
          <small>{signal.label}</small>
          <b>{signal.value}</b>
          <em>{signal.detail}</em>
        </span>
      ))}
    </div>
    {editor.errorTitle && <div className="artifact-json-editor-alert" role="alert">
      <ShieldAlert size={16} />
      <span>
        <strong>{editor.errorTitle}</strong>
        <small>{editor.errorDetail}</small>
      </span>
    </div>}
    {autosaveNotice && <div className="artifact-json-autosave" role="status">
      <ShieldCheck size={16} />
      <span>
        <strong>{autosaveNotice.title}</strong>
        <small>{autosaveNotice.detail}</small>
        <em>{autosaveNotice.savedLabel}</em>
      </span>
      <div>
        <button type="button" className="button" onClick={onDismissAutosave}>{autosaveNotice.keepLabel}</button>
        <button type="button" className="button danger-quiet" onClick={onDiscardAutosave}>
          {autosaveNotice.discardLabel}
        </button>
      </div>
    </div>}
    <div className="artifact-json-editor-tools" aria-label="Canonical JSON editor helpers">
      <button
        type="button"
        className="button"
        aria-describedby={`artifact-json-editor-status${editor.formatAction.disabledDetail ? ` ${formatGateId}` : ''}`}
        aria-disabled={editor.formatAction.ariaDisabled || undefined}
        onClick={() => { if (editor.formatAction.canSubmit) onFormat() }}
        title={editor.formatAction.detail}
      >
        <Code2 size={14} />
        {editor.formatAction.label}
      </button>
      {editor.formatAction.disabledDetail && <span className="sr-only" id={formatGateId}>{editor.formatAction.disabledDetail}</span>}
      <button
        type="button"
        className="button"
        aria-describedby={`artifact-json-editor-status${editor.restoreAction.disabledDetail ? ` ${restoreGateId}` : ''}`}
        aria-disabled={editor.restoreAction.ariaDisabled || undefined}
        onClick={() => { if (editor.restoreAction.canSubmit) onRestore() }}
        title={editor.restoreAction.detail}
      >
        <Undo2 size={14} />
        {editor.restoreAction.label}
      </button>
      {editor.restoreAction.disabledDetail && <span className="sr-only" id={restoreGateId}>{editor.restoreAction.disabledDetail}</span>}
    </div>
    <textarea
      aria-describedby="artifact-json-editor-status"
      aria-invalid={editor.state === 'invalid'}
      aria-label="Canonical JSON"
      value={draft}
      onChange={(event) => onChange(event.target.value)}
      rows={18}
      spellCheck={false}
    />
    {error && <InlineNotice tone="negative">
      <strong>Revision was not saved.</strong>
      <span>{error.message}</span>
    </InlineNotice>}
    <button
      type="button"
      className="button primary"
      aria-describedby={`artifact-json-editor-status${saveDisabledDetail ? ` ${saveGateId}` : ''}`}
      aria-disabled={pending || editor.saveAriaDisabled || undefined}
      onClick={() => { if (!pending && editor.canSave) onSave() }}
    >
      <Save size={15} />
      {pending ? 'Saving revision…' : editor.saveLabel}
    </button>
    {saveDisabledDetail && <span className="sr-only" id={saveGateId}>{saveDisabledDetail}</span>}
  </section>
}

export default function ArtifactPage() {
  const { artifactId = '' } = useParams()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [availableAutosaveRecord, setAvailableAutosaveRecord] = useState<ArtifactDraftAutosaveRecord | null>(null)
  const [autosaveRecoveryRecord, setAutosaveRecoveryRecord] = useState<ArtifactDraftAutosaveRecord | null>(null)
  const [autosaveNoticeDismissed, setAutosaveNoticeDismissed] = useState(false)
  const [draftCloseRequested, setDraftCloseRequested] = useState(false)
  const [copyLinkState, setCopyLinkState] = useState<ArtifactCopyLinkState>('idle')
  const [statusTarget, setStatusTarget] = useState<ArtifactStatusTarget | null>(null)
  const [statusReceipt, setStatusReceipt] = useState<ArtifactStatusTarget | null>(null)
  const [refreshReceipt, setRefreshReceipt] = useState<ArtifactRefreshDecisionReceipt | null>(null)
  const artifact = useQuery({ queryKey: ['artifact', artifactId], queryFn: () => nexusApi.getArtifact(artifactId), enabled: Boolean(artifactId) })
  const proposals = useQuery({ queryKey: ['artifact-refresh-proposals', artifactId], queryFn: () => nexusApi.listArtifactRefreshProposals(artifactId), enabled: Boolean(artifactId) })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: artifact.error, hasData: Boolean(artifact.data), label: 'Artifact', required: true },
    { error: proposals.error, hasData: Boolean(proposals.data), label: 'Refresh proposals' },
  ])
  const retryArtifactQueries = () => {
    void artifact.refetch()
    void proposals.refetch()
  }
  const clearDraftAutosave = () => {
    if (!artifact.data) return
    removeBrowserStorageItem('session', buildArtifactDraftAutosaveKey(artifact.data))
    setAvailableAutosaveRecord(null)
    setAutosaveRecoveryRecord(null)
    setAutosaveNoticeDismissed(false)
  }
  const readDraftAutosave = () => {
    if (!artifact.data) return null
    const value = readBrowserStorageItem('session', buildArtifactDraftAutosaveKey(artifact.data))
    return parseRecoverableArtifactDraftAutosaveRecord(value, artifact.data)
  }
  const revise = useMutation({
    mutationFn: (canonical: Record<string, unknown>) => {
      return nexusApi.reviseArtifact(artifactId, {
        expected_revision_no: artifact.data?.revision_no ?? 0,
        canonical_document: canonical,
      })
    },
    onSuccess: (value) => {
      queryClient.setQueryData(['artifact', artifactId], value)
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
      clearDraftAutosave()
      setDraft(null)
      setDraftCloseRequested(false)
    },
  })
  const changeStatus = useMutation({
    mutationFn: (status: 'candidate' | 'published') => nexusApi.setArtifactStatus(artifactId, {
      expected_revision_no: artifact.data?.revision_no ?? 0,
      status,
    }),
    onMutate: () => setStatusReceipt(null),
    onSuccess: (value, target) => {
      queryClient.setQueryData(['artifact', artifactId], value)
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
      setStatusReceipt(target)
    },
    onSettled: () => setStatusTarget(null),
  })
  const resolveRefresh = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => nexusApi.resolveArtifactRefreshProposal(id, accept),
    onMutate: () => setRefreshReceipt(null),
    onSuccess: (_value, variables) => {
      if (pendingRefresh) {
        setRefreshReceipt({
          decision: variables.accept ? 'accept' : 'reject',
          impactedEvidenceCount: pendingRefresh.impacted_evidence_revision_ids.length,
          removedEvidenceCount: Array.isArray(pendingRefresh.diff.removed_evidence_revision_ids)
            ? pendingRefresh.diff.removed_evidence_revision_ids.length
            : 0,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['artifact', artifactId] })
      queryClient.invalidateQueries({ queryKey: ['artifact-refresh-proposals', artifactId] })
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
    },
  })
  const copyWorkspaceLink = async () => {
    if (copyLinkState === 'copying') return
    setCopyLinkState('copying')
    try {
      await copyTextToClipboard(window.location.href)
      setCopyLinkState('copied')
    } catch {
      setCopyLinkState('failed')
    }
  }
  useEffect(() => {
    if (copyLinkState === 'idle' || copyLinkState === 'copying') return
    const timer = window.setTimeout(() => setCopyLinkState('idle'), 2400)
    return () => window.clearTimeout(timer)
  }, [copyLinkState])
  useEffect(() => {
    if (!artifact.data) {
      setAvailableAutosaveRecord(null)
      setAutosaveRecoveryRecord(null)
      return
    }
    setAutosaveNoticeDismissed(false)
    setAvailableAutosaveRecord(readDraftAutosave())
    setAutosaveRecoveryRecord(null)
  }, [artifact.data?.id, artifact.data?.revision_id])

  useEffect(() => {
    if (!artifact.data || draft === null) return
    const currentDraft = buildArtifactDraftText(artifact.data)
    if (draft === currentDraft) {
      clearDraftAutosave()
      return
    }
    const record = buildArtifactDraftAutosaveRecord(artifact.data, draft)
    const stored = writeBrowserStorageItem(
      'session',
      buildArtifactDraftAutosaveKey(artifact.data),
      JSON.stringify(record),
    )
    if (stored) {
      setAvailableAutosaveRecord(record)
    }
  }, [artifact.data?.id, artifact.data?.revision_id, draft])

  if (artifact.isLoading) return <LoadingState />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell artifact-page"><Link className="artifact-back-link" to="/studio"><ArrowLeft size={14} />Back to Artifact Studio</Link><PageHeader eyebrow="Artifact revision" title="Artifact could not be loaded" description="Nexus could not read this artifact revision from the durable artifact ledger." /><QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactQueries} /><EmptyState title="Artifact lookup failed" body="Retry before treating this artifact as missing or deleted. Temporary API or ledger failures should not be interpreted as absence." /></div>
  if (!artifact.data) return <EmptyState title="Artifact unavailable" body="The requested Artifact or revision does not exist." />
  const readiness = getArtifactReadiness(artifact.data)
  const pendingRefresh = proposals.data?.items.find((item) => item.status === 'pending')
  const pendingRefreshRemovedEvidenceCount = pendingRefresh && Array.isArray(pendingRefresh.diff.removed_evidence_revision_ids)
    ? pendingRefresh.diff.removed_evidence_revision_ids.length
    : 0
  const pendingRefreshDecision: ArtifactRefreshDecision | undefined = resolveRefresh.variables
    ? resolveRefresh.variables.accept ? 'accept' : 'reject'
    : undefined
  const releaseDossier = buildArtifactPageViewModel(artifact.data, pendingRefresh)
  const isPublished = artifact.data.status === 'published'
  const copyLink = buildArtifactCopyLinkViewModel({
    artifactTitle: artifact.data.title,
    revisionNo: artifact.data.revision_no,
    state: copyLinkState,
  })
  const statusConfirmation = statusTarget ? buildArtifactStatusConfirmation(artifact.data, statusTarget) : null
  const statusActionTarget: ArtifactStatusTarget = isPublished ? 'candidate' : 'published'
  const lifecycleAction = buildArtifactLifecycleActionViewModel({
    completedTarget: statusReceipt ?? undefined,
    errorMessage: changeStatus.error?.message,
    errorTarget: changeStatus.error ? statusActionTarget : undefined,
    pendingTarget: changeStatus.isPending ? statusTarget ?? statusActionTarget : undefined,
    publishable: readiness.publishable,
    readinessDetail: readiness.detail,
    revisionNo: artifact.data.revision_no,
    targetStatus: statusActionTarget,
  })
  const refreshDecision = buildArtifactRefreshDecisionViewModel({
    completedDecision: refreshReceipt?.decision,
    errorDecision: resolveRefresh.error && pendingRefreshDecision ? pendingRefreshDecision : undefined,
    errorMessage: resolveRefresh.error?.message,
    impactedEvidenceCount: pendingRefresh?.impacted_evidence_revision_ids.length
      ?? refreshReceipt?.impactedEvidenceCount
      ?? 0,
    pendingDecision: resolveRefresh.isPending ? pendingRefreshDecision : undefined,
    removedEvidenceCount: pendingRefresh ? pendingRefreshRemovedEvidenceCount : refreshReceipt?.removedEvidenceCount ?? 0,
  })
  const deliveryIdentity = releaseDossier.deliveryIdentity
  const draftEditor = draft === null ? null : buildArtifactDraftEditorViewModel(draft, artifact.data)
  const autosaveBeacon = draft === null && availableAutosaveRecord
    ? buildArtifactDraftAutosaveBeacon(availableAutosaveRecord)
    : null
  const autosaveNotice = draft !== null
    && autosaveRecoveryRecord
    && !autosaveNoticeDismissed
    ? buildArtifactDraftAutosaveNotice(autosaveRecoveryRecord)
    : null
  const draftDiscardConfirmation = draftCloseRequested
    ? buildArtifactDraftDiscardConfirmation(artifact.data)
    : null
  const saveDraft = () => {
    if (!draftEditor?.canSave || !draftEditor.parsedDocument) return
    revise.mutate(draftEditor.parsedDocument)
  }
  const closeDraftEditor = () => {
    revise.reset()
    clearDraftAutosave()
    setDraft(null)
    setDraftCloseRequested(false)
  }
  const requestCloseDraftEditor = () => {
    if (draftEditor?.restoreAction.enabled) {
      setDraftCloseRequested(true)
      return
    }
    closeDraftEditor()
  }
  const openDraftEditor = () => {
    setDraftCloseRequested(false)
    setAutosaveNoticeDismissed(false)
    const currentDraft = buildArtifactDraftText(artifact.data)
    const storedDraft = readDraftAutosave()
    setAvailableAutosaveRecord(storedDraft)
    setAutosaveRecoveryRecord(storedDraft)
    setDraft(storedDraft ? storedDraft.draft : currentDraft)
  }
  const requestStatusChange = (target: ArtifactStatusTarget) => {
    changeStatus.reset()
    setStatusReceipt(null)
    setStatusTarget(target)
  }
  const resolveRefreshDecision = (accept: boolean) => {
    resolveRefresh.reset()
    setRefreshReceipt(null)
    if (pendingRefresh) resolveRefresh.mutate({ id: pendingRefresh.id, accept })
  }
  const confirmStatusChange = () => {
    if (!statusTarget) return
    changeStatus.reset()
    setStatusReceipt(null)
    changeStatus.mutate(statusTarget)
  }
  const description = isPublished
    ? 'Published in this workspace with a stable URL. Revisions remain immutable and evidence traceable.'
    : 'Candidate draft awaiting an explicit publication decision. Review evidence coverage before sharing it as knowledge.'
  return (
    <div className="page-shell artifact-page">
      <Link className="artifact-back-link" to="/studio"><ArrowLeft size={14} />Back to Artifact Studio</Link>
      <PageHeader eyebrow={`${artifact.data.artifact_type.replaceAll('_', ' ')} · revision ${artifact.data.revision_no}`} title={artifact.data.title} description={description} actions={<div className="artifact-actions">
        {isPublished ? <>
          <button type="button" className="button primary" aria-describedby={artifactCopyFeedbackId} aria-disabled={copyLinkState === 'copying'} onClick={copyWorkspaceLink}>{copyLinkState === 'copying' ? <RefreshCw className="spin" size={15} /> : copyLinkState === 'copied' ? <Check size={15} /> : copyLinkState === 'failed' ? <ShieldAlert size={15} /> : <Clipboard size={15} />}{copyLink.submitLabel}</button>
          <button type="button" className="button" aria-describedby={`${artifactLifecycleFeedbackId}${lifecycleAction.disabledDetail ? ` ${artifactLifecycleGateId}` : ''}`} aria-disabled={lifecycleAction.ariaDisabled || undefined} onClick={() => { if (lifecycleAction.canSubmit) requestStatusChange('candidate') }}><Undo2 size={15} />{lifecycleAction.actionLabel}</button>
        </> : <button type="button" className="button primary" aria-describedby={`${artifactLifecycleFeedbackId}${lifecycleAction.disabledDetail ? ` ${artifactLifecycleGateId}` : ''}`} aria-disabled={lifecycleAction.ariaDisabled || undefined} onClick={() => { if (lifecycleAction.canSubmit) requestStatusChange('published') }} title={!lifecycleAction.canSubmit ? lifecycleAction.feedbackDetail : undefined}><Send size={15} />{lifecycleAction.actionLabel}</button>}
        {lifecycleAction.disabledDetail && <span className="sr-only" id={artifactLifecycleGateId}>{lifecycleAction.disabledDetail}</span>}
        {autosaveBeacon && <button
          type="button"
          aria-label={autosaveBeacon.ariaLabel}
          className="artifact-draft-beacon"
          onClick={openDraftEditor}
          title={autosaveBeacon.detail}
        >
          <ShieldCheck size={14} />
          <span>
            <strong>{autosaveBeacon.title}</strong>
            <small>{autosaveBeacon.savedLabel}</small>
          </span>
          <em>{autosaveBeacon.actionLabel}</em>
        </button>}
        <button type="button" className="button" onClick={openDraftEditor}><Pencil size={15} />Advanced edit</button>
        <a className="button" href="#artifact-delivery-dock"><Download size={15} />Delivery</a>
      </div>} />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactQueries} />
      {statusConfirmation && <ConfirmDialog
        body={statusConfirmation.body}
        busy={changeStatus.isPending}
        confirmLabel={statusConfirmation.confirmLabel}
        open={Boolean(statusTarget)}
        title={statusConfirmation.title}
        tone={statusConfirmation.tone}
        onCancel={() => setStatusTarget(null)}
        onConfirm={confirmStatusChange}
      />}
      {draftDiscardConfirmation && <ConfirmDialog
        body={draftDiscardConfirmation.body}
        confirmLabel={draftDiscardConfirmation.confirmLabel}
        open={draftCloseRequested}
        title={draftDiscardConfirmation.title}
        tone={draftDiscardConfirmation.tone}
        onCancel={() => setDraftCloseRequested(false)}
        onConfirm={closeDraftEditor}
      />}
      {isPublished && <SubmitReadinessCard className="artifact-copy-feedback" id={artifactCopyFeedbackId} model={copyLink} />}
      <SubmitReadinessCard className="artifact-lifecycle-feedback" id={artifactLifecycleFeedbackId} model={lifecycleAction} />
      <section className={`artifact-release-dossier ${releaseDossier.tone}`} aria-label="Artifact release dossier">
        <div className="artifact-release-copy">
          <span><Clipboard /></span>
          <div><p className="eyebrow">Release dossier</p><h2>{releaseDossier.lifecycleLabel}</h2><p>{releaseDossier.lifecycleDetail}</p></div>
        </div>
        <dl className="artifact-release-signals" aria-label="Release signals">
          {releaseDossier.releaseSignals.map((signal) => (
            <div key={signal.label} role="group" aria-label={`${signal.label}: ${signal.value}. ${signal.detail}`}>
              <dt>{signal.label}</dt>
              <dd>{signal.value}</dd>
              <small>{signal.detail}</small>
            </div>
          ))}
        </dl>
        <ol className="artifact-release-path">
          {releaseDossier.releaseSteps.map((step) => (
            <li key={step.label} className={step.state} aria-label={`${step.label}: ${step.stateLabel}. ${step.detail}`}>
              <span className="artifact-release-step-state">{step.stateLabel}</span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </li>
          ))}
        </ol>
      </section>
      <section className={`artifact-readiness ${readiness.tone}`}>
        <span>{readiness.tone === 'positive' ? <ShieldCheck /> : <ShieldAlert />}</span>
        <div><p className="eyebrow">Publication readiness</p><h2>{readiness.title}</h2><p>{readiness.detail}</p></div>
        <ArtifactCoverageMeter coverage={artifact.data.coverage} />
        <dl>
          <div><dt>Evidence</dt><dd>{artifact.data.coverage.bound_evidence_count}</dd></div>
          <div><dt>Supported</dt><dd>{artifact.data.coverage.supported_block_count}/{artifact.data.coverage.content_block_count}</dd></div>
          <div><dt>User blocks</dt><dd>{artifact.data.coverage.user_block_count}</dd></div>
          <div><dt>Pending refresh</dt><dd>{artifact.data.pending_refresh_count}</dd></div>
        </dl>
      </section>
      <section id="artifact-delivery-dock" className={`artifact-delivery-dock ${releaseDossier.tone}`} aria-label="Artifact delivery dock">
        <header>
          <span><Download /></span>
          <div>
            <p className="eyebrow">Delivery dock · render from canonical revision</p>
            <h2>{releaseDossier.deliveryLabel}</h2>
            <p>{releaseDossier.deliveryDetail}</p>
          </div>
        </header>
        <div
          aria-label={`${deliveryIdentity.label}: ${deliveryIdentity.filenameStem}`}
          className="artifact-delivery-identity"
        >
          <span><ShieldCheck /></span>
          <div>
            <p className="eyebrow">{deliveryIdentity.label}</p>
            <code>{deliveryIdentity.filenameStem}.*</code>
            <p>{deliveryIdentity.detail}</p>
          </div>
          <dl>
            {deliveryIdentity.signals.map((signal) => (
              <div
                aria-label={`${signal.label}: ${signal.value}. ${signal.detail}`}
                key={signal.label}
              >
                <dt>{signal.label}</dt>
                <dd>{signal.value}</dd>
                <small>{signal.detail}</small>
              </div>
            ))}
          </dl>
        </div>
        <div className="artifact-delivery-grid">
          {releaseDossier.deliveryFormats.map((format) => (
            format.available ? <a
                key={format.format}
                aria-label={`${format.label}: ${format.useCase}. ${format.detail}`}
                className={`artifact-delivery-card${format.recommended ? ' recommended' : ''}`}
                href={format.href}
                rel={format.behavior === 'Open' ? 'noreferrer' : undefined}
                target={format.behavior === 'Open' ? '_blank' : undefined}
              >
                <DeliveryFormatContent format={format} />
              </a> : <div
                key={format.format}
                aria-disabled="true"
                aria-label={`${format.label}: unavailable. ${format.unavailableReason ?? format.detail}`}
                className="artifact-delivery-card unavailable"
                role="group"
              >
                <DeliveryFormatContent format={format} />
              </div>
          ))}
        </div>
      </section>
      <SubmitReadinessCard className="artifact-refresh-feedback" id={artifactRefreshFeedbackId} model={refreshDecision} />
      {pendingRefresh && <section className="refresh-proposal"><RefreshCw size={20} /><div><strong>Source change requires review</strong><p>{pendingRefreshRemovedEvidenceCount} prior Evidence bindings are affected. Generated blocks have a proposed diff; user-authored blocks remain unchanged.</p></div><div className="button-group"><button type="button" className="button" aria-describedby={`${artifactRefreshFeedbackId}${refreshDecision.rejectDisabledDetail ? ` ${artifactRefreshRejectGateId}` : ''}`} aria-disabled={refreshDecision.rejectAriaDisabled || undefined} onClick={() => { if (refreshDecision.canReject) resolveRefreshDecision(false) }}><X size={14} />{refreshDecision.rejectLabel}</button><button type="button" className="button primary" aria-describedby={`${artifactRefreshFeedbackId}${refreshDecision.acceptDisabledDetail ? ` ${artifactRefreshAcceptGateId}` : ''}`} aria-disabled={refreshDecision.acceptAriaDisabled || undefined} onClick={() => { if (refreshDecision.canAccept) resolveRefreshDecision(true) }}><Check size={14} />{refreshDecision.acceptLabel}</button>{refreshDecision.rejectDisabledDetail && <span className="sr-only" id={artifactRefreshRejectGateId}>{refreshDecision.rejectDisabledDetail}</span>}{refreshDecision.acceptDisabledDetail && <span className="sr-only" id={artifactRefreshAcceptGateId}>{refreshDecision.acceptDisabledDetail}</span>}</div></section>}
      {draft !== null && draftEditor && <ArtifactJsonEditor
        autosaveNotice={autosaveNotice}
        draft={draft}
        editor={draftEditor}
        error={revise.error}
        pending={revise.isPending}
        onChange={(value) => {
          revise.reset()
          setDraft(value)
        }}
        onClose={requestCloseDraftEditor}
        onDiscardAutosave={() => {
          clearDraftAutosave()
          setDraft(draftEditor.restoredDraft)
        }}
        onDismissAutosave={() => setAutosaveNoticeDismissed(true)}
        onFormat={() => {
          if (draftEditor.formattedDraft) setDraft(draftEditor.formattedDraft)
        }}
        onRestore={() => {
          revise.reset()
          clearDraftAutosave()
          setDraft(draftEditor.restoredDraft)
        }}
        onSave={saveDraft}
      />}
      <div className="artifact-editor-frame">
        <aside><StatusMark status={artifact.data.status} /><dl><div><dt>Revision ID</dt><dd><code>{artifact.data.revision_id}</code></dd></div><div><dt>Originating Run</dt><dd>{artifact.data.run_id ? <Link to={`/runs/${artifact.data.run_id}`}>{artifact.data.run_id.slice(0, 8)} →</Link> : 'Independent'}</dd></div><div><dt>Schema</dt><dd>{String(artifact.data.canonical_document.schema ?? 'unknown')}</dd></div><div><dt>Last updated</dt><dd>{new Date(artifact.data.updated_at).toLocaleString()}</dd></div></dl><p>Publishing changes the lifecycle state, never the immutable revision. Editing always creates a new candidate revision.</p></aside>
        <ArtifactDocument document={artifact.data.canonical_document} runId={artifact.data.run_id} />
      </div>
    </div>
  )
}
