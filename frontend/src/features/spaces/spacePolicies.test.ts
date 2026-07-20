import { describe, expect, it } from 'vitest'
import type { Space } from '@/api/nexus'
import { getSpacePolicyTemplate, recommendSpaceSelection } from './spacePolicies'

function stubSpace(
  label: string,
  kind: 'quick' | 'research',
  quality: 'fast' | 'quality' | 'deep',
): Space {
  return {
    policy: {
      profile: kind === 'research' ? 'research' : 'searchable',
      label,
      summary: '',
      default_quality: quality,
      recommended_run_kind: kind,
      auto_route_eligible: true,
      behaviors: [],
    },
  } as unknown as Space
}

describe('Space usage policies', () => {
  it('gives archive an explicit manual-routing contract', () => {
    const archive = getSpacePolicyTemplate('archive')
    expect(archive.defaultQuality).toBe('fast')
    expect(archive.routing).toBe('Manual scope only')
  })

  it('promotes a mixed scope to its strongest research contract', () => {
    const recommendation = recommendSpaceSelection([
      stubSpace('Balanced search', 'quick', 'quality'),
      stubSpace('Deep research', 'research', 'deep'),
    ])
    expect(recommendation).toEqual({
      kind: 'research',
      quality: 'deep',
      labels: ['Balanced search', 'Deep research'],
    })
  })
})
