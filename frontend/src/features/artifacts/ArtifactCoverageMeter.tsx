import type { Artifact } from '@/api/nexus'

export function ArtifactCoverageMeter({ coverage, compact = false }: { coverage: Artifact['coverage']; compact?: boolean }) {
  return <div className={`artifact-coverage-meter${compact ? ' compact' : ''}`} aria-label={`${coverage.coverage_percent}% content block evidence coverage`}>
    <span><i style={{ width: `${coverage.coverage_percent}%` }} /></span>
    <strong>{coverage.coverage_percent}%</strong>
    {!compact && <small>{coverage.supported_block_count}/{coverage.content_block_count} content blocks supported</small>}
  </div>
}
