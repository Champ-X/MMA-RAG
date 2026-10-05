import assert from 'node:assert/strict'
import { test } from 'node:test'
import { persistMentions, removeReferences, trimComposerValue, validMentions, type ComposerValue } from '../src/lib/chatReferences'
import { fromMentionDocument, toMentionDocument } from '../src/components/chat/mentionDocument'
import { getFileMentionState } from '../src/components/chat/fileMentionGroups'

function example(): ComposerValue {
  const text = '  🖼️分析@同名.png和@同名.png\n再看@同名.png。  '
  const positions = [...text.matchAll(/@同名\.png/g)].map(m => m.index!)
  return { text, mentions: positions.map((start, i) => ({
    source: i === 1 ? 'attachment' : 'knowledge', name: '同名.png', type: 'image/png',
    ...(i === 1 ? { attachmentId: 'local' } : { kbId: 'images', fileId: 'first' }),
    start, end: start + '@同名.png'.length, previewUrl: 'blob:temporary',
  })) }
}

test('editor round trip preserves Unicode positions, paragraphs, repeated and same-name references', () => {
  const value = example()
  assert.deepEqual(fromMentionDocument(toMentionDocument(value)), value)
  const trimmed = trimComposerValue(value)
  assert.equal(trimmed.text, value.text.trim())
  assert.equal(trimmed.mentions[0].start, value.mentions[0].start - 2)
  assert.equal(validMentions(trimmed).length, 3)
})

test('removing an attachment removes only its atoms, repositions the later KB reference and preserves prose', () => {
  const value = removeReferences(example(), ref => ref.attachmentId === 'local')
  assert.equal(value.mentions.length, 2)
  assert.equal(value.text, '  🖼️分析@同名.png和\n再看@同名.png。  ')
  assert.deepEqual(fromMentionDocument(toMentionDocument(value)), value)
  assert.ok(persistMentions(value.mentions).every(ref => !('previewUrl' in ref)))
})

test('stale or overlapping offsets cannot silently convert ordinary prose into a reference', () => {
  const value = example()
  value.mentions[1].end += 1
  value.mentions.push({ ...value.mentions[0] })
  assert.equal(validMentions(value).length, 2)
})

test('Chinese adjacent mentions work without spaces, while emails and old atoms stay literal', () => {
  assert.deepEqual(getFileMentionState('分析这张图片@风景/山', undefined), { query: '风景/山', start: 6, end: 11 })
  assert.equal(getFileMentionState('mail@example.com', undefined), null)
  assert.equal(getFileMentionState('@file\ufffc和', undefined), null)
  assert.deepEqual(getFileMentionState('\ufffc和这首音乐@本机/音乐', undefined), { query: '本机/音乐', start: 6, end: 12 })
})
