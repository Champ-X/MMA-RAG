import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('source preview drawer CSS loading boundary', () => {
  it('keeps SourcePreviewDrawer styles with the lazy drawer instead of the entry stylesheet', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/SourcePreviewDrawer.tsx',
        '../features/sources/SourcesPage.tsx',
        '../features/spaces/SpaceOverviewPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const drawer = files['../components/nexus/SourcePreviewDrawer.tsx']
    const sourcesPage = files['../features/sources/SourcesPage.tsx']
    const overviewPage = files['../features/spaces/SpaceOverviewPage.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/SourcePreviewDrawer.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const panelNoteCss = readFileSync(new URL('../components/nexus/PanelNote.css', import.meta.url), 'utf8')

    for (const page of [sourcesPage, overviewPage]) {
      expect(page).toContain("lazy(() => import('@/components/nexus/SourcePreviewDrawer')")
    }
    expect(drawer).toContain("import './SourcePreviewDrawer.css'")
    expect(drawer).toContain("import { PanelNote }")
    expect(drawer).toContain('<PanelNote align="start">')
    expect(panelNoteCss).toContain('.panel-note.align-start')
    expect(componentCss).toContain('.source-preview-backdrop')
    expect(componentCss).toContain('.source-preview-drawer')
    expect(componentCss).toContain('.source-readiness-panel')
    expect(componentCss).toContain('.source-sync-automation')
    expect(componentCss).toContain('.source-note-editor')
    expect(componentCss).toContain('.source-preview-drawer .form-error')
    expect(componentCss).toContain('.source-derived-gallery')
    expect(componentCss).toContain('html[data-theme="dark"] .source-readiness-panel')
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.source-preview-backdrop')
    expect(entryCss).not.toContain('.source-preview-drawer')
    expect(entryCss).not.toContain('.source-readiness-panel')
    expect(entryCss).not.toContain('.source-sync-automation')
    expect(entryCss).not.toContain('.source-note-editor')
    expect(entryCss).not.toContain('.form-error')
    expect(entryCss).not.toContain('.panel-note')
    expect(entryCss).not.toContain('.source-derived-gallery')
    expect(entryCss).toContain('@keyframes drawer-in')
    expect(entryCss).not.toContain('.source-type')
    expect(entryCss).not.toContain('.sync-schedule-chip')
  })
})
