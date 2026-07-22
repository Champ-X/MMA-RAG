import { describe, expect, it } from 'vitest'

describe('citation preview lazy loading boundary', () => {
  it('keeps citation preview code out of the Run workspace initial chunk', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/CitationPreviewPopover.tsx',
        '../features/runs/EvidenceAnswer.tsx',
        '../features/runs/RunWorkspacePage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const popover = files['../components/nexus/CitationPreviewPopover.tsx']
    const answer = files['../features/runs/EvidenceAnswer.tsx']
    const page = files['../features/runs/RunWorkspacePage.tsx']

    expect(page).toContain("const loadCitationPreviewPopover = () => import('@/components/nexus/CitationPreviewPopover')")
    expect(page).toContain('lazy(() => loadCitationPreviewPopover().then')
    expect(page).toContain('void loadCitationPreviewPopover()')
    expect(page).toContain('onPreviewIntent={preloadCitationPreview}')
    expect(page).toContain('citation-preview-loading')
    expect(page).toContain('Opening citation preview...')
    expect(page).not.toContain("import { CitationPreviewPopover } from '@/components/nexus/CitationPreviewPopover'")
    expect(page).not.toContain('buildCitationPreviewPlacementViewModel')
    expect(answer).toContain('onFocus={onPreviewIntent}')
    expect(answer).toContain('onPointerEnter={onPreviewIntent}')
    expect(popover).toContain('buildCitationPreviewPlacementViewModel')
    expect(popover).toContain('export function CitationPreviewPopover')
  })
})
