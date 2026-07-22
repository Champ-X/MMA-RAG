import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  [
    '../features/runs/RunWorkspacePage.tsx',
    '../features/runs/queryUnderstandingViewModel.ts',
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

describe('query understanding fallback boundary', () => {
  it('keeps task fallback parsing inside a dedicated ViewModel', () => {
    const page = sourceFor('../features/runs/RunWorkspacePage.tsx')
    const viewModel = sourceFor('../features/runs/queryUnderstandingViewModel.ts')

    expect(page).toContain('buildQueryUnderstandingFallbackViewModel')
    expect(page).not.toContain('intent_degradation')
    expect(page).not.toContain('rewrite_degradation')
    expect(viewModel).toContain('intent_degradation')
    expect(viewModel).toContain('rewrite_degradation')
    expect(viewModel).toContain('reasonLabel')
    expect(viewModel).toContain('Query guardrail fallback')
  })
})
