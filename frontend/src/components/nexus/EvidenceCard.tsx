import { Clock3, FileText, Grid3X3, Image, Music2, Video } from 'lucide-react'
import type { Evidence } from '@/api/nexus'
import { buildEvidenceMediaViewModel } from './evidenceMediaViewModel'
import { StatusMark } from './StatusMark'
import { locatorLabel } from './locatorLabel'
import './EvidenceCard.css'

const icons = { text: FileText, image: Image, audio: Music2, video: Video, table: Grid3X3 }

export function EvidenceCard({
  evidence,
  compact = false,
  suppressMedia = false,
  textMode = 'excerpt',
}: {
  evidence: Evidence
  compact?: boolean
  suppressMedia?: boolean
  textMode?: 'excerpt' | 'details'
}) {
  const Icon = icons[evidence.modality]
  const showMedia = !compact && !suppressMedia
  const evidenceText = evidence.text_content || 'This evidence is represented by its original media.'
  const media = buildEvidenceMediaViewModel(evidence)
  return (
    <article className={`evidence-card modality-${evidence.modality} ${compact ? 'is-compact' : ''} ${suppressMedia ? 'media-suppressed' : ''}`}>
      <div className="evidence-card-head">
        <span className="modality-icon"><Icon size={15} /></span>
        <div>
          <strong>{evidence.source_name}</strong>
          <span>{evidence.evidence_type.replaceAll('_', ' ')}</span>
        </div>
        <StatusMark status={evidence.status} />
      </div>
      {showMedia && evidence.modality === 'image' && <div className="evidence-media-preview"><img src={evidence.asset_url} alt={media.imageAlt} loading="lazy" /></div>}
      {showMedia && evidence.modality === 'audio' && <div className="evidence-media-preview audio"><audio src={evidence.asset_url} controls preload="metadata" aria-label={media.audioLabel} onClick={(event) => event.stopPropagation()} /></div>}
      {showMedia && evidence.modality === 'video' && <div className="evidence-media-preview"><video src={evidence.asset_url} muted preload="metadata" aria-label={media.videoLabel} onClick={(event) => event.stopPropagation()} /></div>}
      {textMode === 'details'
        ? <details className="evidence-card-text"><summary>Generated description</summary><blockquote>{evidenceText}</blockquote></details>
        : <blockquote>{evidenceText}</blockquote>}
      <footer>
        <span className="locator-chip"><Clock3 size={12} />{locatorLabel(evidence)}</span>
        <code>{evidence.id.slice(0, 8)}</code>
      </footer>
    </article>
  )
}
