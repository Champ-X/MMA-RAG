import assert from 'node:assert/strict'
import test from 'node:test'
import { getFileExtension, getFileMediaKind, getKnowledgeFileCover } from '../src/components/knowledge/knowledgeFileCover'

test('every supported document format receives its own format family artwork', () => {
  const formats = { pdf: 'pdf', doc: 'word-doc', docx: 'word', pptx: 'slides', txt: 'text', md: 'markdown', xlsx: 'spreadsheet', xls: 'spreadsheet-xls', csv: 'csv' }
  for (const [extension, artwork] of Object.entries(formats)) {
    const cover = getKnowledgeFileCover({ name: `文档.${extension.toUpperCase()}`, type: extension })
    assert.equal(cover?.src, `/knowledge/file-covers-v1/${artwork}.webp`)
    assert.equal(cover?.extension, extension.toUpperCase())
  }
})

test('legacy Office formats keep their exact printed extension without changing family', () => {
  assert.equal(getKnowledgeFileCover({ name: 'document.doc', type: 'application/msword' })?.kind, 'word')
  assert.equal(getKnowledgeFileCover({ name: 'document.doc', type: 'application/msword' })?.src, '/knowledge/file-covers-v1/word-doc.webp')
  assert.equal(getKnowledgeFileCover({ name: 'table.xls', type: 'application/vnd.ms-excel' })?.kind, 'spreadsheet')
  assert.equal(getKnowledgeFileCover({ name: 'table.xls', type: 'application/vnd.ms-excel' })?.src, '/knowledge/file-covers-v1/spreadsheet-xls.webp')
})

test('MIME metadata and generic plain-text downloads resolve to recognizable formats', () => {
  assert.equal(getFileExtension({ name: 'lecture', type: ' Application/PDF; charset=binary ' }), 'pdf')
  assert.equal(getKnowledgeFileCover({ name: 'notes.MD', type: 'text/plain' })?.kind, 'markdown')
  assert.equal(getKnowledgeFileCover({ name: '表格.CSV', type: 'application/octet-stream' })?.kind, 'csv')
  assert.equal(getKnowledgeFileCover({ name: 'document', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })?.kind, 'word')
})

test('audio artwork stays attached to its identity across reorders and renames', () => {
  const files = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'opus'].map((type, i) => ({ id: `track-${i}`, name: `乐曲.${type}`, type }))
  const before = new Map(files.map(file => [file.id, getKnowledgeFileCover(file)?.src]))
  for (const file of [...files].reverse()) {
    const cover = getKnowledgeFileCover({ ...file, name: `renamed.${file.type}` })
    assert.equal(cover?.kind, 'audio')
    assert.equal(cover?.src, before.get(file.id))
  }
  assert.equal(new Set(before.values()).size, 4, 'A collection should use all four available audio covers')
  assert.deepEqual(getKnowledgeFileCover({ name: '音乐.mp3', type: 'audio/mpeg' }), getKnowledgeFileCover({ name: '音乐.mp3', type: 'mp3' }))
})

test('explicit real-image and video metadata wins over misleading filenames', () => {
  for (const type of ['jpg', 'image/jpeg', 'mp4', 'video/quicktime']) {
    const file = { name: '用户原文.pdf', type }
    assert.equal(getKnowledgeFileCover(file), undefined)
    assert.notEqual(getFileMediaKind(file), 'document')
  }
})

test('legacy and unknown files have a neutral fallback without inventing parser support', () => {
  for (const type of ['rtf', 'json', 'yaml', 'unknown']) {
    assert.equal(getKnowledgeFileCover({ name: `source.${type}`, type }), undefined)
    assert.equal(getKnowledgeFileCover({ name: `source.${type}`, type: 'text/plain' }), undefined)
  }
  assert.equal(getKnowledgeFileCover({ name: 'source', type: 'application/octet-stream' }), undefined)
  assert.equal(getFileExtension({ name: 'source', type: 'application/octet-stream' }), 'file')
})
