import { describe, expect, it } from 'vitest'

describe('source preview query recovery contract', () => {
  it('does not present empty evidence or sync history states when preview queries failed', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/SourcePreviewDrawer.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const drawer = files['../components/nexus/SourcePreviewDrawer.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(drawer).toContain("label: 'Published evidence', required: true")
    expect(drawer).toContain("label: 'Visual evidence'")
    expect(drawer).toContain("label: 'Sync history'")
    expect(drawer).not.toContain("label: 'Visual evidence', required: true")
    expect(drawer).not.toContain("label: 'Sync history', required: true")
    expect(drawer).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retrySourcePreviewQueries} />')
    expect(drawer).toContain('<QueryErrorNotice model={syncHistoryNotice} onRetry={retrySourceSyncHistory} />')
    expect(drawer).toContain('void evidence.refetch()')
    expect(drawer).toContain('void figures.refetch()')
    expect(drawer).toContain('void syncHistory.refetch()')
    expect(drawer.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(drawer.indexOf('No published chunks yet'))
    expect(drawer.indexOf("syncHistoryNotice.tone === 'blocking'")).toBeLessThan(drawer.indexOf('No checks recorded yet'))
    expect(drawer).toContain('Published Evidence could not be loaded')
    expect(drawer).toContain('Visual evidence could not be loaded')
    expect(drawer).toContain('Sync history could not be loaded')
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
