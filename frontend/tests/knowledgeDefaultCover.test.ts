import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getKnowledgeDefaultCover } from '../src/components/knowledge/knowledgeDefaultCover'

test('a music collection with 17 audio files receives audio artwork', () => {
  assert.equal(getKnowledgeDefaultCover({ documents: 0, images: 0, audio: 17, video: 0 }), '/knowledge/covers-v2/audio.webp')
})

test('a document library keeps document artwork regardless of its chunk count', () => {
  assert.equal(getKnowledgeDefaultCover({ documents: 5, images: 0, chunks: 850 }), '/knowledge/covers-v2/documents.webp')
})

test('image and video collections have their own fallback while previews are unavailable', () => {
  assert.equal(getKnowledgeDefaultCover({ images: 3 }), '/knowledge/covers-v2/images.webp')
  assert.equal(getKnowledgeDefaultCover({ video: 2, video_shots: 50 }), '/knowledge/covers-v2/video.webp')
})

test('multiple material types select mixed artwork even when one greatly outnumbers another', () => {
  assert.equal(getKnowledgeDefaultCover({ documents: 100, audio: 1 }), '/knowledge/covers-v2/multimodal.webp')
  assert.equal(getKnowledgeDefaultCover({ images: 1, video: 12 }), '/knowledge/covers-v2/multimodal.webp')
})

test('empty and unavailable statistics use collection artwork', () => {
  assert.equal(getKnowledgeDefaultCover(), '/knowledge/covers-v2/collection.webp')
  assert.equal(getKnowledgeDefaultCover({}), '/knowledge/covers-v2/collection.webp')
  assert.equal(getKnowledgeDefaultCover({ documents: 0, chunks: 0, images: 0, audio: 0, video: 0 }), '/knowledge/covers-v2/collection.webp')
  assert.equal(getKnowledgeDefaultCover({ audio: 0 }), '/knowledge/covers-v2/collection.webp')
})

test('derived chunks and video shots alone do not invent a material modality', () => {
  assert.equal(getKnowledgeDefaultCover({ chunks: 200, video_shots: 8 }), '/knowledge/covers-v2/collection.webp')
})
