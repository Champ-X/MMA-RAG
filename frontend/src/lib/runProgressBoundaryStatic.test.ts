import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  [
    '../features/runs/RunProgressSummary.tsx',
    '../features/runs/runProgress.ts',
  ],
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

function sourceFor(path: string): string {
  const source = files[path]
  if (typeof source !== 'string') throw new Error(`Missing static source for ${path}`)
  return source
}

describe('run progress boundary', () => {
  it('keeps stop reason copy inside the progress ViewModel', () => {
    expect(Object.keys(files).sort()).toEqual([
      '../features/runs/RunProgressSummary.tsx',
      '../features/runs/runProgress.ts',
    ])
    expect(sourceFor('../features/runs/RunProgressSummary.tsx')).toContain('buildRunProgress')
    expect(sourceFor('../features/runs/runProgress.ts')).toContain('capability_unavailable')
    expect(sourceFor('../features/runs/runProgress.ts')).toContain('evidence_insufficient')
    expect(sourceFor('../features/runs/runProgress.ts')).toContain('Capability recovery required')
    expect(sourceFor('../features/runs/RunProgressSummary.tsx')).not.toContain('capability_unavailable')
    expect(sourceFor('../features/runs/RunProgressSummary.tsx')).not.toContain('evidence_insufficient')
    expect(sourceFor('../features/runs/RunProgressSummary.tsx')).not.toContain('Partial result preserved')
    expect(sourceFor('../features/runs/RunProgressSummary.tsx')).not.toContain('Answer delivered and evidence preserved')
  })
})
