export type PendingAttachmentFile = Pick<File, 'name' | 'size' | 'type'>

export type PendingAttachmentKind = 'audio' | 'document' | 'image' | 'table' | 'video'

export type PendingAttachmentTileViewModel = {
  className: string
  kind: PendingAttachmentKind
  kindLabel: string
  meta: string
  previewAlt: string
  removeLabel: string
  summaryLabel: string
}

export type PendingAttachmentTrayViewModel = {
  countLabel: string
  detail: string
  listLabel: string
  statusLabel: string
}

export function formatAttachmentFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function getPendingAttachmentKind(file: PendingAttachmentFile): PendingAttachmentKind {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('video/')) return 'video'
  if (/\.(csv|xls|xlsx|xlsm)$/i.test(file.name)) return 'table'
  return 'document'
}

export function buildPendingAttachmentTileViewModel(file: PendingAttachmentFile): PendingAttachmentTileViewModel {
  const kind = getPendingAttachmentKind(file)
  const size = formatAttachmentFileSize(file.size)
  const kindLabel = kind

  return {
    className: `queued-attachment kind-${kind}`,
    kind,
    kindLabel,
    meta: `${kindLabel} · ${size} · queued`,
    previewAlt: kind === 'image' ? `Preview thumbnail for ${file.name}` : '',
    removeLabel: `Remove ${file.name} from queued attachments`,
    summaryLabel: `${file.name} · ${kindLabel} · ${size} · queued for intake`,
  }
}

export function buildPendingAttachmentTrayViewModel({
  count,
  detail,
  label,
}: {
  count: number
  detail: string
  label: string
}): PendingAttachmentTrayViewModel {
  const countLabel = `${count} ${count === 1 ? 'attachment' : 'attachments'} queued`

  return {
    countLabel,
    detail,
    listLabel: `${label}: ${countLabel}`,
    statusLabel: `${countLabel}. ${detail}`,
  }
}
