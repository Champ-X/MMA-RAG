import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Sources page CSS loading boundary', () => {
  it('keeps source intake, connector, and material library styles with the lazy Sources route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/sources/SourcesPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/sources/SourcesPage.tsx']
    const pageCss = readFileSync(new URL('../features/sources/SourcesPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const SourcesPage = lazy(() => import('@/features/sources/SourcesPage'))")
    expect(page).toContain("import './SourcesPage.css'")
    expect(page).toContain("import { SegmentedControl } from '@/components/nexus/SegmentedControl'")
    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('className="source-contracts" role="radiogroup" aria-label="Source connector type"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={connectorKind === kind}')
    expect(page).toContain('tabIndex={connectorKind === kind ? 0 : -1}')
    expect(page).toContain('const materialViewModeOptions = [')
    expect(page).toContain('ariaLabel="Material view mode" className="view-switch"')
    expect(page).not.toContain('aria-label="Grid view"')
    expect(page).not.toContain('aria-label="List view"')
    expect(pageCss).toContain('.source-register')
    expect(pageCss).toContain('.ingestion-console')
    expect(pageCss).toContain('.source-drop-zone')
    expect(pageCss).toContain('.source-contracts')
    expect(pageCss).toContain('.connector-contract-sheet')
    expect(pageCss).toContain('.connector-fields')
    expect(pageCss).toContain('.manual-note-composer')
    expect(pageCss).toContain('.source-intake-receipt')
    expect(pageCss).toContain('.library-toolbar')
    expect(pageCss).toContain('.source-health-ribbon')
    expect(pageCss).toContain('.view-switch button.active')
    expect(pageCss).not.toContain('.view-switch svg')
    expect(pageCss).toContain('.material-register-grid')
    expect(pageCss).toContain('.material-batch-bar')
    expect(pageCss).toContain('.sync-schedule-chip')
    expect(pageCss).toContain('html[data-theme="dark"] .connector-fields .check-field')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (max-width: 520px)')
    expect(entryCss).not.toMatch(/^\.source-register\b/m)
    expect(entryCss).not.toMatch(/^\.ingestion-console\b/m)
    expect(entryCss).not.toMatch(/^\.source-drop-zone\b/m)
    expect(entryCss).not.toMatch(/^\.source-contracts\b/m)
    expect(entryCss).not.toMatch(/^\.source-contract-group\b/m)
    expect(entryCss).not.toMatch(/^\.connector-contract-sheet\b/m)
    expect(entryCss).not.toMatch(/^\.connector-fields\b/m)
    expect(entryCss).not.toMatch(/^\.manual-note-/m)
    expect(entryCss).not.toMatch(/^\.source-intake-receipt\b/m)
    expect(entryCss).not.toMatch(/^\.library-toolbar\b/m)
    expect(entryCss).not.toMatch(/^\.source-health-ribbon\b/m)
    expect(entryCss).not.toMatch(/^\.material-register-grid\b/m)
    expect(entryCss).not.toMatch(/^\.material-batch-bar\b/m)
    expect(entryCss).not.toContain('.sync-schedule-chip')
    expect(entryCss).not.toContain('.source-type')
  })
})
