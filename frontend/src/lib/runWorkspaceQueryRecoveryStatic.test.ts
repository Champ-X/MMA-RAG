import { describe, expect, it } from 'vitest'

describe('run workspace query recovery contract', () => {
  it('does not describe failed Run workspace reads as missing Runs', () => {
    const files = import.meta.glob<string>(
      ['../features/runs/RunWorkspacePage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/RunWorkspacePage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(page).toContain("label: 'Run', required: true")
    expect(page).toContain("label: 'Snapshot', required: true")
    expect(page).toContain("label: 'Event history', required: true")
    expect(page).toContain("label: 'Conversation'")
    expect(page).toContain("label: 'Evidence revisions'")
    expect(page).not.toContain("label: 'Conversation', required: true")
    expect(page).not.toContain("label: 'Evidence revisions', required: true")
    expect(page).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryRunWorkspaceQueries} />')
    expect(page).toContain("queryErrorNotice.tone === 'blocking'")
    expect(page).toContain('void run.refetch()')
    expect(page).toContain('void snapshot.refetch()')
    expect(page).toContain('void eventHistory.refetch()')
    expect(page).toContain('void providers.refetch()')
    expect(page).toContain('void models.refetch()')
    expect(page).toContain('void query.refetch()')
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('Run not found'))
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('className={`run-workspace conversation-workspace'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
