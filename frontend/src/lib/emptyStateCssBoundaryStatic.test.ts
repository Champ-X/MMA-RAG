import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('EmptyState CSS loading boundary', () => {
  it('keeps empty-state styles with the shared EmptyState component', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/EmptyState.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/EmptyState.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/EmptyState.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './EmptyState.css'")
    expect(componentCss).toContain('.empty-state')
    expect(componentCss).toContain('.empty-state .empty-glyph')
    expect(entryCss).not.toContain('.empty-state')
  })
})
