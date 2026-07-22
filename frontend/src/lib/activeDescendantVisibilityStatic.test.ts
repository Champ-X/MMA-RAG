import { describe, expect, it } from 'vitest'

describe('active descendant visibility contract', () => {
  it('keeps every aria-activedescendant option scrolled into view during keyboard navigation', () => {
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
    const violations = Object.entries(files).flatMap(([filePath, source]) => {
      if (!source.includes('aria-activedescendant')) return []
      if (source.includes('scrollIntoView({ block: \'nearest\' })')) return []
      const line = source.slice(0, source.indexOf('aria-activedescendant')).split('\n').length
      return `${filePath.replace('../', '')}:${line} uses aria-activedescendant without keeping the active option visible`
    })

    expect(violations).toEqual([])
  })
})
