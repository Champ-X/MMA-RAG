import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  [
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

function findForbidden(source: string, patterns: string[]) {
  return patterns.filter((pattern) => source.includes(pattern))
}

describe('route ViewModel boundaries', () => {
  it('pins the route ViewModel files covered by this boundary check', () => {
    expect(Object.keys(files).sort()).toEqual([
      '../features/runs/runRouteReceiptViewModel.ts',
      '../features/runs/runRouteRecoveryViewModel.ts',
    ])
    expect(sourceFor('../features/runs/runRouteReceiptViewModel.ts')).toContain('buildRunRouteReceiptViewModel')
    expect(sourceFor('../features/runs/runRouteRecoveryViewModel.ts')).toContain('buildRunRouteRecoveryViewModel')
    expect(sourceFor('../features/runs/runRouteReceiptViewModel.ts')).toContain('routeRecommendationLabel')
    expect(sourceFor('../features/runs/runRouteRecoveryViewModel.ts')).toContain('candidateScopeLabel')
  })

  it('keeps historical route receipt parsing independent from current-router recovery', () => {
    const receiptSource = sourceFor('../features/runs/runRouteReceiptViewModel.ts')

    expect(findForbidden(receiptSource, [
      'AutoRoutePreviewResult',
      'RunRouteAudit',
      'RunRouteRecovery',
      'buildRunRouteAudit',
      'buildRunRouteRecovery',
      'currentRoute',
      'routeRecoveryConfirmation',
    ])).toEqual([])
  })

  it('keeps current-router recovery out of raw routing_trace parsing', () => {
    const recoverySource = sourceFor('../features/runs/runRouteRecoveryViewModel.ts')

    expect(findForbidden(recoverySource, [
      'trace: unknown',
      'routeCandidate',
      'SpaceRouteMethod',
      'scoreComponents',
    ])).toEqual([])
  })

  it('keeps route scope and legacy method copy product-facing', () => {
    const receiptSource = sourceFor('../features/runs/runRouteReceiptViewModel.ts')
    const recoverySource = sourceFor('../features/runs/runRouteRecoveryViewModel.ts')

    expect(receiptSource).not.toContain('Unknown route method')
    expect(receiptSource).not.toContain('Candidate only')
    expect(recoverySource).not.toContain('candidate only')
    expect(receiptSource).toContain('Legacy routing trace')
  })
})
