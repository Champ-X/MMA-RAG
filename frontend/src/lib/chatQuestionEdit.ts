import type { ChatScopeFile, Message } from '@/store/useChatStore'
import type { ComposerValue } from './chatReferences'
import { getAttachmentBlob } from './chatAttachmentBlobStore'
import { persistMentions, validMentions } from './chatReferences'
import { explicitScopeFiles } from './chatReferenceScope'

export interface ComposerAttachment {
  id: string
  file: File
  previewUrl?: string
}

export interface ChatComposerDraft {
  value: ComposerValue
  files: ComposerAttachment[]
  scope: ChatScopeFile[]
}

/** Restore atomically: a missing original must never be replaced by a thumbnail or a summary. */
export async function prepareQuestionEdit(
  question: Pick<Message, 'content' | 'mentions' | 'attachments' | 'scopeFiles' | 'scopeVersion'>,
  readBlob = getAttachmentBlob,
): Promise<ChatComposerDraft> {
  const recovered = await Promise.all((question.attachments ?? []).map(async item => {
    const blob = await readBlob(item.id)
    if (!blob) throw new Error(`本机附件「${item.name}」已不在浏览器中，无法完整恢复。请重新添加原文件后提问。`)
    return { previousId: item.id, id: `a-${crypto.randomUUID()}`,
      file: new File([blob], item.name, { type: blob.type }) }
  }))
  const attachmentIds = new Map(recovered.map(item => [item.previousId, item.id]))
  const mentions = persistMentions(validMentions({ text: question.content, mentions: question.mentions ?? [] }))
    .map(ref => {
      if (ref.source !== 'attachment') return ref
      const attachmentId = attachmentIds.get(ref.attachmentId ?? '')
      if (!attachmentId) throw new Error(`引用「${ref.name}」缺少原始附件，请重新添加原文件后提问。`)
      return { ...ref, attachmentId }
    })
  const scope = explicitScopeFiles(question)
  const attachmentOnly = recovered.length > 0 && !mentions.length
    && question.content === `（已上传 ${recovered.length} 个附件）`
  return {
    value: { text: attachmentOnly ? '' : question.content, mentions },
    files: recovered.map(({ id, file }) => ({ id, file })),
    scope,
  }
}
