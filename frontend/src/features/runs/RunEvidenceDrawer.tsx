import type { RefObject } from 'react'
import { BrainCircuit, LocateFixed, ShieldCheck, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Evidence, Run } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { EvidenceCard } from '@/components/nexus/EvidenceCard'
import { runEvidenceDrawerId } from './runEvidenceDrawerContract'
import type { RunRouteReceiptViewModel } from './runRouteReceiptViewModel'
import type { RunScopeSummaryViewModel } from './runScopeSummaryViewModel'
import './RunEvidenceDrawer.css'

type RunEvidenceDrawerProps = {
  closeButtonRef: RefObject<HTMLButtonElement>
  currentEvidence: Evidence[]
  routeReceipt: RunRouteReceiptViewModel
  runId: string
  scope: Pick<Run, 'scope'>['scope']
  scopeSummary: RunScopeSummaryViewModel
  onClose: () => void
}

const drawerTitleId = 'run-evidence-drawer-title'
const drawerDescriptionId = 'run-evidence-drawer-description'

export function RunEvidenceDrawer({
  closeButtonRef,
  currentEvidence,
  routeReceipt,
  runId,
  scope,
  scopeSummary,
  onClose,
}: RunEvidenceDrawerProps) {
  return (
    <aside
      id={runEvidenceDrawerId}
      className="run-evidence-column"
      role="dialog"
      aria-modal="false"
      aria-labelledby={drawerTitleId}
      aria-describedby={drawerDescriptionId}
    >
      <div className="column-head evidence-column-head">
        <span id={drawerTitleId}>Current evidence</span>
        <strong>{currentEvidence.length}</strong>
        <button ref={closeButtonRef} type="button" className="icon-button" aria-label="Close current evidence" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <p className="sr-only" id={drawerDescriptionId}>
        Evidence retrieved for this Run, plus the routing receipt and execution scope used to produce the answer.
      </p>

      {currentEvidence.length ? (
        <div className="ledger-list">
          {currentEvidence.map((item) => (
            <Link key={item.id} to={`/runs/${runId}/evidence/${item.id}`}>
              <EvidenceCard evidence={item} compact />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="Ledger is waiting" body="Retrieved Evidence appears here and remains bound to this turn's snapshot." />
      )}

      {routeReceipt.visible && (
        <section className="route-receipt-card">
          <header>
            <BrainCircuit size={15} />
            <span>
              <strong>{routeReceipt.label}</strong>
              <small>{routeReceipt.detail}</small>
            </span>
          </header>
          <dl>
            <div>
              <dt>Method</dt>
              <dd>{routeReceipt.methodLabel}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{routeReceipt.policyLabel}</dd>
            </div>
          </dl>
          {routeReceipt.decisionReason && (
            <div className="route-receipt-decision">
              <strong>Selection decision</strong>
              <small>{routeReceipt.decisionReason}</small>
            </div>
          )}
          {routeReceipt.evidence && (
            <div className="route-receipt-evidence">
              <span>
                <strong>Signal breakdown</strong>
                <small>{routeReceipt.evidence.scoreBreakdown}</small>
              </span>
              {routeReceipt.evidence.matchedTerms.length > 0 && (
                <ul aria-label="Matched route terms">
                  {routeReceipt.evidence.matchedTerms.map((term) => <li key={term}>{term}</li>)}
                </ul>
              )}
            </div>
          )}
          {routeReceipt.candidates.length > 0 && (
            <ol aria-label="Route candidates">
              {routeReceipt.candidates.map((candidate) => (
                <li key={candidate.name}>
                  <span>{candidate.scoreLabel}</span>
                  <div>
                    <strong>{candidate.name}</strong>
                    {candidate.scopeLabel && <small>{candidate.scopeLabel}</small>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <div className="scope-capsule">
        <LocateFixed size={15} />
        <span>
          <strong>{scope.space_ids?.length ?? 0} routed Spaces</strong>
          <small>{scope.source_ids?.length ?? 0} Sources · watermark {scope.publish_watermark ?? 'current'}</small>
        </span>
      </div>
      <div className="scope-capsule">
        <ShieldCheck size={15} />
        <span>
          <strong>{scopeSummary.modelLabel}</strong>
          <small>{scopeSummary.modelDetail}</small>
        </span>
      </div>
    </aside>
  )
}
