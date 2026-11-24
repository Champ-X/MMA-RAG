import assert from 'node:assert/strict'
import { test } from 'node:test'
import { documentCitationLocation, documentCitationUrl } from '../src/lib/documentCitation'
import type { CitationReference } from '../src/types/sse'

const pdf: CitationReference = { id: 1, type: 'doc', file_name: 'Evidence.PDF', content: 'The recovery code is CEDAR-17.', page_number: 2, page_end: 3, kb_id: 'kb-A', file_id: 'file-A' }

test('verified PDF pages preserve their range and open the first physical page without URL credentials', () => {
  const location = documentCitationLocation(pdf)!
  assert.deepEqual(location, { kbId: 'kb-A', fileId: 'file-A', page: 2, endPage: 3 })
  assert.equal(documentCitationUrl(location), '/api/knowledge/kb-A/files/file-A/stream#page=2')
  assert.equal(documentCitationUrl({ ...location, kbId: 'kb/name', fileId: 'a?b#c.pdf' }, 'https://service.test/api/'), 'https://service.test/api/knowledge/kb%2Fname/files/a%3Fb%23c.pdf/stream#page=2')
})

test('legacy metadata and debug fields are used only when physical pages and durable identities exist', () => {
  const legacy = { id: 2, type: 'doc', file_name: 'legacy.pdf', content: 'Evidence' } as CitationReference
  assert.deepEqual(documentCitationLocation({ ...legacy, metadata: { page: 4, page_end: 6, file_id: 'old-file', kb_id: 'old-kb' } }), { page: 4, endPage: 6, fileId: 'old-file', kbId: 'old-kb' })
  assert.deepEqual(documentCitationLocation({ ...legacy, debug_info: { page_number: 7, file_id: 'old-file', kb_id: 'old-kb' } }), { page: 7, endPage: 7, fileId: 'old-file', kbId: 'old-kb' })
  for (const page_number of [undefined, 0, -1, 1.5, NaN]) assert.equal(documentCitationLocation({ ...pdf, page_number }), null)
  assert.equal(documentCitationLocation({ ...pdf, file_id: undefined }), null)
  assert.equal(documentCitationLocation({ ...pdf, kb_id: undefined }), null)
  assert.equal(documentCitationLocation(legacy), null)
})

test('attachment and Pi originals never switch to a knowledge stream, and non-PDF pages are not inferred', () => {
  assert.equal(documentCitationLocation({ ...pdf, source: 'attachment' }), null)
  assert.equal(documentCitationLocation({ ...pdf, pi_run_id: 'owned-run' }), null)
  assert.equal(documentCitationLocation({ ...pdf, file_name: 'notes.md' }), null)
  assert.equal(documentCitationLocation({ ...pdf, type: 'image' }), null)
  assert.equal(documentCitationLocation({ ...pdf, page_end: 1 })!.endPage, 2)
})
