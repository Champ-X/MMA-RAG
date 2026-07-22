import { describe, expect, it } from 'vitest'

describe('home query recovery contract', () => {
  it('surfaces control-plane query failures before rendering empty dashboard data', () => {
    const files = import.meta.glob<string>(
      ['../features/home/HomePage.tsx', '../components/nexus/QueryErrorNotice.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const home = files['../features/home/HomePage.tsx']
    const notice = files['../components/nexus/QueryErrorNotice.tsx']

    expect(home).toContain('buildQueryErrorNoticeViewModel')
    expect(home).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryHomeQueries} />')
    expect(home).toContain("queryErrorNotice.tone === 'blocking'")
    expect(home).toContain('void spaces.refetch()')
    expect(home).toContain('void runs.refetch()')
    expect(home).toContain('void health.refetch()')
    expect(notice).toContain('role={model.role}')
    expect(notice).toContain('aria-live={model.role === \'alert\' ? \'assertive\' : \'polite\'}')
  })
})
