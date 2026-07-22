import { describe, expect, it } from 'vitest'

describe('evidence detail query recovery contract', () => {
  it('does not describe failed Evidence lookups as tombstoned revisions', () => {
    const files = import.meta.glob<string>(
      ['../features/evidence/EvidenceDetailPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const detailPage = files['../features/evidence/EvidenceDetailPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(detailPage).toContain("label: 'Evidence', required: true")
    expect(detailPage).toContain("label: 'Context'")
    expect(detailPage).not.toContain("label: 'Context', required: true")
    expect(detailPage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryEvidenceDetail} />')
    expect(detailPage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(detailPage).toContain('void evidence.refetch()')
    expect(detailPage).toContain('void context.refetch()')
    expect(detailPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(detailPage.indexOf('This revision may have been tombstoned or purged.'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
