import { describe, expect, it } from 'vitest'

describe('concept guide lazy loading boundary', () => {
  it('keeps ConceptGuide out of the AppShell initial module graph', () => {
    const files = import.meta.glob<string>(
      ['../app/AppShell.tsx', '../components/nexus/ConceptGuide.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const appShell = files['../app/AppShell.tsx']
    const conceptGuide = files['../components/nexus/ConceptGuide.tsx']

    expect(appShell).toContain('lazy(() => import(\'@/components/nexus/ConceptGuide\')')
    expect(appShell).toContain('{conceptGuideOpen && <Suspense fallback={null}><ConceptGuide open')
    expect(appShell).not.toContain("import { ConceptGuide } from '@/components/nexus/ConceptGuide'")
    expect(appShell).toContain('setConceptGuideOpen(true)')
    expect(conceptGuide).toContain('export function ConceptGuide')
  })
})
