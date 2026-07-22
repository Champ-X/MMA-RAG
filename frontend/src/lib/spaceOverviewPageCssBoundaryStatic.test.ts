import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Space overview CSS loading boundary', () => {
  it('keeps overview cover, routing portrait, suggestions, and material shelf styles with the lazy route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/spaces/SpaceOverviewPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/spaces/SpaceOverviewPage.tsx']
    const pageCss = readFileSync(new URL('../features/spaces/SpaceOverviewPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const panelNoteCss = readFileSync(new URL('../components/nexus/PanelNote.css', import.meta.url), 'utf8')

    expect(router).toContain("const SpaceOverviewPage = lazy(() => import('@/features/spaces/SpaceOverviewPage'))")
    expect(page).toContain("import './SpaceOverviewPage.css'")
    expect(page).toContain("import { PanelNote")
    expect(page).toContain('<PanelNote>')
    expect(panelNoteCss).toContain('.panel-note')
    expect(pageCss).toContain('.space-cover-masthead')
    expect(pageCss).toContain('.space-overview-page .page-actions .button[aria-disabled="true"]')
    expect(pageCss).toContain('.space-summary-line')
    expect(pageCss).toContain('.space-policy-band')
    expect(pageCss).toContain('.space-action-grid')
    expect(pageCss).toContain('.portrait-graph')
    expect(pageCss).toContain('.portrait-inspector')
    expect(pageCss).toContain('.suggestion-grid')
    expect(pageCss).toContain('.space-materials-panel')
    expect(pageCss).toContain('.material-modality-strip')
    expect(pageCss).toContain('.space-material-grid')
    expect(pageCss).toContain('.space-material-copy')
    expect(pageCss).toContain('html[data-theme="dark"] .space-material-grid > button')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.space-cover-masthead')
    expect(entryCss).not.toContain('.space-summary-line')
    expect(entryCss).not.toContain('.space-policy-band')
    expect(entryCss).not.toContain('.feature-cards')
    expect(entryCss).not.toContain('.space-action-grid')
    expect(entryCss).not.toContain('.portrait-graph')
    expect(entryCss).not.toContain('.portrait-inspector')
    expect(entryCss).not.toContain('.suggestion-grid')
    expect(entryCss).not.toContain('.space-materials-panel')
    expect(entryCss).not.toContain('.material-modality-strip')
    expect(entryCss).not.toContain('.space-material-grid')
    expect(entryCss).not.toContain('.space-material-copy')
    expect(entryCss).not.toContain('.source-type')
    expect(entryCss).not.toContain('.collection-card')
    expect(entryCss).not.toContain('.panel-note')
  })
})
