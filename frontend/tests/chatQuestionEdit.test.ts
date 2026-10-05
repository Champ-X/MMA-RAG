import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareQuestionEdit } from '../src/lib/chatQuestionEdit'
import { removeReferences, validMentions } from '../src/lib/chatReferences'
import type { Message } from '../src/store/useChatStore'

test('edit restores exact multiline text, remaps repeated local references, and separates same-name files', async () => {
  const content = '🖼️对比@同名.png与@同名.png\n再看@同名.png。'
  const offsets = [...content.matchAll(/@同名\.png/g)].map(match => match.index!)
  const question: Message = {
    id: 'question', role: 'user', timestamp: 1, content,
    attachments: [
      { id: 'local-a', kind: 'image', name: '同名.png', size: 1 },
      { id: 'local-b', kind: 'image', name: '同名.png', size: 1 },
    ],
    mentions: offsets.map((start, i) => ({ source: 'attachment', name: '同名.png', type: 'image/png',
      start, end: start + '@同名.png'.length, attachmentId: i === 1 ? 'local-b' : 'local-a', previewUrl: 'blob:expired' })),
  }
  const snapshot = JSON.stringify(question)
  const restored = await prepareQuestionEdit(question, async id => new Blob([id], { type: 'image/png' }))
  assert.equal(restored.value.text, content)
  assert.deepEqual(restored.value.mentions.map(ref => ref.start), offsets)
  assert.equal(validMentions(restored.value).length, 3)
  const ids = restored.files.map(file => file.id)
  assert.equal(new Set(ids).size, 2)
  assert.ok(ids.every(id => !['local-a', 'local-b'].includes(id)))
  assert.deepEqual(restored.value.mentions.map(ref => ref.attachmentId), [ids[0], ids[1], ids[0]])
  assert.equal(await restored.files[0].file.text(), 'local-a')
  assert.equal(restored.files[0].file.type, 'image/png')
  assert.ok(restored.value.mentions.every(ref => !ref.previewUrl))
  assert.equal(JSON.stringify(question), snapshot, 'editing must leave the original history unchanged')
  const second = await prepareQuestionEdit(question, async () => new Blob(['image']))
  assert.ok(second.files.every(file => !ids.includes(file.id)))
})

test('deleting a restored inline reference releases its scope, while pinned files remain', async () => {
  const inline = { kbId: 'kb', fileId: 'inline', name: '图.png' }
  const pinned = { kbId: 'kb', fileId: 'pinned', name: '文档.md' }
  const restored = await prepareQuestionEdit({ content: '查看@图.png', scopeFiles: [inline, pinned],
    mentions: [{ ...inline, source: 'knowledge', type: 'image/png', start: 2, end: 8, previewUrl: 'expired' }] })
  assert.deepEqual(restored.scope, [pinned])
  assert.equal(restored.value.mentions[0].fileId, inline.fileId)
  const removed = removeReferences(restored.value, () => true)
  assert.equal(removed.text, '查看')
  assert.deepEqual(removed.mentions, [])
  assert.deepEqual(restored.scope, [pinned])
})

test('missing original attachments fail atomically instead of sending thumbnails or partial inputs', async () => {
  await assert.rejects(prepareQuestionEdit({ content: '分析这两张图', attachments: [
    { id: 'available', kind: 'image', name: 'a.png', size: 1 },
    { id: 'missing', kind: 'image', name: 'b.png', size: 1, thumbDataUrl: 'data:image/png;base64,preview' },
  ] }, async id => id === 'available' ? new Blob(['original']) : undefined), /b\.png.*无法完整恢复/)
})

test('orphan local references cannot enter an editable draft with a fabricated identity', async () => {
  await assert.rejects(prepareQuestionEdit({ content: '@a.png', mentions: [
    { source: 'attachment', name: 'a.png', type: 'image/png', start: 0, end: 6, attachmentId: 'missing' },
  ] }), /缺少原始附件/)
})

test('plain messages and attachment-only inputs are both editable', async () => {
  assert.deepEqual(await prepareQuestionEdit({ content: '文字\n第二行' }), {
    value: { text: '文字\n第二行', mentions: [] }, files: [], scope: [],
  })
  const restored = await prepareQuestionEdit({ content: '（已上传 1 个附件）', attachments: [
    { id: 'audio', kind: 'audio', name: '音乐.wav', size: 3 },
  ] }, async () => new Blob(['wav'], { type: 'audio/wav' }))
  assert.equal(restored.value.text, '')
  assert.equal(restored.files.length, 1)
  assert.equal(restored.files[0].file.name, '音乐.wav')
})
