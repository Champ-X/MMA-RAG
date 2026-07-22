import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Evidence CSS loading boundaries', () => {
  it('keeps shared evidence card appearance with the component and page shells with lazy evidence routes', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../components/nexus/EvidenceCard.tsx',
        '../features/evidence/EvidenceBrowserPage.tsx',
        '../features/evidence/EvidenceDetailPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const card = files['../components/nexus/EvidenceCard.tsx']
    const browserPage = files['../features/evidence/EvidenceBrowserPage.tsx']
    const detailPage = files['../features/evidence/EvidenceDetailPage.tsx']
    const cardCss = readFileSync(new URL('../components/nexus/EvidenceCard.css', import.meta.url), 'utf8')
    const browserCss = readFileSync(new URL('../features/evidence/EvidenceBrowserPage.css', import.meta.url), 'utf8')
    const detailCss = readFileSync(new URL('../features/evidence/EvidenceDetailPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const EvidenceBrowserPage = lazy(() => import('@/features/evidence/EvidenceBrowserPage'))")
    expect(router).toContain("const EvidenceDetailPage = lazy(() => import('@/features/evidence/EvidenceDetailPage'))")
    expect(card).toContain("import './EvidenceCard.css'")
    expect(browserPage).toContain("import './EvidenceBrowserPage.css'")
    expect(browserPage).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(browserPage).toContain('className="modality-ledger" role="radiogroup"')
    expect(browserPage).toContain('role="radio"')
    expect(browserPage).toContain('aria-checked={selectedModality === option.id}')
    expect(browserPage).not.toContain('aria-pressed={selectedModality === option.id}')
    expect(detailPage).toContain("import './EvidenceDetailPage.css'")
    expect(cardCss).toContain('.evidence-card')
    expect(cardCss).toContain('.evidence-card-head')
    expect(cardCss).toContain('.evidence-media-preview')
    expect(cardCss).toContain('.evidence-card-text')
    expect(cardCss).toContain('.locator-chip')
    expect(cardCss).toContain('html[data-theme="dark"] .evidence-card-text')
    expect(cardCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(browserCss).toContain('.evidence-control-room')
    expect(browserCss).toContain('.active-filter-strip')
    expect(browserCss).toContain('.modality-ledger')
    expect(browserCss).toContain('.evidence-grid')
    expect(browserCss).toContain('.load-more-row')
    expect(browserCss).toContain('html[data-theme="dark"] .evidence-command-card')
    expect(browserCss).toContain('@media (max-width: 1180px)')
    expect(browserCss).toContain('@media (max-width: 820px)')
    expect(detailCss).toContain('.evidence-dossier-hero')
    expect(detailCss).toContain('.evidence-receipt-link')
    expect(detailCss).toContain('.evidence-detail-grid')
    expect(detailCss).toContain('.evidence-locator-ledger')
    expect(detailCss).toContain('.context-chunks')
    expect(detailCss).toContain('html[data-theme="dark"] .evidence-provenance-card')
    expect(detailCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.evidence-card-head')
    expect(entryCss).not.toContain('.evidence-media-preview')
    expect(entryCss).not.toContain('.evidence-control-room')
    expect(entryCss).not.toContain('.active-filter-strip')
    expect(entryCss).not.toContain('.modality-ledger')
    expect(entryCss).not.toContain('.evidence-grid')
    expect(entryCss).not.toContain('.load-more-row')
    expect(entryCss).not.toContain('.evidence-dossier-hero')
    expect(entryCss).not.toContain('.evidence-receipt-link')
    expect(entryCss).not.toContain('.evidence-detail-grid')
    expect(entryCss).not.toContain('.evidence-locator-ledger')
    expect(entryCss).not.toContain('.context-chunks')
    expect(entryCss).not.toContain('.source-type')
    expect(entryCss).toContain('.run-evidence-column')
  })
})
