import { describe, expect, it } from 'vitest'

describe('space overview query recovery contract', () => {
  it('does not present missing Space, empty Sources, or empty Portrait states when required overview queries failed', () => {
    const files = import.meta.glob<string>(
      ['../features/spaces/SpaceOverviewPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const overview = files['../features/spaces/SpaceOverviewPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(overview).toContain("label: 'Space', required: true")
    expect(overview).toContain("label: 'Sources', required: true")
    expect(overview).toContain("label: 'Portrait'")
    expect(overview).toContain("label: 'Suggested questions'")
    expect(overview).not.toContain("label: 'Portrait', required: true")
    expect(overview).not.toContain("label: 'Suggested questions', required: true")
    expect(overview).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retrySpaceOverviewQueries} />')
    expect(overview).toContain("queryErrorNotice.tone === 'blocking'")
    expect(overview).toContain('void space.refetch()')
    expect(overview).toContain('void sources.refetch()')
    expect(overview).toContain('void portrait.refetch()')
    expect(overview).toContain('void suggestions.refetch()')
    expect(overview).toContain('if (space.isLoading || sources.isLoading) return <LoadingState />')
    expect(overview).not.toContain('space.isLoading || sources.isLoading || portrait.isLoading')
    expect(overview.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(overview.indexOf('Space not found'))
    expect(overview.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(overview.indexOf('No Sources in this Space'))
    expect(overview.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(overview.indexOf('Portrait needs published Evidence'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
