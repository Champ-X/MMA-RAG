import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  emptyUploadBatch, removeUploadTasksFromBatch, useKnowledgeUploadBatches,
  type KnowledgeUploadBatch,
} from '../src/components/knowledge/useKnowledgeUploadBatches'

function batch(kbId = 'a'): KnowledgeUploadBatch {
  return {
    ...emptyUploadBatch(), uploading: true, submissionFailed: 1,
    tasks: ['done', 'failed', 'pending'].map(id => ({ kbId, processingId: id, fileId: `file-${id}`, filename: 'same.mp4', isImage: false })),
    outcomes: { done: 'completed', failed: 'failed' },
    progress: { stage: 'parsing', total: 4, completed: 1, failed: 2, submitted: true,
      files: [
        { id: 'done', file_id: 'file-done', name: 'same.mp4', status: 'completed' },
        { id: 'failed', file_id: 'file-failed', name: 'same.mp4', status: 'failed' },
        { id: 'pending', file_id: 'file-pending', name: 'same.mp4', status: 'processing' },
        { id: 'rejected:3', name: 'same.mp4', status: 'failed' },
      ] },
  }
}

test('file identity removes exactly the matching task and row, retaining same-name siblings', () => {
  const original = batch()
  const next = removeUploadTasksFromBatch(original, { fileId: 'file-failed' })
  assert.deepEqual(next.tasks.map(task => task.processingId), ['done', 'pending'])
  assert.deepEqual(next.progress?.files?.map(file => file.id), ['done', 'pending', 'rejected:3'])
  assert.deepEqual(next.outcomes, { done: 'completed' })
  assert.equal(next.progress?.total, 3)
  assert.equal(next.progress?.completed, 1)
  assert.equal(next.progress?.failed, 1)
  assert.equal(next.submissionFailed, 1)
  assert.equal(next.uploading, true)
  assert.equal(original.tasks.length, 3, 'the reducer must not mutate its input')
  assert.equal(original.progress?.files?.length, 4)
})

test('a deletion reported with only processing_id removes the row and outcomes', () => {
  const next = removeUploadTasksFromBatch(batch(), { processingIds: ['pending', 'rejected:3'] })
  assert.deepEqual(next.tasks.map(task => task.processingId), ['done', 'failed'])
  assert.equal(next.progress?.total, 2)
  assert.equal(next.progress?.completed, 1)
  assert.equal(next.progress?.failed, 1)
  assert.equal(next.submissionFailed, 0)
  assert.equal(next.progress?.stage, 'done')
  assert.equal(next.uploading, false)
})

test('file IDs from either the progress row or task handle resolve all linked attempts', () => {
  const original = batch()
  original.tasks[0].fileId = undefined
  original.tasks[1].fileId = 'file-done'
  original.progress!.files![1].file_id = undefined
  const next = removeUploadTasksFromBatch(original, { processingIds: ['done'] })
  assert.deepEqual(next.tasks.map(task => task.processingId), ['pending'])
  assert.deepEqual(next.progress?.files?.map(file => file.id), ['pending', 'rejected:3'])
  assert.deepEqual(next.outcomes, {})
})

test('clearing every entry drops progress while preserving an outstanding transfer lock', () => {
  const original = batch()
  const removal = { processingIds: ['done', 'failed', 'pending', 'rejected:3'] }
  const complete = removeUploadTasksFromBatch(original, removal)
  assert.equal(complete.progress, undefined)
  assert.equal(complete.uploading, false)
  assert.deepEqual(complete.tasks, [])
  assert.deepEqual(complete.outcomes, {})
  assert.equal(complete.submissionFailed, 0)
  const selected = [] as File[]
  const transfer = removeUploadTasksFromBatch({ ...original, currentFiles: selected,
    progress: { ...original.progress!, stage: 'minio', submitted: false } }, removal)
  assert.equal(transfer.progress, undefined)
  assert.equal(transfer.uploading, true)
  assert.equal(transfer.currentFiles, selected)
})

test('an unrelated exact ID leaves the batch unchanged', () => {
  const original = batch()
  assert.equal(removeUploadTasksFromBatch(original, { fileId: 'file-failed-suffix' }), original)
  assert.equal(removeUploadTasksFromBatch(original, { processingIds: ['same.mp4'] }), original)
})

test('the hook fences synchronous late updates per space and removes its saved snapshot', () => {
  const values = new Map<string, string>()
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
  } })
  let owner!: ReturnType<typeof useKnowledgeUploadBatches>
  // SSR supplies a real React hook dispatcher. Assertions target its synchronous
  // ownership ref and persistence, independent of browser rendering or effects.
  function Probe() { owner = useKnowledgeUploadBatches(); return null }
  try {
    renderToString(createElement(Probe))
    const stale = batch()
    owner.updateBatch('a', () => stale)
    owner.updateBatch('b', () => batch('b'))
    owner.removeUploads('a', { fileId: 'file-failed' })
    assert.equal(owner.isUploadRemoved('a', undefined, 'failed'), true)
    assert.equal(owner.isUploadRemoved('a', 'file-failed'), true)
    assert.equal(owner.isUploadRemoved('b', 'file-failed', 'failed'), false)
    owner.updateBatch('a', () => stale)
    assert.equal(owner.batchesRef.current.a.tasks.some(task => task.processingId === 'failed'), false)
    assert.equal(owner.batchesRef.current.b.tasks.some(task => task.processingId === 'failed'), true)
    owner.updateBatch('a', current => ({ ...current, tasks: [...current.tasks,
      { kbId: 'a', processingId: 'late-new-id', fileId: 'file-failed', filename: 'renamed.mp4', isImage: false }],
      progress: { ...current.progress!, files: [...current.progress!.files!,
        { id: 'late-new-id', file_id: 'file-failed', name: 'renamed.mp4', status: 'queued' }] },
    }))
    assert.equal(owner.isUploadRemoved('a', undefined, 'late-new-id'), true)
    assert.equal(owner.batchesRef.current.a.tasks.some(task => task.processingId === 'late-new-id'), false)
    owner.removeUploads('a', { processingIds: ['done', 'pending', 'rejected:3'] })
    assert.equal(owner.batchesRef.current.a.progress, undefined)
    assert.equal(values.has('tessmora:upload-batch:a'), false)
    assert.equal(values.has('tessmora:upload-batch:b'), true)
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})
