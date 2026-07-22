import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('citation preview CSS loading boundary', () => {
  it('keeps the preview popover styles with the lazy component while preserving the eager loading pill', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/CitationPreviewPopover.tsx',
        '../features/runs/RunWorkspacePage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/CitationPreviewPopover.tsx']
    const page = files['../features/runs/RunWorkspacePage.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/CitationPreviewPopover.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(page).toContain("const loadCitationPreviewPopover = () => import('@/components/nexus/CitationPreviewPopover')")
    expect(page).toContain('citation-preview-loading')
    expect(component).toContain("import './CitationPreviewPopover.css'")
    expect(componentCss).toContain('.citation-preview-popover')
    expect(componentCss).toContain('.citation-preview-content')
    expect(componentCss).toContain('.citation-quality-flags')
    expect(componentCss).toContain('html[data-theme="dark"] .citation-preview-popover')
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).toContain('.citation-preview-loading')
    expect(entryCss).not.toContain('.citation-preview-popover')
    expect(entryCss).not.toContain('.citation-preview-content')
    expect(entryCss).not.toContain('.citation-quality-flags')
    expect(entryCss).not.toContain('citation-pop')
  })
})
