import { Clock3, FileText, Grid3X3, Image, Music2, Video } from 'lucide-react'
import type { Evidence } from '@/api/nexus'
import { StatusMark } from './StatusMark'
import { locatorLabel } from './locatorLabel'

const icons = { text: FileText, image: Image, audio: Music2, video: Video, table: Grid3X3 }

export function EvidenceCard({ evidence, compact = false }: { evidence: Evidence; compact?: boolean }) {
  const Icon = icons[evidence.modality]
  return (
    <article className={`evidence-card modality-${evidence.modality} ${compact ? 'is-compact' : ''}`}>
      <div className="evidence-card-head">
        <span className="modality-icon"><Icon size={15} /></span>
        <div>
          <strong>{evidence.source_name}</strong>
          <span>{evidence.evidence_type.replaceAll('_', ' ')}</span>
        </div>
        <StatusMark status={evidence.status} />
      </div>
      {!compact && evidence.modality === 'image' && <div className="evidence-media-preview"><img src={evidence.asset_url} alt="" loading="lazy" /></div>}
      {!compact && evidence.modality === 'audio' && <div className="evidence-media-preview audio"><audio src={evidence.asset_url} controls preload="metadata" onClick={(event) => event.stopPropagation()} /></div>}
      {!compact && evidence.modality === 'video' && <div className="evidence-media-preview"><video src={evidence.asset_url} muted preload="metadata" onClick={(event) => event.stopPropagation()} /></div>}
      <blockquote>{evidence.text_content || 'This evidence is represented by its original media.'}</blockquote>
      <footer>
        <span className="locator-chip"><Clock3 size={12} />{locatorLabel(evidence)}</span>
        <code>{evidence.id.slice(0, 8)}</code>
      </footer>
    </article>
  )
}
