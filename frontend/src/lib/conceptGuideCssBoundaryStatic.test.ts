import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('concept guide CSS loading boundary', () => {
  it('keeps ConceptGuide styles with the lazy component instead of the entry stylesheet', () => {
    const files = import.meta.glob<string>(
      [
        '../app/AppShell.tsx',
        '../components/nexus/ConceptGuide.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const appShell = files['../app/AppShell.tsx']
    const component = files['../components/nexus/ConceptGuide.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/ConceptGuide.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(appShell).toContain('lazy(() => import(\'@/components/nexus/ConceptGuide\')')
    expect(component).toContain("import './ConceptGuide.css'")
    expect(componentCss).toContain('.concept-guide-backdrop')
    expect(componentCss).toContain('.concept-flow')
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(componentCss).toContain('html[data-theme="dark"] .concept-flow')
    expect(entryCss).not.toContain('.concept-guide')
    expect(entryCss).not.toContain('.concept-guide-backdrop')
    expect(entryCss).not.toContain('.concept-flow')
    expect(entryCss).not.toContain('.concept-list')
  })
})
