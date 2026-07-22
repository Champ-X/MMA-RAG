import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('run evidence drawer CSS loading boundary', () => {
  it('keeps drawer body styles with the lazy RunEvidenceDrawer while preserving eager shell affordances', () => {
    const files = import.meta.glob<string>(
      [
        '../features/runs/RunWorkspacePage.tsx',
        '../features/runs/RunEvidenceDrawer.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/RunWorkspacePage.tsx']
    const drawer = files['../features/runs/RunEvidenceDrawer.tsx']
    const componentCss = readFileSync(new URL('../features/runs/RunEvidenceDrawer.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(page).toContain("lazy(() => import('./RunEvidenceDrawer')")
    expect(page).toContain('Opening evidence ledger')
    expect(page).toContain('className="evidence-drawer-toggle"')
    expect(page).toContain('className="evidence-drawer-backdrop"')
    expect(drawer).toContain("import './RunEvidenceDrawer.css'")
    expect(componentCss).toContain('.evidence-column-head')
    expect(componentCss).toContain('.run-evidence-column .ledger-list')
    expect(componentCss).toContain('.scope-capsule')
    expect(componentCss).toContain('.route-receipt-card')
    expect(componentCss).toContain('.route-receipt-evidence')
    expect(componentCss).toContain('html[data-theme="dark"] .route-receipt-card')
    expect(componentCss).toContain('html[data-theme="dark"] .conversation-workspace .run-evidence-column')
    expect(entryCss).toContain('.run-evidence-column')
    expect(componentCss).toContain('html[data-theme="dark"] .conversation-workspace .run-evidence-column')
    expect(entryCss).not.toContain('.evidence-drawer-toggle')
    expect(entryCss).not.toContain('.evidence-drawer-backdrop')
    expect(entryCss).not.toContain('conversation-workspace.evidence-open')
    expect(entryCss).not.toContain('.route-receipt-card')
    expect(entryCss).not.toContain('.route-receipt-evidence')
    expect(entryCss).not.toContain('.scope-capsule')
    expect(entryCss).not.toContain('.evidence-column-head')
    expect(entryCss).not.toContain('.ledger-list')
  })
})
