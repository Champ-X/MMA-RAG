import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { describe, expect, it } from 'vitest'
import type { Evidence, Run } from '@/api/nexus'
import type { RunRouteReceiptViewModel } from './runRouteReceiptViewModel'
import { RunEvidenceDrawer } from './RunEvidenceDrawer'
import { runEvidenceDrawerId } from './runEvidenceDrawerContract'

const evidence = (id: string): Evidence => ({
  asset_url: `/api/v1/assets/${id}`,
  created_at: '2026-07-21T00:00:00Z',
  evidence_type: 'text_chunk',
  id,
  locator: { locator_type: 'page', page_no: 3, start_ms: null, end_ms: null, bbox: null, sheet: null, cell_range: null, extra: {} },
  modality: 'text',
  quality_flags: [],
  searchable_text: 'Evidence drawer contract.',
  source_id: 'source-1',
  source_name: 'Routing Brief',
  source_version_id: 'version-1',
  status: 'published',
  text_content: 'Evidence drawer contract.',
  visible_from_sequence: 1,
  visible_until_sequence: null,
})

const scope: Pick<Run, 'scope'>['scope'] = {
  global_search: false,
  publish_watermark: 42,
  source_ids: ['source-1', 'source-2'],
  space_ids: ['space-1'],
}

const routeReceipt: RunRouteReceiptViewModel = {
  candidates: [
    {
      matchedTerms: ['routing', 'ledger'],
      name: 'Product Research',
      scopeLabel: 'Selected for search',
      scoreLabel: '82%',
    },
  ],
  decisionReason: 'Dominant portrait match exceeded the routing margin.',
  detail: 'Product Research led at 82%.',
  evidence: {
    matchedTerms: ['routing', 'ledger'],
    reason: 'Matched the strongest Space portrait.',
    scoreBreakdown: 'score contribution: lexical 42% · cluster 34%',
  },
  label: '1 routed Space',
  method: 'dominant_cluster',
  methodLabel: 'Dominant portrait match',
  policyLabel: 'Research run · quality retrieval',
  selectedSpaceIds: ['space-1'],
  visible: true,
}

function renderDrawer(props: Parameters<typeof RunEvidenceDrawer>[0]) {
  return renderToStaticMarkup(
    <StaticRouter location="/runs/run-1">
      <RunEvidenceDrawer {...props} />
    </StaticRouter>,
  )
}

describe('RunEvidenceDrawer', () => {
  it('renders evidence, routing receipt and scope context inside an accessible dialog', () => {
    const markup = renderDrawer({
      closeButtonRef: createRef<HTMLButtonElement>(),
      currentEvidence: [evidence('019f8400-f17f-7b62-bb89-54f4df9b3d42')],
      onClose: () => undefined,
      routeReceipt,
      runId: 'run-1',
      scope,
      scopeSummary: {
        modelDetail: 'Uses the active answer model route, with local evidence fallback if generation is unavailable',
        modelLabel: 'Active answer route',
      },
    })

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain(`id="${runEvidenceDrawerId}"`)
    expect(markup).toContain('aria-labelledby="run-evidence-drawer-title"')
    expect(markup).toContain('aria-describedby="run-evidence-drawer-description"')
    expect(markup).toContain('href="/runs/run-1/evidence/019f8400-f17f-7b62-bb89-54f4df9b3d42"')
    expect(markup).toContain('Routing Brief')
    expect(markup).toContain('Dominant portrait match')
    expect(markup).toContain('Dominant portrait match exceeded the routing margin.')
    expect(markup).toContain('Product Research')
    expect(markup).toContain('1 routed Spaces')
    expect(markup).toContain('2 Sources · watermark 42')
    expect(markup).toContain('Active answer route')
    expect(markup).toContain('aria-label="Close current evidence"')
  })

  it('renders an explicit empty ledger state without losing scope context', () => {
    const markup = renderDrawer({
      closeButtonRef: createRef<HTMLButtonElement>(),
      currentEvidence: [],
      onClose: () => undefined,
      routeReceipt: { ...routeReceipt, visible: false },
      runId: 'run-1',
      scope: { ...scope, publish_watermark: null, source_ids: [], space_ids: [] },
      scopeSummary: {
        modelDetail: 'Explicit verified answer deployment',
        modelLabel: 'Selected answer model',
      },
    })

    expect(markup).toContain('Ledger is waiting')
    expect(markup).toContain('0 routed Spaces')
    expect(markup).toContain('0 Sources · watermark current')
    expect(markup).toContain('Selected answer model')
    expect(markup).not.toContain('route-receipt-card')
  })
})
