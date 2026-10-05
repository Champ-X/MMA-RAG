import { Fragment, useEffect } from 'react'
import type { ChatMessageAttachment } from '@/store/useChatStore'
import { validMentions, type ChatMention } from '@/lib/chatReferences'
import { useFileScopeOptions } from './useFileScopeOptions'
import { InlineFileChip } from './InlineFileChip'

export function UserMentionText({ text, mentions = [], attachments = [] }: {
  text: string; mentions?: ChatMention[]; attachments?: ChatMessageAttachment[]
}) {
  const kbIds = [...new Set(mentions.filter(ref => ref.source === 'knowledge').map(ref => ref.kbId!))]
  const { filesByKb, loadKbFiles, failedKbIds } = useFileScopeOptions(kbIds.length > 0)
  useEffect(() => {
    kbIds.forEach(id => { if (!failedKbIds.includes(id)) void loadKbFiles(id).catch(() => {}) })
  }, [kbIds.join(','), loadKbFiles, failedKbIds])
  let cursor = 0
  const parts = validMentions({ text, mentions }).map(ref => {
    const prefix = text.slice(cursor, ref.start)
    cursor = ref.end
    const source = ref.source === 'knowledge' ? filesByKb[ref.kbId!]?.find(f => f.id === ref.fileId) : undefined
    const attachment = attachments.find(item => item.id === ref.attachmentId)
    return <Fragment key={ref.start}>{prefix}<InlineFileChip reference={{ ...ref,
      previewUrl: source?.previewUrl || attachment?.previewUrl || attachment?.thumbDataUrl,
      coverUrl: source?.coverUrl,
    }} /></Fragment>
  })
  return <div className="user-inline-mentions break-words">{parts}{text.slice(cursor)}</div>
}
