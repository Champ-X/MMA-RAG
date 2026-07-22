import { describe, expect, it } from 'vitest'

describe('research setup query recovery contract', () => {
  it('blocks Run creation when required setup queries fail', () => {
    const files = import.meta.glob<string>(
      ['../features/runs/ResearchNewPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const research = files['../features/runs/ResearchNewPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(research).toContain("label: 'Spaces', required: true")
    expect(research).toContain("label: 'Providers', required: true")
    expect(research).toContain("label: 'Models', required: true")
    expect(research).toContain("queryErrorNotice.tone === 'blocking'")
    expect(research).toContain('void spaces.refetch()')
    expect(research).toContain('void providers.refetch()')
    expect(research).toContain('void models.refetch()')
    expect(research.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(research.indexOf("if (!spaces.data?.items.length)"))
    expect(research.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(research.indexOf('<form className="goal-composer'))
    expect(viewModel).toContain('required?: boolean')
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
