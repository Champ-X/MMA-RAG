import { describe, expect, it } from 'vitest'

function findButtonsWithoutType(filePath: string, source: string) {
  const missing: string[] = []
  const buttonTag = /<button\b[\s\S]*?>/g
  let match: RegExpExecArray | null
  while ((match = buttonTag.exec(source))) {
    if (/\btype\s*=/.test(match[0])) continue
    const line = source.slice(0, match.index).split('\n').length
    missing.push(`${filePath.replace('../', '')}:${line}`)
  }
  return missing
}

describe('button type semantics', () => {
  it('requires every TSX button in UI surfaces to declare an explicit type', () => {
    const files = import.meta.glob<string>(['../app/**/*.tsx', '../components/**/*.tsx', '../features/**/*.tsx'], {
      eager: true,
      import: 'default',
      query: '?raw',
    })
    const missing = Object.entries(files).flatMap(([filePath, source]) =>
      findButtonsWithoutType(filePath, source),
    )

    expect(missing).toEqual([])
  })
})
