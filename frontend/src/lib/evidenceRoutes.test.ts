import { describe, expect, it } from 'vitest'
import { buildEvidenceDetailBackPath, buildEvidenceDetailPath } from './evidenceRoutes'

describe('evidence route helpers', () => {
  it('routes global evidence details through the browser context sentinel', () => {
    expect(buildEvidenceDetailPath('evidence-1')).toBe('/runs/browser/evidence/evidence-1')
    expect(buildEvidenceDetailBackPath()).toBe('/evidence')
    expect(buildEvidenceDetailBackPath('browser')).toBe('/evidence')
  })

  it('preserves real run context for run-scoped evidence details', () => {
    expect(buildEvidenceDetailPath('evidence-1', 'run-1')).toBe('/runs/run-1/evidence/evidence-1')
    expect(buildEvidenceDetailBackPath('run-1')).toBe('/runs/run-1')
  })

  it('encodes route parameters before they enter the URL path', () => {
    expect(buildEvidenceDetailPath('evidence/1', 'run 1')).toBe('/runs/run%201/evidence/evidence%2F1')
  })
})
