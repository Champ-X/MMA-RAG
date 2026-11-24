import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, normalizeRemoteUrl } from '../app/workspaces.mjs';
import { CredentialStore } from '../app/credentials.mjs';

async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'tessmora-client-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
test('workspace identities survive restart and reject an endpoint changing owners', async t => {
  const root = await temporary(t); const store = new WorkspaceStore(root);
  const a = await store.add({ mode: 'remote', name: 'Research A', url: 'https://a.example/' });
  const b = await store.add({ mode: 'remote', name: 'Research B', url: 'https://b.example' });
  assert.notEqual(a.id, b.id);
  await store.bindIdentity(a.id, 'server-identity-a');
  assert.equal((await new WorkspaceStore(root).get(a.id)).serverId, 'server-identity-a');
  await assert.rejects(store.bindIdentity(a.id, 'server-identity-b'), { code: 'WORKSPACE_ID_CHANGED' });
  await assert.rejects(store.add({ mode: 'remote', name: 'duplicate', url: 'https://a.example' }), { code: 'WORKSPACE_EXISTS' });
  assert.equal((await store.read()).workspaces.length, 2);
});
test('concurrent additions are serialized and local directories are canonical', async t => {
  const root = await temporary(t); const store = new WorkspaceStore(join(root, 'profile'));
  await mkdir(join(root, '中文 工作区'));
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.add({ mode: 'remote', name: `Space ${i}`, url: `https://s${i}.example` })));
  await store.add({ mode: 'local', name: 'Local', directory: join(root, '中文 工作区') });
  await assert.rejects(store.add({ mode: 'local', name: 'Again', directory: join(root, './中文 工作区') }), { code: 'WORKSPACE_EXISTS' });
  assert.equal((await store.read()).workspaces.length, 9);
});
test('remote addresses disallow cleartext, credentials, base paths and fragments', () => {
  for (const url of ['http://public.example', 'file:///tmp/x', 'https://u:p@example.com', 'https://example.com/path', 'https://example.com/#token', 'https://example.com/?x=1']) assert.throws(() => normalizeRemoteUrl(url));
  assert.equal(normalizeRemoteUrl('http://127.0.0.1:8123/'), 'http://127.0.0.1:8123');
});
test('credentials stay isolated and unavailable system storage cannot write plaintext', async t => {
  const root = await temporary(t);
  const safe = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from([...value].reverse().join('')), decryptStringAsync: async value => ({ result: [...value.toString()].reverse().join('') }) };
  const store = new CredentialStore(root, safe);
  await store.set('workspace-a', 'synthetic-secret');
  assert.ok(!(await readFile(join(root, 'workspace-a.json'), 'utf8')).includes('synthetic-secret'));
  assert.equal(await new CredentialStore(root, safe).get('workspace-a'), 'synthetic-secret');
  assert.equal(await store.get('workspace-b'), null);
  const locked = new CredentialStore(root, { isAsyncEncryptionAvailable: async () => false });
  await assert.rejects(locked.set('workspace-b', 'another-secret'), { code: 'KEYCHAIN_LOCKED' });
  await locked.set('workspace-b', 'another-secret', { persist: false });
  assert.equal(await locked.get('workspace-b'), 'another-secret');
  assert.equal(await new CredentialStore(root, safe).get('workspace-b'), null);
  await store.remove('workspace-a'); assert.equal(await store.get('workspace-a'), null);
});
test('session-only connections and missing saved credentials never request the OS vault', async t => {
  const store = new CredentialStore(await temporary(t), {});
  assert.equal(await store.get('workspace-a'), null);
  await store.set('workspace-a', 'session-access', { persist: false });
  assert.equal(await store.get('workspace-a'), 'session-access');
});
