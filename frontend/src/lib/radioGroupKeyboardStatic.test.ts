import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('radio group keyboard implementation boundary', () => {
  it('centralizes APG radio arrow-key semantics in the shared helper', () => {
    const files = import.meta.glob<string>(
      [
        '../components/**/*.tsx',
        '../features/**/*.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const helper = readFileSync(new URL('./radioGroupKeyboard.ts', import.meta.url), 'utf8')
    const violations = Object.entries(files)
      .flatMap(([filePath, source]) => {
        if (!source.includes('role="radiogroup"') && !source.includes("role='radiogroup'")) return []
        const handlesArrowKey = /event\.key\s*={0,2}=+\s*['"]Arrow(?:Right|Down|Left|Up)['"]/.test(source)
          || /event\.key[\s\S]{0,120}Arrow(?:Right|Down|Left|Up)/.test(source)
        if (!handlesArrowKey) return []
        if (source.includes('resolveRadioGroupDirection')) return []
        return `${filePath.replace('../', '')} handles radio arrow keys without the shared helper`
      })

    expect(helper).toContain('export function resolveRadioGroupDirection')
    expect(helper).toContain('export function moveRadioGroupValue')
    expect(helper).toContain("key === 'ArrowRight' || key === 'ArrowDown'")
    expect(helper).toContain("key === 'ArrowLeft' || key === 'ArrowUp'")
    expect(violations).toEqual([])
  })
})
