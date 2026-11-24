import { desktopWorkspace } from './desktopWorkspace'
import { createChatArchive } from './chatArchive'
import { getAttachmentBlobStrict } from './chatAttachmentBlobStore'
import { useChatStore, flushChatPersistence } from '@/store/useChatStore'

/** The main process chooses the backup destination; the renderer only streams its own history. */
export function installDesktopHistoryExport(): () => void {
  const desktop = desktopWorkspace()
  if (!desktop?.onHistoryExport || !desktop.writeHistoryChunk || !desktop.finishHistoryExport) return () => {}
  return desktop.onHistoryExport(async requestId => {
    try {
      flushChatPersistence()
      const { sessions, activeSessionId } = useChatStore.getState()
      const { blob } = await createChatArchive({ sessions, activeSessionId }, {
        source: { origin: desktop.apiOrigin || window.location.origin, ...(desktop.serverId ? { workspaceId: desktop.serverId } : {}) },
        readBlob: getAttachmentBlobStrict,
      })
      for (let offset = 0, sequence = 0; offset < blob.size; offset += 4 * 1024 * 1024, sequence++) {
        await desktop.writeHistoryChunk!(requestId, sequence, new Uint8Array(await blob.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer()))
      }
      await desktop.finishHistoryExport!(requestId)
    } catch { await desktop.finishHistoryExport!(requestId, '无法完整导出会话与附件。请检查浏览器存储和磁盘空间。').catch(() => {}) }
  })
}
