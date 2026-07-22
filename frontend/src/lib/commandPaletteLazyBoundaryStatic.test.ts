import { describe, expect, it } from 'vitest'

describe('command palette lazy loading boundary', () => {
  it('keeps CommandPalette out of the AppShell initial module graph', () => {
    const files = import.meta.glob<string>(
      ['../app/AppShell.tsx', '../components/nexus/CommandPalette.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const appShell = files['../app/AppShell.tsx']
    const commandPalette = files['../components/nexus/CommandPalette.tsx']

    expect(appShell).toContain('lazy(() => import(\'@/components/nexus/CommandPalette\')')
    expect(appShell).toContain('{paletteOpen && <Suspense fallback={null}><CommandPalette open')
    expect(appShell).not.toContain("import { CommandPalette } from '@/components/nexus/CommandPalette'")
    expect(appShell).toContain('setPaletteOpen((current) => !current)')
    expect(appShell).toContain('setPaletteOpen(true)')
    expect(commandPalette).toContain('export function CommandPalette')
  })
})
