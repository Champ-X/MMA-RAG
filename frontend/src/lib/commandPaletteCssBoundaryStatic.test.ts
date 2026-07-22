import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('command palette CSS loading boundary', () => {
  it('keeps CommandPalette styles with the lazy component instead of the entry stylesheet', () => {
    const files = import.meta.glob<string>(
      [
        '../app/AppShell.tsx',
        '../components/nexus/CommandPalette.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const appShell = files['../app/AppShell.tsx']
    const component = files['../components/nexus/CommandPalette.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/CommandPalette.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(appShell).toContain('lazy(() => import(\'@/components/nexus/CommandPalette\')')
    expect(component).toContain("import './CommandPalette.css'")
    expect(componentCss).toContain('.command-backdrop')
    expect(componentCss).toContain('.command-palette')
    expect(componentCss).toContain('.command-search-status')
    expect(componentCss).toContain('html[data-theme="dark"] .command-palette')
    expect(componentCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.command-backdrop')
    expect(entryCss).not.toContain('.command-palette')
    expect(entryCss).not.toContain('.command-results')
    expect(entryCss).not.toContain('.command-search-status')
    expect(entryCss).not.toContain('.command-empty')
    expect(entryCss).not.toContain('.history-search kbd')
  })
})
