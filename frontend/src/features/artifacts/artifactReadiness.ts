import type { Artifact } from '@/api/nexus'

export type ArtifactReadiness = {
  publishable: boolean
  tone: 'positive' | 'warning' | 'negative'
  title: string
  detail: string
}

export function getArtifactReadiness(
  artifact: Pick<Artifact, 'status' | 'coverage' | 'pending_refresh_count'>,
): ArtifactReadiness {
  if (artifact.pending_refresh_count > 0) {
    return {
      publishable: false,
      tone: 'negative',
      title: 'Source changes require review.',
      detail: `Resolve ${artifact.pending_refresh_count} pending refresh proposal${artifact.pending_refresh_count === 1 ? '' : 's'} before publishing.`,
    }
  }
  if (artifact.coverage.supported_block_count === 0 || artifact.coverage.bound_evidence_count === 0) {
    return {
      publishable: false,
      tone: 'negative',
      title: 'No evidence-supported content block.',
      detail: 'Publication requires at least one content block bound to this revision’s immutable Evidence.',
    }
  }
  if (artifact.status === 'published') {
    return {
      publishable: true,
      tone: 'positive',
      title: 'Published inside this workspace.',
      detail: 'The stable workspace link resolves to the current published revision.',
    }
  }
  if (artifact.coverage.coverage_percent < 100) {
    return {
      publishable: true,
      tone: 'warning',
      title: 'Publishable with editorial gaps.',
      detail: `${artifact.coverage.supported_block_count}/${artifact.coverage.content_block_count} content blocks carry Evidence bindings.`,
    }
  }
  return {
    publishable: true,
    tone: 'positive',
    title: 'Ready for explicit publication.',
    detail: 'Every content block is evidence-supported and no source refresh is waiting.',
  }
}
