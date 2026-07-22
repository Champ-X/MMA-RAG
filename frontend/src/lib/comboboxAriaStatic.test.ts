import { describe, expect, it } from 'vitest'

describe('combobox aria contract', () => {
  it('declares listbox popups for every combobox input', () => {
    const files = import.meta.glob<string>(
      ['../app/**/*.tsx', '../components/**/*.tsx', '../features/**/*.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const violations = Object.entries(files).flatMap(([filePath, source]) => {
      const matches = source.matchAll(/<input\b[\s\S]*?role="combobox"[\s\S]*?>/g)
      return Array.from(matches).flatMap((match) => {
        if (match[0].includes('aria-haspopup="listbox"')) return []
        const line = source.slice(0, match.index).split('\n').length
        return `${filePath.replace('../', '')}:${line} combobox is missing aria-haspopup="listbox"`
      })
    })

    expect(violations).toEqual([])
  })
})
