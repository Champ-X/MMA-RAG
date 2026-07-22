import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  [
    '../app/router.tsx',
    '../features/runs/RunWorkspaceSkeleton.tsx',
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

describe('Run workspace skeleton boundary', () => {
  it('uses a dedicated route-level skeleton for Run workspaces', () => {
    const router = sourceFor('../app/router.tsx')
    const skeleton = sourceFor('../features/runs/RunWorkspaceSkeleton.tsx')

    expect(router).toContain('RunWorkspaceSkeleton')
    expect(router).toContain("path: 'runs/:runId', element: runScreen(<RunWorkspacePage />)")
    expect(skeleton).toContain('Recovering conversation state')
    expect(skeleton).toContain('aria-busy="true"')
  })
})
