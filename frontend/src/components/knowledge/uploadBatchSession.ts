import type { UploadPipelineProgress } from './UploadPipeline'

export interface UploadTaskHandle {
  processingId: string
  filename: string
  isImage: boolean
  kbId: string
}
interface BatchSnapshot {
  version: 1
  savedAt: number
  kbId: string
  tasks: UploadTaskHandle[]
  progress: UploadPipelineProgress
}
const key = (kbId: string) => `tessmora:upload-batch:${kbId}`

/** Store handles and feedback only. File bytes are never placed in browser storage. */
export function saveUploadBatch(storage: Storage, kbId: string, tasks: UploadTaskHandle[], progress: UploadPipelineProgress) {
  try { storage.setItem(key(kbId), JSON.stringify({ version: 1, savedAt: Date.now(), kbId, tasks, progress })) } catch { /* Quota/privacy mode must not affect uploads. */ }
}
export function readUploadBatch(storage: Storage, kbId: string): BatchSnapshot | null {
  try {
    const saved = JSON.parse(storage.getItem(key(kbId)) ?? 'null') as BatchSnapshot | null
    if (!saved || saved.version !== 1 || saved.kbId !== kbId || Date.now() - saved.savedAt > 86400000
      || !Number.isFinite(saved.savedAt) || !Array.isArray(saved.tasks) || saved.tasks.length > 1000
      || !saved.progress || !Number.isFinite(saved.progress.total) || !Array.isArray(saved.progress.files)
      || saved.tasks.some(task => task.kbId !== kbId || typeof task.processingId !== 'string' || typeof task.filename !== 'string')
      || saved.progress.files.some(file => typeof file.id !== 'string' || typeof file.name !== 'string' || typeof file.status !== 'string')) return null
    return saved
  } catch { return null }
}
export function clearUploadBatch(storage: Storage, kbId: string) {
  try { storage.removeItem(key(kbId)) } catch { /* Optional session feedback. */ }
}
