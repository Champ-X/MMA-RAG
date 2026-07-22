import { describe, expect, it } from 'vitest'

describe('evidence query recovery contract', () => {
  it('surfaces Evidence query failures before rendering empty-result states', () => {
    const files = import.meta.glob<string>(
      ['../features/evidence/EvidenceBrowserPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const evidencePage = files['../features/evidence/EvidenceBrowserPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(evidencePage).toContain("label: 'Evidence', required: true")
    expect(evidencePage).toContain("label: 'Overview'")
    expect(evidencePage).not.toContain("label: 'Overview', required: true")
    expect(evidencePage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryEvidence} />')
    expect(evidencePage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(evidencePage).toContain('void evidence.refetch()')
    expect(evidencePage).toContain('void overview.refetch()')
    expect(evidencePage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(evidencePage.indexOf('No published Evidence matches'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
