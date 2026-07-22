import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Verified knowledge page CSS loading boundary', () => {
  it('keeps claim ledger and evidence binding styles with the lazy VerifiedKnowledge route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/spaces/VerifiedKnowledgePage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/spaces/VerifiedKnowledgePage.tsx']
    const pageCss = readFileSync(new URL('../features/spaces/VerifiedKnowledgePage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const VerifiedKnowledgePage = lazy(() => import('@/features/spaces/VerifiedKnowledgePage'))")
    expect(page).toContain("import './VerifiedKnowledgePage.css'")
    expect(pageCss).toContain('.knowledge-governance')
    expect(pageCss).toContain('.knowledge-summary')
    expect(pageCss).toContain('.knowledge-toolbar')
    expect(pageCss).toContain('.verified-claim-list')
    expect(pageCss).toContain('.verified-claim-card')
    expect(pageCss).toContain('.claim-risk-ribbon')
    expect(pageCss).toContain('.claim-evidence-strip')
    expect(pageCss).toContain('.knowledge-load-more')
    expect(pageCss).toContain('html[data-theme="dark"] .verified-claim-card')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.knowledge-governance')
    expect(entryCss).not.toContain('.knowledge-summary')
    expect(entryCss).not.toContain('.knowledge-toolbar')
    expect(entryCss).not.toContain('.verified-claim-list')
    expect(entryCss).not.toContain('.verified-claim-card')
    expect(entryCss).not.toContain('.claim-risk-ribbon')
    expect(entryCss).not.toContain('.claim-evidence-strip')
    expect(entryCss).not.toContain('.knowledge-load-more')
    expect(entryCss).not.toContain('.source-type')
    expect(entryCss).not.toContain('.answer-sheet')
    expect(entryCss).not.toContain('.submit-readiness-card')
  })
})
