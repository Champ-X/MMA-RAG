import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Braces, CheckCircle2, Copy, ExternalLink, Fingerprint, LocateFixed, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { EvidenceCard } from '@/components/nexus/EvidenceCard'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { buildEvidenceMediaViewModel } from '@/components/nexus/evidenceMediaViewModel'
import {
  buildEvidenceReceiptCopyActionViewModel,
  type EvidenceReceiptCopyState,
} from '@/components/nexus/evidenceReceiptViewModel'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { copyTextToClipboard } from '@/lib/clipboard'
import { buildEvidenceDetailBackPath, buildEvidenceDetailPath } from '@/lib/evidenceRoutes'
import { buildEvidenceDetailViewModel, buildEvidenceReceiptLinkViewModel } from './evidenceDetailViewModel'
import './EvidenceDetailPage.css'

const evidenceReceiptCopyFeedbackId = 'evidence-receipt-copy-feedback'

export default function EvidenceDetailPage() {
  const { runId, revisionId = '' } = useParams()
  const [receiptLinkState, setReceiptLinkState] = useState<EvidenceReceiptCopyState>('idle')
  const evidence = useQuery({ queryKey: ['evidence', revisionId], queryFn: () => nexusApi.getEvidence(revisionId), enabled: Boolean(revisionId) })
  const context = useQuery({ queryKey: ['evidence-context', revisionId], queryFn: () => nexusApi.expandEvidence(revisionId), enabled: Boolean(revisionId) })
  const receiptLink = useMemo(() => {
    if (!evidence.data) return null
    return buildEvidenceReceiptLinkViewModel({
      evidence: evidence.data,
      origin: typeof window === 'undefined' ? '' : window.location.origin,
      pathname: typeof window === 'undefined' ? '' : window.location.pathname,
    })
  }, [evidence.data])
  useEffect(() => {
    setReceiptLinkState('idle')
  }, [receiptLink?.href])
  useEffect(() => {
    if (receiptLinkState === 'idle') return
    const timer = window.setTimeout(() => setReceiptLinkState('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [receiptLinkState])
  const copyReceiptLink = async () => {
    if (!receiptLink) return
    setReceiptLinkState('copying')
    try {
      await copyTextToClipboard(receiptLink.href)
      setReceiptLinkState('copied')
    } catch {
      setReceiptLinkState('failed')
    }
  }
  if (evidence.isLoading || context.isLoading) return <LoadingState />
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: evidence.error, hasData: Boolean(evidence.data), label: 'Evidence', required: true },
    { error: context.error, hasData: Boolean(context.data), label: 'Context' },
  ])
  const retryEvidenceDetail = () => {
    void evidence.refetch()
    void context.refetch()
  }
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell"><PageHeader eyebrow="Stable Evidence Revision" title="Evidence could not be loaded" description="Nexus could not read this Evidence revision from the authoritative index." actions={<Link className="button" to={buildEvidenceDetailBackPath(runId)}><ArrowLeft size={16} />Back</Link>} /><QueryErrorNotice model={queryErrorNotice} onRetry={retryEvidenceDetail} /><EmptyState title="Evidence lookup failed" body="Retry before treating this revision as tombstoned or purged. Temporary API or index failures should not be interpreted as deletion." /></div>
  if (!evidence.data) return <EmptyState title="Evidence unavailable" body="This revision may have been tombstoned or purged." />
  const viewModel = buildEvidenceDetailViewModel(evidence.data, context.data?.items ?? [])
  const media = buildEvidenceMediaViewModel(evidence.data)
  const receiptCopyAction = receiptLink
    ? buildEvidenceReceiptCopyActionViewModel({
        receipt: receiptLink,
        state: receiptLinkState,
      })
    : null
  const backTarget = buildEvidenceDetailBackPath(runId)
  const previewLabel = viewModel.hasDerivedVisual ? 'Parser-derived materialization' : viewModel.primaryMaterialLabel
  return (
    <div className="page-shell evidence-detail-page">
      <PageHeader
        eyebrow="Stable Evidence Revision"
        title={evidence.data.source_name}
        description={`${viewModel.modalityLabel} · ${viewModel.evidenceTypeLabel} · ${evidence.data.id}`}
        actions={<Link className="button" to={backTarget}><ArrowLeft size={16} />Back</Link>}
      />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryEvidenceDetail} />

      <section className="evidence-dossier-hero" aria-label="Evidence provenance summary">
        <div className="evidence-provenance-card">
          <p className="eyebrow"><ShieldCheck size={13} />Provenance receipt</p>
          <h2>{viewModel.locatorSummary}</h2>
          <p>This Evidence revision keeps the original locator, extracted text and material asset together so downstream claims can be checked without relying on model memory.</p>
          <div className="evidence-custody-grid">
            {viewModel.custodySignals.map((signal) => (
              <span key={signal.label}>
                <strong>{signal.value}</strong>
                <small>{signal.label}</small>
              </span>
            ))}
          </div>
        </div>

        <aside className={`evidence-trust-card tone-${viewModel.trustState.tone}`}>
          <span>{viewModel.trustState.tone === 'clean' ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}</span>
          <div>
            <p className="eyebrow">Inspection signal</p>
            <h3>{viewModel.trustState.label}</h3>
            <p>{viewModel.trustState.detail}</p>
            {viewModel.qualityFlags.length > 0 && (
              <div className="evidence-quality-list">
                {viewModel.qualityFlags.map((flag) => <em key={flag}>{flag}</em>)}
              </div>
            )}
          </div>
        </aside>
      </section>

      {receiptLink && <section className="evidence-receipt-link" aria-label={receiptLink.ariaLabel}>
        <div>
          <p className="eyebrow">{receiptLink.title}</p>
          <strong>{receiptLink.shortLabel}</strong>
          <small>{receiptLink.detail}</small>
        </div>
        <dl>
          {receiptLink.facets.map((facet) => <div key={facet.label}>
            <dt>{facet.label}</dt>
            <dd>{facet.value}</dd>
          </div>)}
        </dl>
        <button className="button" type="button" aria-describedby={evidenceReceiptCopyFeedbackId} onClick={copyReceiptLink}>
          {receiptLinkState === 'copied' ? <CheckCircle2 size={14} /> : receiptLinkState === 'failed' ? <AlertTriangle size={14} /> : <Copy size={14} />}
          {receiptCopyAction?.submitLabel ?? receiptLink.copyLabel}
        </button>
        {receiptCopyAction && <SubmitReadinessCard className="evidence-receipt-copy-feedback" id={evidenceReceiptCopyFeedbackId} model={receiptCopyAction} />}
      </section>}

      <div className="evidence-detail-grid">
        <section className="evidence-material-column">
          <div className="original-preview evidence-material-preview">
            <div className="preview-label"><LocateFixed size={15} />{previewLabel}</div>
            {viewModel.visualEvidence
              ? <img src={evidence.data.asset_url} alt={media.imageAlt} />
              : evidence.data.modality === 'audio'
                ? <audio src={evidence.data.asset_url} controls aria-label={media.audioLabel} />
                : evidence.data.modality === 'video'
                  ? <video src={evidence.data.asset_url} controls aria-label={media.videoLabel} />
                  : <a className="button" href={evidence.data.asset_url} target="_blank" rel="noreferrer"><ExternalLink size={16} />Open original Source</a>}
          </div>
          <EvidenceCard evidence={evidence.data} suppressMedia={viewModel.visualEvidence} textMode={viewModel.visualEvidence ? 'details' : 'excerpt'} />
        </section>

        <aside className="locator-sheet evidence-locator-ledger">
          <header>
            <span><Fingerprint size={17} /></span>
            <div>
              <p className="eyebrow">Source locator</p>
              <h2>{viewModel.locatorSummary}</h2>
            </div>
          </header>
          {evidence.data.modality === 'image' && (
            <p className="locator-definition">Standalone images are cited as one immutable original. Layout-aware document parsers may expose a meaningful embedded figure, but the image pipeline does not manufacture generic sub-image regions.</p>
          )}
          <dl>
            {viewModel.locatorEntries.map((entry) => (
              <div key={entry.key}>
                <dt>{entry.label}</dt>
                <dd><code>{entry.value}</code></dd>
              </div>
            ))}
          </dl>
          <p className="locator-note"><Braces size={14} />Generated captions or summaries never replace this Source Version locator: <code>{evidence.data.source_version_id}</code>.</p>
          <div className="context-chunks">
            <p className="eyebrow">Surrounding chunks</p>
            {viewModel.contextItems.length
              ? viewModel.contextItems.map((item, index) => (
                <Link key={item.id} className={item.active ? 'active' : ''} to={buildEvidenceDetailPath(item.id, runId)}>
                  <span>{index + 1}</span>
                  <span><strong>{item.label}</strong><small>{item.excerpt}</small></span>
                </Link>
              ))
              : <p className="context-empty">No adjacent chunks were returned for this Evidence revision.</p>}
          </div>
        </aside>
      </div>
    </div>
  )
}
