import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFileMentionGroups } from '../src/components/chat/fileMentionGroups'

const spaces = Array.from({ length: 9 }, (_, index) => ({ id: `kb-${index}`, name: index === 8 ? '最后的素材空间' : `Space ${index}` }))
const filesByKb = Object.fromEntries(spaces.map(kb => [kb.id, Array.from({ length: 35 }, (_, index) => ({
  id: `file-${index}`, name: `图像-${index}.jpg`, type: 'jpg', size: 1024, date: '2026-10-04',
}))]))

test('@ exposes every eligible file across all spaces, including the last file of the last group', () => {
  const groups = buildFileMentionGroups(spaces, filesByKb, new Set(), '')
  assert.equal(groups.length, 9)
  assert.equal(groups.flatMap(group => group.files).length, 315)
  assert.equal(groups.at(-1)?.files.at(-1)?.id, 'file-34')
  assert.ok(groups.every(group => group.totalMatches === 35 && group.files.length === 35))
})

test('search does not truncate common matches and supports space names, filenames, and types', () => {
  assert.equal(buildFileMentionGroups(spaces, filesByKb, new Set(), 'JPG').flatMap(group => group.files).length, 315)
  const groups = buildFileMentionGroups(spaces, filesByKb, new Set(), '最后的素材空间')
  assert.equal(groups.at(-1)?.files.length, 35)
  assert.equal(groups.slice(0, -1).flatMap(group => group.files).length, 0)
  assert.equal(buildFileMentionGroups(spaces, filesByKb, new Set(), '图像-34.jpg').flatMap(group => group.files).length, 9)
})

test('selected files are excluded only from their own space, with accurate remaining counts', () => {
  const groups = buildFileMentionGroups(spaces, filesByKb, new Set(['kb-8::file-34']), '')
  assert.equal(groups.at(-1)?.totalMatches, 34)
  assert.equal(groups.at(-1)?.files.some(file => file.id === 'file-34'), false)
  assert.equal(groups[0].files.some(file => file.id === 'file-34'), true)
  assert.equal(filesByKb['kb-8'].length, 35)
})

test('unloaded spaces and empty searches remain safe without inventing candidate files', () => {
  const groups = buildFileMentionGroups(spaces, {}, new Set(), '')
  assert.equal(groups.length, spaces.length)
  assert.ok(groups.every(group => group.files.length === 0 && group.totalMatches === 0))
  assert.ok(buildFileMentionGroups(spaces, filesByKb, new Set(), '没有这个文件').every(group => group.totalMatches === 0))
})

const musicSpaces = [{ id: 'music', name: 'music' }, { id: 'music-live', name: 'Music Live' }, { id: 'paper', name: 'Harness Paper' }]
const media = {
  music: [
    { id: 'sun', name: '阳春白雪.mp3', type: 'mp3', size: 1, date: '2026-10-04' },
    { id: 'red', name: 'Red Right Hand.mp3', type: 'audio/mpeg', size: 1, date: '2026-10-04' },
  ],
  'music-live': [{ id: 'sun', name: '阳春白雪现场.mp3', type: 'mp3', size: 1, date: '2026-10-04' }],
  paper: [{ id: 'paper', name: 'Agent Harness.pdf', type: 'pdf', size: 1, date: '2026-10-04' }],
}

test('a knowledge-base path lists all files in the exact space without leaking similarly named spaces', () => {
  const groups = buildFileMentionGroups(musicSpaces, media, new Set(), 'MUSIC/')
  assert.deepEqual(groups.map(group => group.kbId), ['music'])
  assert.equal(groups[0].files.length, 2)
  assert.deepEqual(buildFileMentionGroups(musicSpaces, media, new Set(), '不存在/'), [])
})

test('partial knowledge-base prefixes and scoped filename/type filters work together', () => {
  const groups = buildFileMentionGroups(musicSpaces, media, new Set(), 'mus/阳春')
  assert.deepEqual(groups.map(group => group.kbId), ['music', 'music-live'])
  assert.deepEqual(groups.map(group => group.files.length), [1, 1])
  assert.equal(buildFileMentionGroups(musicSpaces, media, new Set(), 'music/mp3')[0].files.length, 2)
  assert.equal(buildFileMentionGroups(musicSpaces, media, new Set(['music::sun']), 'music/阳春')[0].files.length, 0)
})

test('spaces in both knowledge-base and file names remain searchable', () => {
  assert.equal(buildFileMentionGroups(musicSpaces, media, new Set(), 'Harness Paper/Agent Harness')[0].files[0].id, 'paper')
  assert.equal(buildFileMentionGroups(musicSpaces, media, new Set(), 'music/Red Right')[0].files[0].id, 'red')
})

test('mention parsing keeps full names and correct replacement boundaries without matching emails or crossing lines', async () => {
  const { getFileMentionState } = await import('../src/components/chat/fileMentionGroups')
  const text = '请参考 @Harness Paper/Agent Harness 后面的内容'
  const caret = text.indexOf(' 后面的内容')
  assert.deepEqual(getFileMentionState(text, caret), { query: 'Harness Paper/Agent Harness', start: 4, end: caret })
  assert.deepEqual(getFileMentionState('@music/', 7), { query: 'music/', start: 0, end: 7 })
  assert.equal(getFileMentionState('name@example.com', undefined), null)
  assert.equal(getFileMentionState('@music/\n另起一行', undefined), null)
  assert.equal(getFileMentionState('@music/\n', undefined), null)
  assert.deepEqual(getFileMentionState('@music/\n@mus/阳春', undefined), { query: 'mus/阳春', start: 8, end: 15 })
})
