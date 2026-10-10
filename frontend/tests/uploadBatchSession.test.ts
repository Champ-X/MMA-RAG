import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readUploadBatch, saveUploadBatch } from '../src/components/knowledge/uploadBatchSession'
const storage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } as Storage
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
