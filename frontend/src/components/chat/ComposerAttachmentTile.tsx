import { translate as tr, useTranslation } from '@/i18n'
import { AtSign, X } from 'lucide-react'
import type { ChatMessageAttachment } from '@/store/useChatStore'
import { FileScopeThumbnail } from './FileScopeThumbnail'
import { formatAttachmentSize } from '@/lib/chatAttachmentFile'

export function ComposerAttachmentTile({ item, onRemove, onReference, disabled = false }: {
  item: ChatMessageAttachment
  onRemove: () => void
  onReference: () => void
  disabled?: boolean
}) {
  useTranslation()
  return <div className="composer-scope-card" data-source="attachment">
    <FileScopeThumbnail file={{ name: item.name, type: item.kind, previewUrl: item.previewUrl || item.thumbDataUrl }} />
    <div className="composer-scope-copy">
      <span className="composer-scope-name" title={item.name}>{item.name}</span>
      <span className="composer-scope-origin">{tr("本机 · {{kind}} · {{size}}", { kind: item.kind === 'image' ? tr("图片") : item.kind === 'audio' ? tr("音频") : tr("视频"), size: formatAttachmentSize(item.size) })}</span>
    </div>
    <button type="button" disabled={disabled} className="composer-scope-remove disabled:cursor-not-allowed disabled:opacity-40" onMouseDown={e => e.preventDefault()}
      onClick={onReference} title={tr("在光标处引用")} aria-label={tr("引用本机附件：{{v0}}", { v0: item.name })}><AtSign size={15} aria-hidden /></button>
    <button type="button" disabled={disabled} className="composer-scope-remove disabled:cursor-not-allowed disabled:opacity-40" onClick={onRemove} aria-label={tr("移除附件：{{v0}}", { v0: item.name })}><X size={14} aria-hidden /></button>
  </div>
}
