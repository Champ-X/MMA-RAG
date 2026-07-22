import { describe, expect, it } from 'vitest'

describe('source material view switch contract', () => {
  it('uses the shared SegmentedControl for Grid/List material views', () => {
    const files = import.meta.glob<string>(
      ['../features/sources/SourcesPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/sources/SourcesPage.tsx']

    expect(page).toContain("import { SegmentedControl } from '@/components/nexus/SegmentedControl'")
    expect(page).toContain("const materialViewModeOptions = [")
    expect(page).toContain("{ value: 'grid', label: 'Grid'")
    expect(page).toContain("{ value: 'list', label: 'List'")
    expect(page).toContain('<SegmentedControl ariaLabel="Material view mode" className="view-switch" options={materialViewModeOptions} value={viewMode} onChange={setViewMode} />')
    expect(page).not.toContain('aria-label="Grid view"')
    expect(page).not.toContain('aria-label="List view"')
    expect(page).not.toContain("onClick={() => setViewMode('grid')}")
    expect(page).not.toContain("onClick={() => setViewMode('list')}")
  })
})
