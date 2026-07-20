import { FileSpreadsheet, FileText, Film, Headphones, Play } from 'lucide-react'
import type { SourceVersion } from '@/api/nexus'

const extension = (name: string) => name.includes('.') ? name.split('.').pop()?.slice(0, 6).toUpperCase() : 'FILE'

export function MaterialCover({ source, compact = false }: { source: SourceVersion; compact?: boolean }) {
  const assetUrl = `/api/v1/assets/${source.id}`
  const derivedCoverUrl = source.cover_evidence_id
    ? `/api/v1/evidence/${source.cover_evidence_id}/asset`
    : null
  const hasDerivedVisuals = source.derived_image_count > 0
  const visualCoverUrl = source.modality === 'image' ? assetUrl : derivedCoverUrl
  const ext = extension(source.display_name)
  return <span className={`material-cover modality-${source.modality}${compact ? ' compact' : ''}`}>
    {visualCoverUrl ? <img src={visualCoverUrl} alt="" loading="lazy" />
      : source.modality === 'video' ? <><video src={`${assetUrl}#t=0.2`} muted preload="metadata" /><span className="material-cover-glyph"><Play fill="currentColor" /></span></>
      : source.modality === 'audio' ? <><span className="audio-cover-mark"><Headphones />{Array.from({ length: 16 }, (_, index) => <i key={index} />)}</span></>
      : source.modality === 'table' ? <span className="document-cover-mark"><FileSpreadsheet /><b>{ext}</b><i /><i /><i /></span>
      : <span className="document-cover-mark"><FileText /><b>{ext}</b><i /><i /><i /></span>}
    <span className="material-cover-shade" />
    <span className="material-cover-type">{source.modality === 'video' && <Film />}<small>{ext}{hasDerivedVisuals ? ` · ${source.derived_image_count} VISUALS` : ''}</small></span>
  </span>
}
