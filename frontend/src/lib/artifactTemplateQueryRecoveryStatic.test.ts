import { describe, expect, it } from 'vitest'

describe('artifact template query recovery contract', () => {
  it('blocks template creation when governed template registry queries failed', () => {
    const files = import.meta.glob<string>(
      ['../features/artifacts/ArtifactTemplateComposer.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const composer = files['../features/artifacts/ArtifactTemplateComposer.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(composer).toContain("label: 'Artifact templates', required: true")
    expect(composer).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactTemplates} />')
    expect(composer).toContain("queryErrorNotice.tone === 'blocking'")
    expect(composer).toContain('void templates.refetch()')
    expect(composer).not.toContain("create.error?.message || templates.error?.message")
    expect(composer.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(composer.indexOf('artifact-template-grid'))
    expect(composer.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(composer.indexOf('An evidence-backed source Artifact is required'))
    expect(composer.indexOf("queryErrorNotice.tone !== 'blocking' && (eligible.length")).toBeLessThan(composer.indexOf('Source content remains unchanged.'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
