import { useId } from 'react'
import { BrainCircuit } from 'lucide-react'
import { ConfirmDialog } from '@/components/nexus/ConfirmDialog'
import type { RunRouteReceiptViewModel } from './runRouteReceiptViewModel'
import type {
  RunRouteAuditViewModel,
  RunRouteRecoveryViewModel,
} from './runRouteRecoveryViewModel'
import './RunRouteRecoveryPanel.css'

type RunRouteRecoveryPanelProps = {
  evidenceOpen: boolean
  evidenceDrawerId: string
  recoveryBusy: boolean
  recoveryConfirmOpen: boolean
  routeAudit: RunRouteAuditViewModel
  routeReceipt: RunRouteReceiptViewModel
  routeRecovery: RunRouteRecoveryViewModel
  onCancelRecovery: () => void
  onConfirmRecovery: () => void
  onOpenEvidence: () => void
  onRequestRecovery: () => void
}

export function RunRouteRecoveryPanel({
  evidenceOpen,
  evidenceDrawerId,
  recoveryBusy,
  recoveryConfirmOpen,
  routeAudit,
  routeReceipt,
  routeRecovery,
  onCancelRecovery,
  onConfirmRecovery,
  onOpenEvidence,
  onRequestRecovery,
}: RunRouteRecoveryPanelProps) {
  const titleId = useId()
  const feedbackId = useId()
  if (!routeReceipt.overview) return null

  return <>
    <section className="route-overview-card" aria-labelledby={titleId}>
      <header>
        <span><BrainCircuit size={18} /></span>
        <div>
          <p className="eyebrow">Automatic routing receipt</p>
          <h2 id={titleId}>{routeReceipt.overview.title}</h2>
          <small>{routeReceipt.overview.candidateSummary || routeReceipt.detail}</small>
        </div>
        <button type="button" className="text-button" aria-controls={evidenceDrawerId} aria-expanded={evidenceOpen} onClick={onOpenEvidence}>
          {routeReceipt.overview.actionLabel}
        </button>
      </header>
      {routeReceipt.overview.decisionReason && <p>{routeReceipt.overview.decisionReason}</p>}
      <div className="route-overview-signals">
        {routeReceipt.overview.evidenceReason && <span><strong>Evidence signal</strong><small>{routeReceipt.overview.evidenceReason}</small></span>}
        {routeReceipt.overview.scoreBreakdown && <span><strong>Weighted contribution</strong><small>{routeReceipt.overview.scoreBreakdown}</small></span>}
      </div>
      {routeReceipt.overview.matchedTerms.length > 0 && <ul aria-label="Matched route terms">{routeReceipt.overview.matchedTerms.map((term) => <li key={term}>{term}</li>)}</ul>}
      {routeAudit.visible && <div className={`route-current-audit tone-${routeAudit.tone}`} role={routeAudit.role} aria-live={routeAudit.role === 'alert' ? 'assertive' : 'polite'}>
        <span><strong>{routeAudit.label}</strong><small>{routeAudit.detail}</small></span>
        {routeAudit.methodLabel && <em>{routeAudit.methodLabel}</em>}
        {routeAudit.changeSummary && <small>{routeAudit.changeSummary}</small>}
        {routeAudit.decisionReason && <p>{routeAudit.decisionReason}</p>}
        {routeAudit.candidateSummary && <small>{routeAudit.candidateSummary}</small>}
        {routeAudit.evidence && <small>{routeAudit.evidence.reason} {routeAudit.evidence.scoreBreakdown}</small>}
        {routeRecovery.visible && <button type="button" className="button route-recovery-action" aria-describedby={feedbackId} aria-disabled={routeRecovery.ariaDisabled || undefined} onClick={() => { if (routeRecovery.canSubmit) onRequestRecovery() }}>{routeRecovery.label}</button>}
        {routeRecovery.visible && <small id={feedbackId} role={routeRecovery.role} aria-live={routeRecovery.liveMode}>{routeRecovery.feedbackDetail}</small>}
      </div>}
    </section>
    {routeRecovery.confirmation && <ConfirmDialog
      body={routeRecovery.confirmation.body}
      busy={recoveryBusy}
      confirmLabel={routeRecovery.confirmation.confirmLabel}
      open={recoveryConfirmOpen}
      title={routeRecovery.confirmation.title}
      tone="neutral"
      onCancel={onCancelRecovery}
      onConfirm={onConfirmRecovery}
    />}
  </>
}
