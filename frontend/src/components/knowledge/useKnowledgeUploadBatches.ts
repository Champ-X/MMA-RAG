import { useCallback, useRef, useState } from 'react'
import { clearUploadBatch, collectUploadRemovalIds, readUploadBatches, removeUploadTasksFromBatch, saveUploadBatch,
  type KnowledgeUploadBatch, type UploadRemoval, type UploadTaskOutcome } from './uploadBatchSession'
export { removeUploadTasksFromBatch } from './uploadBatchSession'
export type { KnowledgeUploadBatch, UploadRemoval, UploadTaskOutcome } from './uploadBatchSession'

export const emptyUploadBatch = (): KnowledgeUploadBatch => ({
  uploading: false, currentFiles: null, tasks: [], outcomes: {}, submissionFailed: 0,
})

function restoreBatches(): Record<string, KnowledgeUploadBatch> {
  if (typeof sessionStorage === 'undefined') return {}
  return Object.fromEntries(readUploadBatches(sessionStorage).map(saved => {
    const outcomes: Record<string, UploadTaskOutcome> = {}
    for (const file of saved.progress.files ?? []) {
      if (file.status === 'completed' || file.status === 'failed') outcomes[file.id] = file.status
    }
    const taskIds = new Set(saved.tasks.map(task => task.processingId))
    const submissionFailed = saved.progress.files?.filter(file => file.status === 'failed' && !taskIds.has(file.id)).length ?? 0
    const allTerminal = saved.tasks.length > 0 && saved.tasks.every(task => outcomes[task.processingId])
    const progress = allTerminal ? {
      ...saved.progress, stage: 'done' as const, stageProgress: 100,
      completed: saved.tasks.filter(task => outcomes[task.processingId] === 'completed').length,
      failed: submissionFailed + saved.tasks.filter(task => outcomes[task.processingId] === 'failed').length,
    } : saved.progress
    return [saved.kbId, {
      ...emptyUploadBatch(), progress, tasks: saved.tasks, outcomes,
      uploading: progress.stage !== 'done' && saved.tasks.some(task => !outcomes[task.processingId]),
      submissionFailed,
    }]
  }))
}

/** One owner per space. Async callbacks keep their captured KB even after navigation. */
export function useKnowledgeUploadBatches() {
  const [batches, setBatches] = useState(restoreBatches)
  const batchesRef = useRef(batches)
  const removedRef = useRef<Record<string, ReturnType<typeof collectUploadRemovalIds>>>({})
  const updateBatch = useCallback((kbId: string, update: (previous: KnowledgeUploadBatch) => KnowledgeUploadBatch) => {
    const previous = batchesRef.current[kbId] ?? emptyUploadBatch()
    const candidate = update(previous)
    const removed = collectUploadRemovalIds(candidate, {}, removedRef.current[kbId])
    if (removed.fileIds.size || removed.processingIds.size) removedRef.current[kbId] = removed
    const next = removeUploadTasksFromBatch(candidate, { processingIds: [...removed.processingIds] })
    if (next === previous) return
    const all = { ...batchesRef.current, [kbId]: next }
    // Commit synchronously so rapid clicks and simultaneous async completions cannot overwrite each other.
    batchesRef.current = all
    setBatches(all)
    if (typeof sessionStorage !== 'undefined') {
      if (next.progress?.files && (next.progress.stage === 'done' || (next.progress.submitted && next.tasks.length))) {
        saveUploadBatch(sessionStorage, kbId, next.tasks, next.progress)
      } else if (!next.progress) clearUploadBatch(sessionStorage, kbId)
    }
  }, [])

  const removeUploads = useCallback((kbId: string, removal: UploadRemoval) => {
    // Reserve identities before publishing state so a late poll/retry cannot restore them.
    removedRef.current[kbId] = collectUploadRemovalIds(batchesRef.current[kbId] ?? emptyUploadBatch(), removal, removedRef.current[kbId])
    updateBatch(kbId, previous => previous)
  }, [updateBatch])

  const isUploadRemoved = useCallback((kbId: string, fileId?: string, processingId?: string) => {
    const removed = removedRef.current[kbId]
    return Boolean(removed && ((fileId && removed.fileIds.has(fileId)) || (processingId && removed.processingIds.has(processingId))))
  }, [])

  const claimBatch = useCallback((kbId: string) => {
    if (batchesRef.current[kbId]?.uploading) return false
    updateBatch(kbId, previous => ({ ...emptyUploadBatch(), outcomes: previous.outcomes, uploading: true }))
    return true
  }, [updateBatch])

  return { batches, batchesRef, updateBatch, claimBatch, removeUploads, isUploadRemoved }
}
