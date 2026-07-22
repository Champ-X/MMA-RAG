import { useEffect, useState } from 'react'
import { FileAudio, FileImage, FileSpreadsheet, FileText, Film, Paperclip, X } from 'lucide-react'
import {
  buildPendingAttachmentTileViewModel,
  buildPendingAttachmentTrayViewModel,
  type PendingAttachmentKind,
} from './PendingAttachmentTrayViewModel'
import './PendingAttachmentTray.css'

type PendingAttachmentTrayProps = {
  files: File[]
  onRemove: (index: number) => void
  detail?: string
  label?: string
}

const attachmentIcons: Record<PendingAttachmentKind, typeof FileText> = {
  audio: FileAudio,
  document: FileText,
  image: FileImage,
  table: FileSpreadsheet,
  video: Film,
}

function AttachmentTile({ file, index, onRemove }: { file: File; index: number; onRemove: (index: number) => void }) {
  const [previewUrl, setPreviewUrl] = useState('')
  const tile = buildPendingAttachmentTileViewModel(file)
  const Icon = attachmentIcons[tile.kind]

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setPreviewUrl('')
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setPreviewUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return <article className={tile.className} role="listitem" aria-label={tile.summaryLabel}>
    <span className="queued-attachment-visual">
      {previewUrl ? <img src={previewUrl} alt={tile.previewAlt} /> : <Icon aria-hidden="true" />}
    </span>
    <span className="queued-attachment-copy">
      <strong title={file.name}>{file.name}</strong>
      <small>{tile.meta}</small>
    </span>
    <button type="button" aria-label={tile.removeLabel} onClick={() => onRemove(index)}><X /></button>
  </article>
}

export function PendingAttachmentTray({
  files,
  onRemove,
  detail = 'Originals are retained, then parsed before the next turn begins.',
  label = 'Queued attachments',
}: PendingAttachmentTrayProps) {
  if (!files.length) return null
  const tray = buildPendingAttachmentTrayViewModel({ count: files.length, detail, label })
  return <section className="queued-attachments" aria-label={label}>
    <header><span><Paperclip /><strong>{tray.countLabel}</strong></span><small>{tray.detail}</small></header>
    <p className="sr-only" role="status" aria-live="polite">{tray.statusLabel}</p>
    <div role="list" aria-label={tray.listLabel}>{files.map((file, index) => <AttachmentTile file={file} index={index} key={`${file.name}-${file.size}-${file.lastModified}-${index}`} onRemove={onRemove} />)}</div>
  </section>
}
