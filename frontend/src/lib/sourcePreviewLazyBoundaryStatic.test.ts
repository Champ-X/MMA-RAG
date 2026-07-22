import { describe, expect, it } from 'vitest'

describe('source preview drawer lazy loading boundary', () => {
  it('keeps the heavy material preview drawer out of material-list page chunks', () => {
    const files = import.meta.glob<string>(
      [
        '../features/sources/SourcesPage.tsx',
        '../features/spaces/SpaceOverviewPage.tsx',
        '../components/nexus/SourcePreviewDrawer.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const sourcesPage = files['../features/sources/SourcesPage.tsx']
    const overviewPage = files['../features/spaces/SpaceOverviewPage.tsx']
    const drawer = files['../components/nexus/SourcePreviewDrawer.tsx']

    for (const source of [sourcesPage, overviewPage]) {
      expect(source).toContain("lazy(() => import('@/components/nexus/SourcePreviewDrawer')")
      expect(source).toContain('Opening material preview')
      expect(source).toContain('<Suspense fallback={<LoadingState label="Opening material preview" />}>')
      expect(source).not.toContain("import { SourcePreviewDrawer } from '@/components/nexus/SourcePreviewDrawer'")
    }
    expect(drawer).toContain('export function SourcePreviewDrawer')
  })
})
