import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RunRouteReceiptViewModel } from './runRouteReceiptViewModel'
import type {
  RunRouteAuditViewModel,
  RunRouteRecoveryViewModel,
} from './runRouteRecoveryViewModel'
import { RunRouteRecoveryPanel } from './RunRouteRecoveryPanel'

const routeReceipt: RunRouteReceiptViewModel = {
  candidates: [],
  detail: 'Product Research led at 82%.',
  label: '1 routed Space',
  method: 'dominant_cluster',
  methodLabel: 'Dominant portrait match',
  overview: {
    actionLabel: 'Open evidence ledger',
    candidateSummary: 'Product Research 82% selected for search',
    decisionReason: 'Dominant portrait match exceeded the routing margin.',
    evidenceReason: 'Matched the strongest Space portrait.',
    matchedTerms: ['routing', 'ledger'],
    scoreBreakdown: 'score contribution: lexical 42% · cluster 34%',
    title: 'Dominant portrait match · 1 routed Space',
  },
  policyLabel: 'Research run · quality retrieval',
  selectedSpaceIds: ['space-1'],
  visible: true,
}

const routeAudit: RunRouteAuditViewModel = {
  detail: 'Product Research leads at 82% · 1 Space now selected.',
  label: 'Current router matches the preserved route',
  role: 'status',
  tone: 'aligned',
  visible: true,
}

const hiddenRecovery: RunRouteRecoveryViewModel = {
  ariaDisabled: true,
  canSubmit: false,
  detail: 'Recovery is not required.',
  feedbackDetail: 'The preserved route is aligned with the current router.',
  feedbackTone: 'ready',
  label: 'Rerun with current router',
  liveMode: 'polite',
  role: 'status',
  visible: false,
}

describe('RunRouteRecoveryPanel', () => {
  it('links the evidence receipt action to the controlled drawer', () => {
    const markup = renderToStaticMarkup(
      <RunRouteRecoveryPanel
        evidenceDrawerId="run-evidence-drawer"
        evidenceOpen={true}
        recoveryBusy={false}
        recoveryConfirmOpen={false}
        routeAudit={routeAudit}
        routeReceipt={routeReceipt}
        routeRecovery={hiddenRecovery}
        onCancelRecovery={() => undefined}
        onConfirmRecovery={() => undefined}
        onOpenEvidence={() => undefined}
        onRequestRecovery={() => undefined}
      />,
    )

    expect(markup).toContain('Automatic routing receipt')
    expect(markup).toContain('aria-controls="run-evidence-drawer"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('Open evidence ledger')
  })

  it('does not render when no route overview is available', () => {
    const markup = renderToStaticMarkup(
      <RunRouteRecoveryPanel
        evidenceDrawerId="run-evidence-drawer"
        evidenceOpen={false}
        recoveryBusy={false}
        recoveryConfirmOpen={false}
        routeAudit={routeAudit}
        routeReceipt={{ ...routeReceipt, overview: undefined }}
        routeRecovery={hiddenRecovery}
        onCancelRecovery={() => undefined}
        onConfirmRecovery={() => undefined}
        onOpenEvidence={() => undefined}
        onRequestRecovery={() => undefined}
      />,
    )

    expect(markup).toBe('')
  })
})
