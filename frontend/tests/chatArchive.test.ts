import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatArchive, readChatArchive, importChatArchive, type ChatArchiveState } from '../src/lib/chatArchive'

const state = (): ChatArchiveState => ({ sessions: [{ id: 'session-a', title: 'Synthetic history', createdAt: 100, updatedAt: 200, isActive: true, knowledgeBaseIds: ['kb-preserved'], messages: [
  { id: 'user-1', role: 'user', content: 'Ask CEDAR-17', timestamp: 100, attachments: [{ id: 'attachment-a', kind: 'audio', name: 'same-name.wav', size: 10, previewUrl: 'blob:expired' }] },
  { id: 'answer-1', role: 'assistant', content: 'Answer with original reference', timestamp: 200, citations: [{ file_path: 'source.pdf', page: 2, video_url: '/api/objects/x?expires=99&signature=private-capability' }] as never },
] }], activeSessionId: 'session-a' })
const empty = (): ChatArchiveState => ({ sessions: [], activeSessionId: null })
const source = { origin: 'https://source.example', workspaceId: 'source-workspace' }

test('binary archive roundtrip retains IDs, Unicode and exact attachments without transient credentials', async () => {
  const original = state(); original.sessions[0].title = '中文 研究手册'
  const blob = new Blob(['audio-data'], { type: 'audio/wav' })
  const output = await createChatArchive(original, { source, readBlob: async () => blob })
  assert.equal(output.manifest.state.sessions[0].messages[0].attachments?.[0].previewUrl, undefined)
  assert.equal(output.manifest.state.sessions[0].messages[1].citations?.[0].video_url, '')
  const restored = await readChatArchive(output.blob)
  assert.equal(await restored.attachments.get('attachment-a')?.text(), 'audio-data')
  assert.equal(restored.manifest.state.sessions[0].title, '中文 研究手册')
  assert.equal(restored.manifest.state.sessions[0].knowledgeBaseIds[0], 'kb-preserved')
  assert.equal(restored.manifest.includesServerData, false)
  const raw = await output.blob.text(); assert.ok(!raw.includes('private-capability') && !raw.includes('blob:expired'))
  assert.equal(original.sessions[0].messages[0].attachments?.[0].previewUrl, 'blob:expired')
})
test('large attachments are chunk-verified and corruption is rejected before import', async () => {
  const blob = new Blob([new Uint8Array(5 * 1024 * 1024).fill(12)])
  const output = await createChatArchive(state(), { source, readBlob: async () => blob })
  assert.equal(output.manifest.attachments[0].sha256.length, 2)
  await readChatArchive(output.blob)
  const bytes = new Uint8Array(await output.blob.arrayBuffer()); bytes[bytes.length - 1] ^= 1
  await assert.rejects(readChatArchive(new Blob([bytes])), /附件校验失败/)
  await assert.rejects(readChatArchive(new Blob([output.blob, 'extra'])), /未登记/)
  await assert.rejects(readChatArchive(new Blob(['not an archive but a file'])), /会话归档/)
})
test('missing blobs are reported explicitly and repeated import is idempotent', async () => {
  const missing = await createChatArchive(state(), { source, readBlob: async () => undefined })
  assert.deepEqual(missing.manifest.missingAttachmentIds, ['attachment-a'])
  await readChatArchive(missing.blob)
  const output = await createChatArchive(state(), { source, readBlob: async () => new Blob(['audio-data']) })
  const archive = await readChatArchive(output.blob)
  let current = empty()
  const blobs = new Map<string, Blob>()
  const dependencies = { readBlob: async (id: string) => blobs.get(id), writeBlobs: async (items: Array<{ id: string; blob: Blob }>) => { items.forEach(item => blobs.set(item.id, item.blob)) }, deleteBlobs: async (ids: string[]) => { ids.forEach(id => blobs.delete(id)) }, saveState: (value: ChatArchiveState) => { current = value } }
  assert.deepEqual(await importChatArchive(archive, current, dependencies), { imported: 1, skipped: 0, attachments: 1, missing: 0 })
  assert.deepEqual(await importChatArchive(archive, current, dependencies), { imported: 0, skipped: 1, attachments: 0, missing: 0 })
  assert.equal(current.sessions.length, 1); assert.equal(await blobs.get('attachment-a')?.text(), 'audio-data')
})
test('session and attachment conflicts preserve existing contents; quota failure rolls back new blobs', async () => {
  const archive = await readChatArchive((await createChatArchive(state(), { source, readBlob: async () => new Blob(['audio-data']) })).blob)
  let current = empty(), saved = 0
  const blobs = new Map<string, Blob>()
  const dependencies = { readBlob: async (id: string) => blobs.get(id), writeBlobs: async (items: Array<{ id: string; blob: Blob }>) => { items.forEach(item => blobs.set(item.id, item.blob)) }, deleteBlobs: async (ids: string[]) => { ids.forEach(id => blobs.delete(id)) }, saveState: (value: ChatArchiveState) => { saved++; current = value } }
  const conflicting = state(); conflicting.sessions[0].messages[0].content = 'different content'
  await assert.rejects(importChatArchive(archive, conflicting, dependencies), /会话.*冲突/)
  assert.equal(saved, 0); assert.equal(blobs.size, 0)
  blobs.set('attachment-a', new Blob(['different']))
  await assert.rejects(importChatArchive(archive, empty(), dependencies), /附件.*不同/)
  assert.equal(await blobs.get('attachment-a')?.text(), 'different')
  blobs.clear()
  await assert.rejects(importChatArchive(archive, empty(), { ...dependencies, saveState: () => { throw new Error('QuotaExceeded') } }), /QuotaExceeded/)
  assert.equal(blobs.size, 0); assert.deepEqual(current, empty())
})

test('background conversation changes during attachment import survive the final merge', async () => {
  const archive = await readChatArchive((await createChatArchive(state(), { source, readBlob: async () => new Blob(['audio-data']) })).blob)
  let current = empty()
  await importChatArchive(archive, current, {
    readBlob: async () => undefined,
    writeBlobs: async () => { current = state(); current.sessions[0].id = 'background-session'; current.sessions[0].title = 'Newly completed answer'; current.activeSessionId = 'background-session' },
    deleteBlobs: async () => {}, getCurrentState: () => current,
    saveState: value => { current = value },
  })
  assert.equal(current.sessions.length, 2)
  assert.equal(current.activeSessionId, 'background-session')
  assert.ok(current.sessions.some(session => session.title === 'Newly completed answer'))
})
