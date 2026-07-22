import { describe, expect, it } from 'vitest'

const nativeDisableableTags = ['button', 'fieldset', 'input', 'select', 'textarea'] as const

function lineOf(source: string, index: number) {
  return source.slice(0, index).split('\n').length
}

function findNativeDisabledProps(filePath: string, source: string) {
  const violations: string[] = []
  const tagPattern = new RegExp(`<(${nativeDisableableTags.join('|')})\\b[\\s\\S]*?>`, 'g')
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(source))) {
    const tag = match[0]
    if (!/(^|\s)disabled(\s|=|\/|>)/.test(tag)) continue
    violations.push(`${filePath.replace('../', '')}:${lineOf(source, match.index)}`)
  }
  return violations
}

describe('native disabled accessibility gates', () => {
  it('keeps interactive controls focusable by using aria-disabled with click guards', () => {
    const files = import.meta.glob<string>(['../app/**/*.tsx', '../components/**/*.tsx', '../features/**/*.tsx'], {
      eager: true,
      import: 'default',
      query: '?raw',
    })
    const violations = Object.entries(files).flatMap(([filePath, source]) =>
      findNativeDisabledProps(filePath, source),
    )

    expect(violations).toEqual([])
  })
})
