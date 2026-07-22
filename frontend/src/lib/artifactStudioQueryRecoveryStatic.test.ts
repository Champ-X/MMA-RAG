import { describe, expect, it } from 'vitest'

describe('artifact studio query recovery contract', () => {
  it('does not present empty artifact or template creation states when the artifact ledger failed', () => {
    const files = import.meta.glob<string>(
      ['../features/artifacts/StudioPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const studio = files['../features/artifacts/StudioPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(studio).toContain("label: 'Artifacts', required: true")
    expect(studio).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactStudio} />')
    expect(studio).toContain("queryErrorNotice.tone === 'blocking'")
    expect(studio).toContain('void artifacts.refetch()')
    expect(studio.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(studio.indexOf('Create from template'))
    expect(studio.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(studio.indexOf('No durable artifacts yet'))
    expect(studio.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(studio.indexOf('<ArtifactTemplateComposer'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
