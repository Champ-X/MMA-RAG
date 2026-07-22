import { describe, expect, it } from 'vitest'

describe('system query recovery contract', () => {
  it('does not present empty diagnostic tabs when required system queries failed', () => {
    const files = import.meta.glob<string>(
      ['../features/system/SystemPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const systemPage = files['../features/system/SystemPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(systemPage).toContain("label: 'Health', required: true")
    expect(systemPage).toContain("label: 'Index health', required: tab === 'status' || tab === 'storage'")
    expect(systemPage).toContain("label: 'Ingestion jobs', required: tab === 'jobs'")
    expect(systemPage).toContain("label: 'Backups', required: tab === 'backups'")
    expect(systemPage).toContain("label: 'Runs', required: tab === 'traces'")
    expect(systemPage).toContain("label: 'Safe config', required: tab === 'settings'")
    expect(systemPage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retrySystemQueries} />')
    expect(systemPage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(systemPage).toContain('void health.refetch()')
    expect(systemPage).toContain('void indexes.refetch()')
    expect(systemPage).toContain('void jobs.refetch()')
    expect(systemPage).toContain('void backups.refetch()')
    expect(systemPage).toContain('void runs.refetch()')
    expect(systemPage).toContain('void config.refetch()')
    expect(systemPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(systemPage.indexOf('No recovery point yet'))
    expect(systemPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(systemPage.indexOf('No ingestion jobs'))
    expect(systemPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(systemPage.indexOf('No Run traces'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
