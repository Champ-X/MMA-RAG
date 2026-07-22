import { describe, expect, it } from 'vitest'

describe('sources query recovery contract', () => {
  it('does not present upload or empty material states when Source queries failed', () => {
    const files = import.meta.glob<string>(
      ['../features/sources/SourcesPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const sourcesPage = files['../features/sources/SourcesPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(sourcesPage).toContain("label: 'Space', required: true")
    expect(sourcesPage).toContain("label: 'Sources', required: true")
    expect(sourcesPage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retrySourceQueries} />')
    expect(sourcesPage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(sourcesPage).toContain('void space.refetch()')
    expect(sourcesPage).toContain('void sources.refetch()')
    expect(sourcesPage).toContain("actions={queryErrorNotice.tone === 'blocking' ? undefined")
    expect(sourcesPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(sourcesPage.indexOf('Add a Source without losing the original'))
    expect(sourcesPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(sourcesPage.indexOf('className="ingestion-console"'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
