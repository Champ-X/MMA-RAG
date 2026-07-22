import { describe, expect, it } from 'vitest'

describe('model gateway query recovery contract', () => {
  it('blocks model gateway operations when required setup queries fail', () => {
    const files = import.meta.glob<string>(
      ['../features/models/ModelsPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const modelsPage = files['../features/models/ModelsPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(modelsPage).toContain("label: 'Providers', required: true")
    expect(modelsPage).toContain("label: 'Models', required: true")
    expect(modelsPage).toContain("label: 'Routes', required: true")
    expect(modelsPage).toContain("label: 'Setup', required: true")
    expect(modelsPage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryModelGateway} />')
    expect(modelsPage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(modelsPage).toContain('void providers.refetch()')
    expect(modelsPage).toContain('void models.refetch()')
    expect(modelsPage).toContain('void routes.refetch()')
    expect(modelsPage).toContain('void setup.refetch()')
    expect(modelsPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(modelsPage.indexOf('<section className="model-gateway-summary"'))
    expect(modelsPage).toContain('if (providers.isLoading || models.isLoading || routes.isLoading || setup.isLoading) return')
    expect(modelsPage).toContain("if (queryErrorNotice.tone === 'blocking') return")
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
