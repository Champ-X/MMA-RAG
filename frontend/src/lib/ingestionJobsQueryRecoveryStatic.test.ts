import { describe, expect, it } from 'vitest'

describe('ingestion jobs query recovery contract', () => {
  it('blocks empty timeline states when the durable ingestion ledger failed to load', () => {
    const files = import.meta.glob<string>(
      ['../features/sources/IngestionJobsPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/sources/IngestionJobsPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(page).toContain("label: 'Space', required: true")
    expect(page).toContain("label: 'Jobs ledger', required: true")
    expect(page).toContain("label: 'Selected job'")
    expect(page).not.toContain("label: 'Selected job', required: true")
    expect(page).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryIngestionTimelineQueries} />')
    expect(page).toContain("queryErrorNotice.tone === 'blocking'")
    expect(page).toContain('void space.refetch()')
    expect(page).toContain('void jobs.refetch()')
    expect(page).toContain('void selected.refetch()')
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('job-status-ribbon'))
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('job-empty-state'))
    expect(page.indexOf('selected.isError ?')).toBeLessThan(page.indexOf('Select a job'))
    expect(page).toContain('Job details could not be loaded')
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
