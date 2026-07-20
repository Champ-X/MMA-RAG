import { describe, expect, it } from 'vitest'
import type { Artifact } from '@/api/nexus'
import { getArtifactReadiness } from './artifactReadiness'

const stub = (
  overrides: Partial<Pick<Artifact, 'status' | 'coverage' | 'pending_refresh_count'>> = {},
) => ({
  status: 'candidate',
  pending_refresh_count: 0,
  coverage: {
    content_block_count: 2,
    supported_block_count: 2,
    coverage_percent: 100,
    bound_evidence_count: 2,
    user_block_count: 0,
  },
  ...overrides,
}) as Pick<Artifact, 'status' | 'coverage' | 'pending_refresh_count'>

describe('artifact publication readiness', () => {
  it('blocks stale and unsupported artifacts', () => {
    expect(getArtifactReadiness(stub({ pending_refresh_count: 1 })).publishable).toBe(false)
    expect(getArtifactReadiness(stub({
      coverage: {
        ...stub().coverage,
        supported_block_count: 0,
        bound_evidence_count: 0,
        coverage_percent: 0,
      },
    })).publishable).toBe(false)
  })

  it('distinguishes complete and partial evidence coverage', () => {
    expect(getArtifactReadiness(stub()).tone).toBe('positive')
    expect(getArtifactReadiness(stub({
      coverage: { ...stub().coverage, supported_block_count: 1, coverage_percent: 50 },
    })).tone).toBe('warning')
  })
})
