import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCitationIdentityKey as key } from '../src/lib/mediaIdentity'
import type { CitationReference } from '../src/types/sse'

const image: CitationReference = { id: 1, type: 'image', pi_run_id: 'run-a', source_id: 'source-a',
  file_name: 'scene.png', content: 'Observation', file_path: '/api/pi/runs/run-a/sources/source-a/content' }

test('source identity is independent of evidence ID, description, filename and debug provenance', () => {
  assert.equal(key(image), key({ ...image, id: 2, content: 'Index description', file_name: 'other label',
    debug_info: { kb_id: 'knowledge-base', chunk_id: 'chunk-a' } }))
  assert.notEqual(key(image), key({ ...image, source_id: 'source-b' }))
  assert.notEqual(key(image), key({ ...image, pi_run_id: 'run-b' }))
})

test('historical paths and normalized media URLs resolve to the explicit run/source identity', () => {
  for (const old of [
    { ...image, source_id: undefined, debug_info: { kb_id: 'kb-a' } },
    { ...image, source_id: undefined, file_path: undefined, img_url: 'http://localhost:8000/api/pi/runs/run-a/sources/source-a/content?download=1' },
    { ...image, source_id: undefined, file_path: '/api/pi/runs/run-a/sources/source%2Da/content' },
  ]) assert.equal(key(image), key(JSON.parse(JSON.stringify(old))))
  assert.notEqual(key(image), key({ ...image, id: 2, source_id: undefined,
    file_path: '/api/pi/runs/another-run/sources/source-a/content' }))
})

test('same video source and interval coalesce but different intervals keep separate players', () => {
  const shot: CitationReference = { ...image, type: 'video', start_sec: 10, end_sec: 20 }
  assert.equal(key(shot), key({ ...shot, id: 2, start_sec: 10.00001, debug_info: { kb_id: 'kb-a' } }))
  assert.notEqual(key(shot), key({ ...shot, id: 3, start_sec: 20, end_sec: 30 }))
  assert.notEqual(key(shot), key({ ...shot, start_sec: undefined, end_sec: undefined }))
  assert.equal(key({ ...image, type: 'audio' }), key({ ...image, id: 5, type: 'audio', debug_info: { kb_id: 'kb-a' } }))
})

test('legacy KB paths and local attachment identities stay scoped; names alone never merge files', () => {
  const legacy = { ...image, pi_run_id: undefined, source_id: undefined, file_path: 'images/scene.png', debug_info: { kb_id: 'kb-a' } }
  assert.equal(key(legacy), key({ ...legacy, id: 2, file_path: 'images\\scene.png' }))
  assert.notEqual(key(legacy), key({ ...legacy, id: 2, debug_info: { kb_id: 'kb-b' } }))
  assert.notEqual(key(legacy), key({ ...legacy, id: 2, file_path: 'images/another.png' }))
  const attachment: CitationReference = { ...legacy, source: 'attachment', attachment_id: 'upload-a' }
  assert.equal(key(attachment), key({ ...attachment, id: 2 }))
  assert.notEqual(key(attachment), key({ ...attachment, attachment_id: 'upload-b' }))
  const unnamed = { ...legacy, file_path: undefined }
  assert.notEqual(key(unnamed), key({ ...unnamed, id: 2 }))
})

test('legacy signed URL refreshes do not duplicate an already identified asset', () => {
  const legacy = { ...image, pi_run_id: undefined, source_id: undefined, file_path: undefined,
    img_url: 'https://storage.test/kb-a/image.png?X-Amz-Signature=old' }
  assert.equal(key(legacy), key({ ...legacy, id: 2, img_url: 'https://storage.test/kb-a/image.png?X-Amz-Signature=new' }))
  assert.notEqual(key(legacy), key({ ...legacy, id: 2, img_url: 'https://storage.test/kb-b/image.png?X-Amz-Signature=new' }))
})
