import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  [
    '../features/runs/RunWorkspacePage.tsx',
    '../features/runs/runScopeSummaryViewModel.ts',
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

describe('run scope summary boundary', () => {
  it('keeps model scope copy in a ViewModel and out of page literals', () => {
    const page = sourceFor('../features/runs/RunWorkspacePage.tsx')
    const viewModel = sourceFor('../features/runs/runScopeSummaryViewModel.ts')

    expect(page).toContain('buildRunScopeSummaryViewModel')
    expect(page).not.toContain('Active task route / configured fallback')
    expect(viewModel).toContain('Active answer route')
    expect(viewModel).toContain('Selected answer model')
  })
})
