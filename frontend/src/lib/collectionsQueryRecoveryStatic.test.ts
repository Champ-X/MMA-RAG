import { describe, expect, it } from 'vitest'

describe('collections query recovery contract', () => {
  it('blocks saved-view creation when required collection control-plane queries failed', () => {
    const files = import.meta.glob<string>(
      ['../features/spaces/CollectionsPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const collectionsPage = files['../features/spaces/CollectionsPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(collectionsPage).toContain("label: 'Space', required: true")
    expect(collectionsPage).toContain("label: 'Sources', required: true")
    expect(collectionsPage).toContain("label: 'Collections', required: true")
    expect(collectionsPage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryCollectionsQueries} />')
    expect(collectionsPage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(collectionsPage).toContain('void space.refetch()')
    expect(collectionsPage).toContain('void sources.refetch()')
    expect(collectionsPage).toContain('void collections.refetch()')
    expect(collectionsPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(collectionsPage.indexOf('New collection'))
    expect(collectionsPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(collectionsPage.indexOf('Turn a broad Space into useful shelves'))
    expect(collectionsPage.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(collectionsPage.indexOf('className="collection-create-sheet"'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
