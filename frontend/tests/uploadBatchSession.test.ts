import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readUploadBatch, readUploadBatches, saveUploadBatch } from '../src/components/knowledge/uploadBatchSession'
const storage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null } as Storage
}

test('refresh restores out-of-order task handles and keeps submission failures', () => {
  const local = storage()
  saveUploadBatch(local, 'kb-a', [
    { processingId: 'pending', filename: 'same.png', isImage: true, kbId: 'kb-a' },
    { processingId: 'finished', filename: 'same.png', isImage: true, kbId: 'kb-a' },
  ], { stage: 'parsing', total: 3, completed: 1, failed: 1, submitted: true, files: [
    { id: 'pending', name: 'same.png', status: 'processing' },
    { id: 'finished', name: 'same.png', status: 'completed' },
    { id: 'rejected:2', name: 'bad.xyz', status: 'failed', error: 'unsupported' },
  ] })
  const restored = readUploadBatch(local, 'kb-a')!
  assert.equal(restored.tasks.length, 2)
  assert.deepEqual(restored.progress.files?.map(file => file.status), ['processing', 'completed', 'failed'])
  assert.equal(readUploadBatch(local, 'kb-b'), null)
})

test('corrupt storage or quota failures never prevent opening the upload page', () => {
  const local = { getItem: () => '{bad json', setItem: () => { throw Error('quota') } } as unknown as Storage
  assert.equal(readUploadBatch(local, 'kb'), null)
  assert.doesNotThrow(() => saveUploadBatch(local, 'kb', [], { stage: 'done', total: 0, completed: 0, failed: 0 }))
})

test('all spaces recover independently, ignoring expired or foreign task handles', () => {
  const local = storage()
  const progress = { stage: 'parsing' as const, total: 1, completed: 0, failed: 0, submitted: true, files: [{ id: 'a', name: 'a.mp4', status: 'processing' }] }
  saveUploadBatch(local, 'a', [{ kbId: 'a', processingId: 'a', filename: 'a.mp4', isImage: false }], progress)
  saveUploadBatch(local, 'b', [{ kbId: 'b', processingId: 'b', filename: 'b.mp4', isImage: false }], { ...progress, files: [{ id: 'b', name: 'b.mp4', status: 'failed', error: 'provider timeout' }] })
  saveUploadBatch(local, 'foreign', [{ kbId: 'a', processingId: 'bad', filename: 'bad.mp4', isImage: false }], progress)
  local.setItem('unrelated', 'data')
  local.setItem('tessmora:upload-batch:corrupt', '{broken')
  const batches = readUploadBatches(local)
  assert.deepEqual(batches.map(batch => batch.kbId), ['a', 'b'])
  assert.equal(batches[1].progress.files![0].error, 'provider timeout')
})

test('deleted legacy rows remove their task handles and recalculate surviving results', () => {
  const local = storage()
  saveUploadBatch(local, 'a', [
    { kbId: 'a', processingId: 'removed', fileId: 'original', filename: 'same.mp4', isImage: false },
    { kbId: 'a', processingId: 'keep', fileId: 'other-original', filename: 'same.mp4', isImage: false },
  ], { stage: 'parsing', submitted: true, total: 3, completed: 0, failed: 1, files: [
    { id: 'removed', file_id: 'original', name: 'same.mp4', status: 'deleted' },
    { id: 'keep', file_id: 'other-original', name: 'same.mp4', status: 'completed' },
    { id: 'rejected:2', name: 'bad.xyz', status: 'failed' },
  ] })
  const restored = readUploadBatch(local, 'a')!
  assert.deepEqual(restored.tasks.map(task => task.processingId), ['keep'])
  assert.deepEqual(restored.progress.files?.map(file => file.id), ['keep', 'rejected:2'])
  assert.equal(restored.progress.total, 2)
  assert.equal(restored.progress.completed, 1)
  assert.equal(restored.progress.failed, 1)
  assert.equal(restored.progress.stage, 'done')
  assert.doesNotMatch(local.getItem('tessmora:upload-batch:a')!, /"removed"|"original"/)
})

test('an all-deleted snapshot is removed without skipping the next space in storage', () => {
  const local = storage()
  for (const kbId of ['removed-a', 'removed-b', 'keep-c']) {
    saveUploadBatch(local, kbId, [{ kbId, processingId: kbId, filename: 'same.mp4', isImage: false }], {
      stage: 'done', submitted: true, total: 1, completed: 0, failed: 1,
      files: [{ id: kbId, name: 'same.mp4', status: kbId.startsWith('removed') ? 'deleted' : 'failed' }],
    })
  }
  assert.deepEqual(readUploadBatches(local).map(batch => batch.kbId), ['keep-c'])
  assert.equal(local.getItem('tessmora:upload-batch:removed-a'), null)
  assert.equal(local.getItem('tessmora:upload-batch:removed-b'), null)
  assert.equal(local.length, 1)
})
