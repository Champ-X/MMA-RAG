import { useState } from 'react'
import { FileText, Image, Music, Video } from 'lucide-react'
import type { KnowledgeBaseFileItem } from './useFileScopeOptions'
import './fileScopeThumbnail.css'

export function filePresentation(file: Pick<KnowledgeBaseFileItem, 'name' | 'type'>) {
  const type = String(file.type || '').toLowerCase().split(';')[0].trim()
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const matches = (values: string[]) => values.includes(type) || values.includes(extension)
  if (type.startsWith('audio/') || matches(['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'opus'])) return { Icon: Music, kind: 'audio', label: '音频' }
  if (type.startsWith('video/') || matches(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'])) return { Icon: Video, kind: 'video', label: '视频' }
  if (type.startsWith('image/') || matches(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'tiff', 'tif', 'heic', 'heif'])) return { Icon: Image, kind: 'image', label: '图片' }
  return { Icon: FileText, kind: 'document', label: '文档' }
}

export function FileScopeThumbnail({ file }: { file: Pick<KnowledgeBaseFileItem, 'name' | 'type' | 'previewUrl' | 'coverUrl'> }) {
  const { Icon, kind } = filePresentation(file)
  const src = kind === 'image' ? file.previewUrl : kind === 'video' ? file.coverUrl : undefined
  const [failedSrc, setFailedSrc] = useState<string>()
  const showPreview = Boolean(src && src !== failedSrc)

  return (
    <span className="scope-file-row__icon" data-kind={kind} data-preview={showPreview} aria-hidden="true">
      {showPreview ? (
        <>
          <img src={src} alt="" width={68} height={46} loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
          {kind === 'video' && <span className="scope-file-row__video-mark"><Video size={11} strokeWidth={1.8} /></span>}
        </>
      ) : <Icon size={21} strokeWidth={1.5} />}
    </span>
  )
}
