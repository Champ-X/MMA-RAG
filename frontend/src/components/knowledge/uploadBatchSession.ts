import type { UploadPipelineProgress } from './UploadPipeline'

export interface UploadTaskHandle {
  processingId: string
  fileId?: string
  filename: string
  isImage: boolean
  kbId: string
}
export type UploadTaskOutcome = 'completed' | 'failed'
export interface KnowledgeUploadBatch {
  uploading: boolean
  currentFiles: File[] | null
  progress?: UploadPipelineProgress
  tasks: UploadTaskHandle[]
  outcomes: Record<string, UploadTaskOutcome>
  submissionFailed: number
}
export interface UploadRemoval {
  fileId?: string
  processingIds?: string[]
}
interface UploadRemovalIds {
  fileIds: Set<string>
  processingIds: Set<string>
}

/** Resolve only exact identities, including older attempts of the same original. */
export function collectUploadRemovalIds(batch: KnowledgeUploadBatch, removal: UploadRemoval, prior?: UploadRemovalIds): UploadRemovalIds {
  const fileIds = new Set(prior?.fileIds)
  const processingIds = new Set(prior?.processingIds)
  if (removal.fileId) fileIds.add(removal.fileId)
  for (const id of removal.processingIds ?? []) if (id) processingIds.add(id)
  for (const file of batch.progress?.files ?? []) {
    if (file.status === 'deleted') {
      processingIds.add(file.id)
      if (file.file_id) fileIds.add(file.file_id)
    }
  }
  let previousSize = -1
  while (previousSize !== fileIds.size + processingIds.size) {
    previousSize = fileIds.size + processingIds.size
    for (const task of batch.tasks) {
      if (processingIds.has(task.processingId) || (task.fileId && fileIds.has(task.fileId))) {
        processingIds.add(task.processingId)
        if (task.fileId) fileIds.add(task.fileId)
      }
    }
    for (const file of batch.progress?.files ?? []) {
      if (processingIds.has(file.id) || (file.file_id && fileIds.has(file.file_id))) {
        processingIds.add(file.id)
        if (file.file_id) fileIds.add(file.file_id)
      }
    }
  }
  return { fileIds, processingIds }
}

/** Remove deleted uploads without losing siblings or an outstanding transfer lock. */
export function removeUploadTasksFromBatch(batch: KnowledgeUploadBatch, removal: UploadRemoval): KnowledgeUploadBatch {
  const { processingIds } = collectUploadRemovalIds(batch, removal)
  const tasks = batch.tasks.filter(task => !processingIds.has(task.processingId))
  const files = batch.progress?.files?.filter(file => !processingIds.has(file.id)) ?? []
  const outcomes = Object.fromEntries(Object.entries(batch.outcomes).filter(([id]) => !processingIds.has(id)))
  if (tasks.length === batch.tasks.length && files.length === (batch.progress?.files?.length ?? 0)
    && Object.keys(outcomes).length === Object.keys(batch.outcomes).length) return batch

  const transferPending = batch.uploading && !batch.progress?.submitted
  const taskIds = new Set(tasks.map(task => task.processingId))
  const statusById = new Map(files.map(file => [file.id, file.status]))
  for (const task of tasks) statusById.set(task.processingId, outcomes[task.processingId] ?? statusById.get(task.processingId) ?? 'queued')
  const states = [...statusById.values()]
  const completed = states.filter(status => status === 'completed').length
  const failed = states.filter(status => status === 'failed').length
  const pending = states.some(status => status !== 'completed' && status !== 'failed')
  const submissionFailed = files.filter(file => file.status === 'failed' && !taskIds.has(file.id)).length
  const progress = statusById.size && batch.progress ? {
    ...batch.progress, files, total: statusById.size, completed, failed,
    ...(!pending && !transferPending ? { stage: 'done' as const, stageProgress: 100, currentFile: undefined, currentFileIsImage: undefined }
      : batch.progress.stage === 'done' ? { stage: 'parsing' as const } : {}),
  } : undefined
  return {
    ...batch, tasks, outcomes, progress, submissionFailed,
    uploading: transferPending || pending,
    currentFiles: transferPending || pending ? batch.currentFiles : null,
  }
}
export interface BatchSnapshot {
  version: 1
  savedAt: number
  kbId: string
  tasks: UploadTaskHandle[]
  progress: UploadPipelineProgress
}
const prefix = 'tessmora:upload-batch:'
const key = (kbId: string) => `${prefix}${kbId}`

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
    const outcomes: Record<string, UploadTaskOutcome> = {}
    for (const file of saved.progress.files) {
      if (file.status === 'completed' || file.status === 'failed') outcomes[file.id] = file.status
    }
    const batch: KnowledgeUploadBatch = { uploading: false, currentFiles: null,
      tasks: saved.tasks, progress: saved.progress, outcomes, submissionFailed: 0 }
    const cleaned = removeUploadTasksFromBatch(batch, {})
    if (cleaned === batch) return saved
    if (!cleaned.progress) {
      clearUploadBatch(storage, kbId)
      return null
    }
    const normalized = { ...saved, tasks: cleaned.tasks, progress: cleaned.progress }
    try { storage.setItem(key(kbId), JSON.stringify(normalized)) } catch { /* Optional persistence. */ }
    return normalized
  } catch { return null }
}
export function clearUploadBatch(storage: Storage, kbId: string) {
  try { storage.removeItem(key(kbId)) } catch { /* Optional session feedback. */ }
}

/** Recover every space, including batches whose detail page has not been revisited. */
export function readUploadBatches(storage: Storage): BatchSnapshot[] {
  const batches: BatchSnapshot[] = []
  try {
    // Reading may remove an all-deleted snapshot; snapshot keys before that mutation.
    const entries = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    for (const entry of entries) {
      if (!entry?.startsWith(prefix)) continue
      const saved = readUploadBatch(storage, entry.slice(prefix.length))
      if (saved) batches.push(saved)
    }
  } catch { /* Storage may be disabled; the server file list can still recover tasks. */ }
  return batches
}
