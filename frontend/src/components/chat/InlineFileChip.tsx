import { useState } from 'react'
import { filePresentation } from './FileScopeThumbnail'
import type { ChatReference } from '@/lib/chatReferences'
import './mentionComposer.css'

export function InlineFileChip({ reference }: { reference: ChatReference }) {
  const { kind, Icon } = filePresentation(reference)
  const src = kind === 'image' ? reference.previewUrl : reference.coverUrl
  const [failed, setFailed] = useState<string>()
  const origin = reference.source === 'attachment' ? '本机' : reference.kbName || '知识库'
  return (
    <span className="inline-file-chip" data-source={reference.source} title={`${origin} / ${reference.name}`}>
      <span className="inline-file-chip__thumb" data-kind={kind} aria-hidden="true">
        {src && failed !== src
          ? <img src={src} alt="" draggable={false} onError={() => setFailed(src)} />
          : <Icon size={17} strokeWidth={1.7} />}
      </span>
      <span className="inline-file-chip__name">{reference.name}</span>
      <span className="inline-file-chip__source">{origin}</span>
    </span>
  )
}
