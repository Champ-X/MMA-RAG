import { describe, expect, it } from 'vitest'

describe('verified knowledge query recovery contract', () => {
  it('does not present empty claim-ledger states when required knowledge queries failed', () => {
    const files = import.meta.glob<string>(
      ['../features/spaces/VerifiedKnowledgePage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/spaces/VerifiedKnowledgePage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(page).toContain("label: 'Space', required: true")
    expect(page).toContain("label: 'Claim ledger', required: true")
    expect(page).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryVerifiedKnowledge} />')
    expect(page).toContain("queryErrorNotice.tone === 'blocking'")
    expect(page).toContain('void space.refetch()')
    expect(page).toContain('void knowledge.refetch()')
    expect(page).not.toContain('Verified knowledge could not be loaded. {knowledge.error.message}')
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('No verified knowledge yet'))
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('No Claims in this view'))
    expect(viewModel).toContain('hasRequiredMissingData')
    expect(viewModel).not.toContain('hasRequiredFailure')
  })
})
