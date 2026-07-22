import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  [
    '../generated/nexus.ts',
    '../features/runs/autoRoutePreviewViewModel.ts',
    '../features/runs/runRouteReceiptViewModel.ts',
    '../features/runs/runRouteRecoveryViewModel.ts',
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

describe('route generated contract', () => {
  it('pins selected_for_search as a generated route candidate contract', () => {
    expect(Object.keys(files).sort()).toEqual([
      '../features/runs/autoRoutePreviewViewModel.ts',
      '../features/runs/runRouteReceiptViewModel.ts',
      '../features/runs/runRouteRecoveryViewModel.ts',
      '../generated/nexus.ts',
    ])
    expect(sourceFor('../generated/nexus.ts')).toContain('selected_for_search: boolean')
  })

  it('keeps route ViewModels consuming the authoritative selected_for_search flag', () => {
    expect(sourceFor('../features/runs/autoRoutePreviewViewModel.ts')).toContain('candidate.selected_for_search')
    expect(sourceFor('../features/runs/runRouteReceiptViewModel.ts')).toContain('value.selected_for_search')
    expect(sourceFor('../features/runs/runRouteRecoveryViewModel.ts')).toContain('candidate.selected_for_search')
  })
})
