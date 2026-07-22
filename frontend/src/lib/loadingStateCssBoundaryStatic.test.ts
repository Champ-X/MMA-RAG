import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('LoadingState CSS loading boundary', () => {
  it('keeps loading-state motion and reduced-motion styles with LoadingState', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/LoadingState.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/LoadingState.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/LoadingState.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './LoadingState.css'")
    expect(componentCss).toContain('.loading-state')
    expect(componentCss).toContain('.loading-rule::after')
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.loading-state')
    expect(entryCss).not.toContain('.loading-rule')
  })
})
