import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryExportManager } from '../app/history-export.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tessmora-history-')); t.after(() => rm(root, { recursive: true, force: true }));
  const handlers = new Map(), events = new EventEmitter();
  const webContents = new EventEmitter(); webContents.send = (name, data) => events.emit(name, data);
  const window = { isDestroyed: () => false, webContents };
  const manager = createHistoryExportManager({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, isAuthorized: event => event.authorized });
  return { root, handlers, window, events, manager, event: { sender: webContents, authorized: true } };
}
test('only the owning authorized window can stream a bounded archive to the chosen path', async t => {
  const f = await fixture(t); const destination = join(f.root, 'history.tessmora-chat');
  let requestId; const gotRequest = new Promise(resolve => f.events.once('desktop:export-history', id => { requestId = id; resolve(); }));
  const completed = f.manager.request(f.window, 'workspace-a', destination); await gotRequest;
  await assert.rejects(f.handlers.get('desktop:history-chunk')({ sender: {}, authorized: true }, { requestId, sequence: 0, bytes: new Uint8Array([1]) }), /来源/);
  const manifest = Buffer.from('{"kind":"tessmora-chat","version":1}'); const length = Buffer.alloc(4); length.writeUInt32BE(manifest.length);
  const bytes = Buffer.concat([Buffer.from('TESSMORA-CHAT\n'), length, manifest]);
  await f.handlers.get('desktop:history-chunk')(f.event, { requestId, sequence: 0, bytes });
  await f.handlers.get('desktop:history-finish')(f.event, { requestId });
  assert.equal(await completed, destination); assert.deepEqual(await readFile(destination), bytes);
  await assert.rejects(f.handlers.get('desktop:history-chunk')(f.event, { requestId, sequence: 1, bytes }), /来源/);
});
test('out-of-order chunks fail the export and remove partial files', async t => {
  const f = await fixture(t); let requestId;
  const got = new Promise(resolve => f.events.once('desktop:export-history', id => { requestId = id; resolve(); }));
  const completed = f.manager.request(f.window, 'workspace-a', join(f.root, 'history.tessmora-chat'));
  const rejected = assert.rejects(completed, /分段无效/); await got;
  await assert.rejects(f.handlers.get('desktop:history-chunk')(f.event, { requestId, sequence: 5, bytes: new Uint8Array([1]) }), /分段无效/);
  await rejected;
  const { readdir } = await import('node:fs/promises'); assert.deepEqual(await readdir(f.root), []);
});
