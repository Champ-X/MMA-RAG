import type { ChatMessageAttachment } from '@/store/useChatStore'
import { collectUserAttachmentIds, deleteAttachmentBlobs, putAttachmentBlob } from './chatAttachmentBlobStore'
import { chatFileKind } from './chatAttachmentFile'

type AttachmentMessage = { role: string; attachments?: Array<{ id: string }> }

/** Keep files private to a submission until a user message owns them. */
export function createPendingChatAttachments(getMessages: () => AttachmentMessage[]) {
  const referencedIds = () => new Set(collectUserAttachmentIds(getMessages()))
  const existingIds = referencedIds()
  const newIds = new Set<string>()
  const previewUrls = new Set<string>()
  let published = false
  let preparation: Promise<PromiseSettledResult<ChatMessageAttachment>[]> | undefined
  let discarding: Promise<void> | undefined

  return {
    async prepare(files?: File[], attachmentIds?: string[], preview = false): Promise<ChatMessageAttachment[] | undefined> {
      if (!files?.length) return undefined
      // A failed sibling must not trigger rollback while another file is still
      // writing: that late write could otherwise recreate an orphaned blob.
      preparation = Promise.allSettled(files.map(async (file, i) => {
        const id = attachmentIds?.[i] || `att_${crypto.randomUUID()}`
        const kind = chatFileKind(file) || 'image'
        // Editing an old question can reuse its attachment IDs. Its messages
        // already own these files; do not overwrite or roll them back.
        if (!existingIds.has(id)) {
          newIds.add(id)
          await putAttachmentBlob(id, file)
        }
        const thumbDataUrl = kind === 'image'
          ? await (await import('./chatAttachmentThumb')).imageFileToPersistedThumb(file) : undefined
        const previewUrl = preview && kind === 'image' ? URL.createObjectURL(file) : undefined
        if (previewUrl) previewUrls.add(previewUrl)
        return { id, kind, name: file.name, size: file.size,
          ...(thumbDataUrl ? { thumbDataUrl } : {}), ...(previewUrl ? { previewUrl } : {}) }
      }))
      const results = await preparation
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      return results.map(result => (result as PromiseFulfilledResult<ChatMessageAttachment>).value)
    },
    publish() { published = true },
    discard(): Promise<void> {
      if (published) return Promise.resolve()
      return discarding ??= (async () => {
        // Explicit deletion can arrive before local writes or before the
        // server's create response. It need not wait for the network response.
        await preparation
        if (published) return
        for (const url of previewUrls) URL.revokeObjectURL(url)
        previewUrls.clear()
        // Another completed submission may now reference a shared ID.
        const retainedIds = referencedIds()
        await deleteAttachmentBlobs([...newIds].filter(id => !retainedIds.has(id)))
        newIds.clear()
      })()
    },
  }
}
