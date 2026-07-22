import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('ledger select CSS loading boundary', () => {
  it('keeps LedgerSelect styles with the shared selector component instead of the entry stylesheet', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/LedgerSelect.tsx',
        '../components/nexus/LedgerSelectViewModel.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/LedgerSelect.tsx']
    const viewModel = files['../components/nexus/LedgerSelectViewModel.ts']
    const componentCss = readFileSync(new URL('../components/nexus/LedgerSelect.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './LedgerSelect.css'")
    expect(component).toContain('aria-selected={gate.ariaSelected}')
    expect(component).toContain("className={`${gate.ariaSelected ? 'selected' : ''}")
    expect(component).toContain('{gate.ariaSelected && <Check />}')
    expect(viewModel).toContain('ariaSelected: false')
    expect(componentCss).toContain('.ledger-select')
    expect(componentCss).toContain('.ledger-select-trigger')
    expect(componentCss).toContain('.ledger-select-menu')
    expect(componentCss).toContain('button[aria-disabled="true"]')
    expect(componentCss).toContain('html[data-theme="dark"] .ledger-select-trigger')
    expect(componentCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.ledger-select')
    expect(entryCss).not.toContain('.ledger-select-trigger')
    expect(entryCss).not.toContain('.ledger-select-menu')
  })
})
