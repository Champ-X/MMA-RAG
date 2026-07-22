import { describe, expect, it } from 'vitest'

describe('spaces query recovery contract', () => {
  it('does not present an empty Spaces workspace when the list query failed', () => {
    const files = import.meta.glob<string>(
      ['../features/spaces/SpacesPage.tsx', '../components/nexus/QueryErrorNotice.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const spacesPage = files['../features/spaces/SpacesPage.tsx']
    const notice = files['../components/nexus/QueryErrorNotice.tsx']

    expect(spacesPage).toContain('buildQueryErrorNoticeViewModel')
    expect(spacesPage).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retrySpaces} />')
    expect(spacesPage).toContain("queryErrorNotice.tone === 'blocking'")
    expect(spacesPage).toContain('void spaces.refetch()')
    expect(spacesPage.indexOf('<QueryErrorNotice')).toBeLessThan(spacesPage.indexOf('Create a bounded knowledge scope'))
    expect(notice).toContain('role={model.role}')
  })
})
