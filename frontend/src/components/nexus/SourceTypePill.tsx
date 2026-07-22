import './SourceTypePill.css'

export function SourceTypePill({ modality }: { modality: string }) {
  return <span className={`source-type modality-${modality}`}>{modality}</span>
}
