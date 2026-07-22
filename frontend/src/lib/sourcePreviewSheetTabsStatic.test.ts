import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('source preview workbook sheet tabs', () => {
  it('exposes workbook sheets as APG tabs with roving focus', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/SourcePreviewDrawer.tsx', '../components/nexus/SourcePreviewDrawer.css'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const drawer = files['../components/nexus/SourcePreviewDrawer.tsx']
    const css = readFileSync(new URL('../components/nexus/SourcePreviewDrawer.css', import.meta.url), 'utf8')

    expect(drawer).toContain("import { moveTabsValue, resolveHorizontalTabsDirection } from '@/lib/tabsKeyboard'")
    expect(drawer).toContain('const sheetTabRefs = useRef')
    expect(drawer).toContain('const sheetNames = useMemo')
    expect(drawer).toContain('const activeSheetIndex = selectedSheetIndex >= 0 ? selectedSheetIndex : 0')
    expect(drawer).toContain('resolveHorizontalTabsDirection(event.key)')
    expect(drawer).toContain('moveTabsValue(sheetNames, currentSheetName, direction)')
    expect(drawer).toContain('sheetTabRefs.current[nextSheetName]?.focus({ preventScroll: true })')
    expect(drawer).toContain('className="sheet-tabs" role="tablist" aria-label="Workbook sheets"')
    expect(drawer).toContain('role="tab"')
    expect(drawer).toContain('aria-selected={selected}')
    expect(drawer).toContain('aria-controls={sheetPanelId(index)}')
    expect(drawer).toContain('tabIndex={selected ? 0 : -1}')
    expect(drawer).toContain('role={tablePreview.length > 1 ? \'tabpanel\' : undefined}')
    expect(drawer).toContain('aria-labelledby={tablePreview.length > 1 ? sheetTabId(activeSheetIndex) : undefined}')
    expect(drawer).not.toContain('const [selectedSheet, setSelectedSheet] = useState(0)')
    expect(drawer).not.toContain('className={selectedSheet === index ? \'selected\' : \'\'}')
    expect(css).toContain('.sheet-tabs button[aria-selected="true"]')
    expect(css).toContain('.table-preview-panel:focus-visible')
  })
})
