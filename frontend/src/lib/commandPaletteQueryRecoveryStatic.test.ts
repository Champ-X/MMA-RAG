import { describe, expect, it } from 'vitest'

describe('command palette query recovery contract', () => {
  it('surfaces dynamic search source failures before showing no-result copy', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/CommandPalette.tsx',
        '../components/nexus/CommandPaletteViewModel.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const palette = files['../components/nexus/CommandPalette.tsx']
    const viewModel = files['../components/nexus/CommandPaletteViewModel.ts']

    expect(palette).toContain('buildCommandPaletteSearchStatus')
    expect(palette).toContain("label: 'Spaces'")
    expect(palette).toContain("label: 'Conversations'")
    expect(palette).toContain("label: 'Evidence'")
    expect(palette).toContain('spaces.error')
    expect(palette).toContain('conversations.error')
    expect(palette).toContain('evidence.error')
    expect(palette).toContain('buildCommandPaletteEmptyState')
    expect(palette).toContain('aria-haspopup="listbox"')
    expect(palette).toContain('className="command-search-status"')
    expect(palette).toContain('className="command-empty" role={emptyState.role} aria-live={emptyState.liveMode}')
    expect(palette.indexOf('searchStatus.visible')).toBeLessThan(palette.indexOf('className="command-empty"'))
    expect(viewModel).toContain('Static navigation remains available while you retry.')
    expect(viewModel).toContain('export function buildCommandPaletteEmptyState')
  })
})
