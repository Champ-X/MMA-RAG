import type { Space } from '@/api/nexus'

export function spaceCoverUrl(
  space: Pick<Space, 'cover_evidence_id' | 'cover_source_version_id'>,
) {
  if (space.cover_evidence_id) return `/api/v1/evidence/${space.cover_evidence_id}/asset`
  if (space.cover_source_version_id) return `/api/v1/assets/${space.cover_source_version_id}`
  return null
}
