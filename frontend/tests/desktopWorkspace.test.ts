import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDesktopWorkspace, normalizeWorkspaceResources, workspaceResourceUrl } from '../src/lib/desktopWorkspace'

test('desktop API resource normalization preserves signed third-party media and browser behavior', () => {
  Object.assign(globalThis, { window: { tessmoraDesktop: undefined } })
  assert.equal(isDesktopWorkspace(), false)
  const original = { url: 'https://server.example/api/file/one' }
  assert.equal(normalizeWorkspaceResources(original), original)
  Object.assign(globalThis, { window: { tessmoraDesktop: { workspaceId: 'a', apiOrigin: 'https://server.example', hasWorkspaceCredential: true } } })
  assert.equal(isDesktopWorkspace(), true)
  assert.equal(workspaceResourceUrl('https://server.example/api/file/one?revision=2#page=3'), '/api/file/one?revision=2#page=3')
  assert.equal(workspaceResourceUrl('https://objects.example/bucket/doc?X-Amz-Signature=abc'), 'https://objects.example/bucket/doc?X-Amz-Signature=abc')
  assert.equal(workspaceResourceUrl('https://server.example/unrelated'), 'https://server.example/unrelated')
  assert.deepEqual(normalizeWorkspaceResources({ references: [{ video_url: 'https://server.example/api/media' }] }), { references: [{ video_url: '/api/media' }] })
  assert.deepEqual(original, { url: 'https://server.example/api/file/one' })
})
