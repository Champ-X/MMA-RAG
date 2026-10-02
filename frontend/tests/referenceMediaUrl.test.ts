import assert from 'node:assert/strict'
import { afterEach, mock, test } from 'node:test'
import { chatApi } from '../src/services/api_client'
import {
  getFreshReferenceMediaUrl,
  getFreshReferenceVideoUrl,
  isReferenceMediaUrlFresh,
  type ReferenceMediaType,
} from '../src/services/reference_media_url'

const now = Date.UTC(2026, 9, 1, 12)
const signedUrl = (path: string, date = '20261001T120000Z', expires = 86400) =>
  `http://media.test/${path}?X-Amz-Date=${date}&X-Amz-Expires=${expires}`
const expiredUrl = signedUrl('historical', '20260929T120000Z')

afterEach(() => mock.restoreAll())

test('freshness accounts for expiration and leaves ordinary URLs loadable', () => {
  mock.method(Date, 'now', () => now)
  assert.equal(isReferenceMediaUrlFresh(expiredUrl), false)
  assert.equal(isReferenceMediaUrlFresh(signedUrl('almost-expired', undefined, 59)), false)
  assert.equal(isReferenceMediaUrlFresh(signedUrl('fresh')), true)
  assert.equal(isReferenceMediaUrlFresh('/assets/ordinary-image.jpg'), true)
  assert.equal(isReferenceMediaUrlFresh(' '), false)
  assert.equal(isReferenceMediaUrlFresh(null), false)
})

test('fresh media URLs are reused without requesting another signature', async () => {
  mock.method(Date, 'now', () => now)
  const image = mock.method(chatApi, 'getReferenceImageUrl', async () => ({ img_url: 'unused' }))
  const audio = mock.method(chatApi, 'getReferenceAudioUrl', async () => ({ audio_url: 'unused' }))
  const video = mock.method(chatApi, 'getReferenceVideoUrl', async () => ({ video_url: 'unused' }))
  for (const type of ['image', 'audio', 'video'] as const) {
    const currentUrl = signedUrl(type)
    assert.equal(await getFreshReferenceMediaUrl({ type, kbId: '', filePath: '', currentUrl }), currentUrl)
  }
  assert.equal(image.mock.callCount() + audio.mock.callCount() + video.mock.callCount(), 0)
})

test('expired image, audio and video URLs use their own resolver and source metadata', async () => {
  mock.method(Date, 'now', () => now)
  const image = mock.method(chatApi, 'getReferenceImageUrl', async () => ({ img_url: signedUrl('resolved-image') }))
  const audio = mock.method(chatApi, 'getReferenceAudioUrl', async () => ({ audio_url: signedUrl('resolved-audio') }))
  const video = mock.method(chatApi, 'getReferenceVideoUrl', async () => ({ video_url: signedUrl('resolved-video') }))
  for (const type of ['image', 'audio', 'video'] as const) {
    assert.equal(await getFreshReferenceMediaUrl({ type, kbId: ' source-kb ', filePath: ' source/object ', currentUrl: expiredUrl }), signedUrl(`resolved-${type}`))
  }
  for (const request of [image, audio, video]) {
    assert.equal(request.mock.callCount(), 1)
    assert.deepEqual(request.mock.calls[0].arguments[0], { kb_id: 'source-kb', file_path: 'source/object' })
  }
})

test('media cache isolates types and forced retry bypasses fresh URLs and cached signatures', async () => {
  mock.method(Date, 'now', () => now)
  const audio = mock.method(chatApi, 'getReferenceAudioUrl', async () => ({ audio_url: signedUrl('cache-audio') }))
  let count = 0
  const video = mock.method(chatApi, 'getReferenceVideoUrl', async () => ({ video_url: signedUrl(`cache-video-${++count}`) }))
  const source = { kbId: 'cache-kb', filePath: 'same/path', currentUrl: expiredUrl }
  assert.equal(await getFreshReferenceMediaUrl({ ...source, type: 'audio' }), signedUrl('cache-audio'))
  assert.equal(await getFreshReferenceVideoUrl(source), signedUrl('cache-video-1'))
  assert.equal(await getFreshReferenceVideoUrl(source), signedUrl('cache-video-1'))
  assert.equal(await getFreshReferenceVideoUrl({ ...source, currentUrl: signedUrl('cache-video-1'), force: true }), signedUrl('cache-video-2'))
  assert.equal(audio.mock.callCount(), 1)
  assert.equal(video.mock.callCount(), 2)
})

test('cached signatures refresh before their remaining TTL falls below one minute', async () => {
  let currentTime = now
  mock.method(Date, 'now', () => currentTime)
  const audio = mock.method(chatApi, 'getReferenceAudioUrl', async () => ({ audio_url: signedUrl(`short-ttl-${currentTime}`, undefined, 120) }))
  const source = { type: 'audio' as ReferenceMediaType, kbId: 'ttl-kb', filePath: 'source/audio' }
  const first = await getFreshReferenceMediaUrl(source)
  assert.equal(await getFreshReferenceMediaUrl(source), first)
  currentTime += 61_000
  assert.notEqual(await getFreshReferenceMediaUrl(source), first)
  assert.equal(audio.mock.callCount(), 2)
})

test('concurrent normalized requests share one resolver even during forced retry', async () => {
  mock.method(Date, 'now', () => now)
  let complete!: (value: { img_url: string }) => void
  const response = new Promise<{ img_url: string }>((resolve) => { complete = resolve })
  const image = mock.method(chatApi, 'getReferenceImageUrl', () => response)
  const first = getFreshReferenceMediaUrl({ type: 'image', kbId: 'dedupe-kb', filePath: 'image/source' })
  const second = getFreshReferenceMediaUrl({ type: 'image', kbId: ' dedupe-kb ', filePath: ' image/source ', force: true })
  assert.equal(image.mock.callCount(), 1)
  complete({ img_url: signedUrl('deduped') })
  assert.deepEqual(await Promise.all([first, second]), [signedUrl('deduped'), signedUrl('deduped')])
})

test('resolver failures do not block a later retry and empty responses are rejected', async () => {
  mock.method(Date, 'now', () => now)
  let attempts = 0
  const image = mock.method(chatApi, 'getReferenceImageUrl', async () => {
    attempts += 1
    if (attempts === 1) throw new Error('temporary network failure')
    if (attempts === 2) return { img_url: ' ' }
    return { img_url: signedUrl('retry-success') }
  })
  const source = { type: 'image' as ReferenceMediaType, kbId: 'retry-kb', filePath: 'image/source' }
  await assert.rejects(getFreshReferenceMediaUrl(source), /temporary network failure/)
  await assert.rejects(getFreshReferenceMediaUrl(source), /地址为空/)
  assert.equal(await getFreshReferenceMediaUrl(source), signedUrl('retry-success'))
  assert.equal(image.mock.callCount(), 3)
})

test('refresh never guesses a missing knowledge base or file path', async () => {
  const image = mock.method(chatApi, 'getReferenceImageUrl', async () => ({ img_url: 'unused' }))
  await assert.rejects(getFreshReferenceMediaUrl({ type: 'image', kbId: '', filePath: 'image/source' }), /缺少知识库或文件路径/)
  await assert.rejects(getFreshReferenceMediaUrl({ type: 'image', kbId: 'known-kb', filePath: ' ' }), /缺少知识库或文件路径/)
  assert.equal(image.mock.callCount(), 0)
})
