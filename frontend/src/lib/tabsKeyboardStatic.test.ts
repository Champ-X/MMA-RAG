import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('tabs keyboard implementation boundary', () => {
  it('centralizes horizontal tabs keyboard semantics without capturing vertical scroll keys', () => {
    const files = import.meta.glob<string>(
      ['../components/**/*.tsx', '../features/**/*.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const helper = readFileSync(new URL('./tabsKeyboard.ts', import.meta.url), 'utf8')
    const violations = Object.entries(files)
      .flatMap(([filePath, source]) => {
        if (!source.includes('role="tablist"') && !source.includes("role='tablist'")) return []
        const handlesTabArrowKey = /event\.key[\s\S]{0,120}Arrow(?:Right|Left|Down|Up)/.test(source)
        if (!handlesTabArrowKey) return []
        if (source.includes('resolveHorizontalTabsDirection')) return []
        return `${filePath.replace('../', '')} handles tab arrow keys without the shared helper`
      })

    expect(helper).toContain('export function resolveHorizontalTabsDirection')
    expect(helper).toContain("key === 'ArrowRight'")
    expect(helper).toContain("key === 'ArrowLeft'")
    expect(helper).not.toContain("key === 'ArrowDown'")
    expect(helper).not.toContain("key === 'ArrowUp'")
    expect(violations).toEqual([])
  })
})
