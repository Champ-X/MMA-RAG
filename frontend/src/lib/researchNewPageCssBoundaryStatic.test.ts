import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Research new page CSS loading boundary', () => {
  it('keeps research setup and composer styles with the lazy ResearchNew route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/runs/ResearchNewPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/runs/ResearchNewPage.tsx']
    const pageCss = readFileSync(new URL('../features/runs/ResearchNewPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const ResearchNewPage = lazy(() => import('@/features/runs/ResearchNewPage'))")
    expect(page).toContain("import './ResearchNewPage.css'")
    expect(pageCss).toContain('.research-new-page')
    expect(pageCss).toContain('.research-setup-ledger')
    expect(pageCss).toContain('.research-composer-shell')
    expect(pageCss).toContain('.research-composer-shell .model-picker-trigger')
    expect(pageCss).toContain('.research-submit-feedback')
    expect(pageCss).toContain('.research-attachment-trigger')
    expect(pageCss).toContain('.retrieval-depth-choice')
    expect(pageCss).toContain('.execution-choice')
    expect(pageCss).toContain('.scope-mode-tabs')
    expect(pageCss).toContain('.space-choice-grid')
    expect(pageCss).toContain('.space-choice-cover')
    expect(pageCss).toContain('.route-preview')
    expect(pageCss).toContain('.route-preview-evidence')
    expect(pageCss).toContain('.policy-recommendation')
    expect(pageCss).toContain('.collection-scope-choice')
    expect(pageCss).toContain('html[data-theme="dark"] .research-submit-feedback')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (max-width: 520px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.research-new-page')
    expect(entryCss).not.toContain('.research-setup-ledger')
    expect(entryCss).not.toContain('.research-composer-shell')
    expect(entryCss).not.toContain('.research-composer-shell .model-picker-trigger')
    expect(entryCss).not.toContain('.research-submit-feedback')
    expect(entryCss).not.toContain('.research-attachment-trigger')
    expect(entryCss).not.toMatch(/^\.retrieval-depth-choice\b/m)
    expect(entryCss).not.toMatch(/^\.execution-choice\b/m)
    expect(entryCss).not.toContain('.scope-mode-tabs')
    expect(entryCss).not.toContain('.space-choice-grid')
    expect(entryCss).not.toContain('.space-choice-cover')
    expect(entryCss).not.toContain('.route-preview')
    expect(entryCss).not.toContain('.policy-recommendation')
    expect(entryCss).not.toContain('.collection-scope-choice')
    expect(entryCss).not.toContain('.submit-readiness-card')
    expect(entryCss).not.toContain('.policy-option')
  })
})
