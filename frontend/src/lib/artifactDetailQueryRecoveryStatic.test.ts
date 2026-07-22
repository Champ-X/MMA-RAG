import { describe, expect, it } from 'vitest'

describe('artifact detail query recovery contract', () => {
  it('does not describe failed artifact lookups as missing revisions', () => {
    const files = import.meta.glob<string>(
      ['../features/artifacts/ArtifactPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/artifacts/ArtifactPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(page).toContain("label: 'Artifact', required: true")
    expect(page).toContain("label: 'Refresh proposals'")
    expect(page).not.toContain("label: 'Refresh proposals', required: true")
    expect(page).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactQueries} />')
    expect(page).toContain("queryErrorNotice.tone === 'blocking'")
    expect(page).toContain('void artifact.refetch()')
    expect(page).toContain('void proposals.refetch()')
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('Artifact unavailable'))
    expect(page).toContain('Artifact lookup failed')
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
