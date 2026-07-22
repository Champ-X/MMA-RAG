import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('catalog model picker CSS loading boundary', () => {
  it('keeps CatalogModelPicker body styles with the shared picker while leaving page sizing overrides to lazy pages', () => {
    const files = import.meta.glob<string>(
      [
        '../features/models/CatalogModelPicker.tsx',
        '../features/models/CatalogModelPickerViewModel.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../features/models/CatalogModelPicker.tsx']
    const viewModel = files['../features/models/CatalogModelPickerViewModel.ts']
    const componentCss = readFileSync(new URL('../features/models/CatalogModelPicker.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './CatalogModelPicker.css'")
    expect(component).toContain('role="combobox"')
    expect(component).toContain('aria-haspopup="listbox"')
    expect(component).toContain('aria-selected={gate.ariaSelected}')
    expect(component).toContain('aria-selected={fallbackGate.ariaSelected}')
    expect(component).toContain("className={`${gate.ariaSelected ? 'selected' : ''}")
    expect(component).toContain("className={`${fallbackGate.ariaSelected ? 'selected' : ''}")
    expect(component).toContain('gate.ariaSelected ? <Check />')
    expect(component).toContain('{fallbackGate.ariaSelected && <Check />}')
    expect(viewModel).toContain('ariaSelected: false')
    expect(componentCss).toContain('.catalog-model-picker')
    expect(componentCss).toContain('.model-picker-trigger')
    expect(componentCss).toContain('.model-picker-popover')
    expect(componentCss).toContain('.model-picker-list')
    expect(componentCss).toContain('.model-fallback-mark')
    expect(componentCss).toContain('html[data-theme="dark"] .model-picker-trigger')
    expect(componentCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.research-composer-shell .model-picker-trigger')
    expect(entryCss).not.toContain('.follow-up-composer .model-picker-trigger')
    expect(entryCss).not.toContain('.route-composer .catalog-model-picker')
    expect(entryCss).not.toMatch(/^\.catalog-model-picker\b/m)
    expect(entryCss).not.toMatch(/^\.model-picker-/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.model-picker-/m)
    expect(entryCss).not.toMatch(/^\s+\.model-picker-popover\b/m)
    expect(entryCss).not.toContain('.model-fallback-mark')
  })
})
