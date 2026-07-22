import { describe, expect, it } from 'vitest'

const allowedOwners = new Set([
  '../components/nexus/SubmitReadinessCard.tsx',
  '../components/nexus/SubmitReadinessCard.test.tsx',
])

function lineOf(source: string, index: number) {
  return source.slice(0, index).split('\n').length
}

function findSubmitReadinessClassOwners(filePath: string, source: string) {
  if (allowedOwners.has(filePath)) return []
  const violations: string[] = []
  const pattern = /submit-readiness-card/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    violations.push(`${filePath.replace('../', '')}:${lineOf(source, match.index)}`)
  }
  return violations
}

describe('submit readiness feedback ownership', () => {
  it('keeps submit-readiness-card markup centralized in SubmitReadinessCard', () => {
    const files = import.meta.glob<string>(['../app/**/*.tsx', '../components/**/*.tsx', '../features/**/*.tsx'], {
      eager: true,
      import: 'default',
      query: '?raw',
    })
    const violations = Object.entries(files).flatMap(([filePath, source]) =>
      findSubmitReadinessClassOwners(filePath, source),
    )

    expect(violations).toEqual([])
  })
})
