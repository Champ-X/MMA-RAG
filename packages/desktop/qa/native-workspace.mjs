// Exercise the installed native binaries; all data belongs to this disposable run.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startLocalWorkspace } from '../runtime/manager.mjs';

const runtimeDir = resolve(process.argv[2]);
const root = await mkdtemp(join(process.argv[3] || tmpdir(), 'native-'));
const workspaceDir = join(root, '资料 workspace');
await mkdir(workspaceDir);
const open = () => startLocalWorkspace({ workspaceDir, runtimeDir, onProgress: ({ phase, message }) => console.log(phase, message) });
const bad = join(root, 'occupied');
await mkdir(bad);
await writeFile(join(bad, 'existing.txt'), 'preserve');
await assert.rejects(startLocalWorkspace({ workspaceDir: bad, runtimeDir }), /已有/);
assert.equal(await readFile(join(bad, 'existing.txt'), 'utf8'), 'preserve');
const t0 = performance.now();
const first = await open();
try {
  assert.equal((await fetch(first.url + '/api/knowledge/')).status, 401);
  const headers = { authorization: 'Bearer ' + first.token };
  const info = await (await fetch(first.url + '/api/desktop/capabilities', { headers })).json();
  assert.equal(info.workspace_id, first.workspaceId);
  const storage = await (await fetch(first.url + '/api/setup/storage', { headers })).json();
  assert(storage.success && storage.checks.some(c => c.backend === 'filesystem'));
  assert((await (await fetch(first.url + '/api/setup/status', { headers })).json()).setup_required);
  await assert.rejects(open(), /其他进程/);
  console.log('authentication, storage and lock passed', Math.round(performance.now() - t0), 'ms');
} finally { await first.stop(); }
await assert.rejects(fetch(first.url + '/health'));
const second = await open();
try {
  assert.equal(first.workspaceId, second.workspaceId);
  assert.notEqual(first.token, second.token);
  assert.equal((await fetch(second.url + '/health', { headers: { authorization: 'Bearer ' + first.token } })).status, 401);
} finally { await second.stop(); }
console.log('restart, credential rotation and shutdown passed', root);
