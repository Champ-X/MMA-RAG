import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  [
    '../features/system/SystemPage.tsx',
    '../features/system/systemModelGatewayViewModel.ts',
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

describe('system model gateway boundary', () => {
  it('keeps model gateway health summarized through a ViewModel', () => {
    expect(Object.keys(files).sort()).toEqual([
      '../features/system/SystemPage.tsx',
      '../features/system/systemModelGatewayViewModel.ts',
    ])
    expect(sourceFor('../features/system/SystemPage.tsx')).toContain('buildSystemModelGatewayViewModel')
    expect(sourceFor('../features/system/SystemPage.tsx')).toContain('ModelGatewayHealthCard')
    expect(sourceFor('../features/system/systemModelGatewayViewModel.ts')).toContain('fallback_model')
    expect(sourceFor('../features/system/systemModelGatewayViewModel.ts')).toContain('deterministic-task-local-v1')
    expect(sourceFor('../features/system/systemModelGatewayViewModel.ts')).toContain('roleLabel')
  })
})
