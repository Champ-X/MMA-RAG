import { describe, expect, it } from 'vitest'

describe('tools and agent profile query recovery contract', () => {
  it('does not present missing tool or agent registries when capability queries failed', () => {
    const files = import.meta.glob<string>(
      [
        '../features/tools/ToolsPage.tsx',
        '../features/tools/AgentsPage.tsx',
        '../components/nexus/queryErrorNoticeViewModel.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const toolsPage = files['../features/tools/ToolsPage.tsx']
    const agentsPage = files['../features/tools/AgentsPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(toolsPage).toContain("label: 'Tools', required: true")
    expect(toolsPage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryTools} />')
    expect(toolsPage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(toolsPage).toContain('void tools.refetch()')
    expect(toolsPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(toolsPage.indexOf('No tools registered'))

    expect(agentsPage).toContain("label: 'Agent profiles', required: true")
    expect(agentsPage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryAgentProfiles} />')
    expect(agentsPage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(agentsPage).toContain('void profiles.refetch()')
    expect(agentsPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(agentsPage.indexOf('No Agent profiles'))

    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
