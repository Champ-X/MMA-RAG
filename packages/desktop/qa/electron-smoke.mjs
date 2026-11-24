import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { _electron as electron } from 'playwright';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(desktop, '../..');
const argument = process.argv.indexOf('--out');
const output = argument >= 0 ? resolve(repository, process.argv[argument + 1]) : join(repository, 'ops/desktop-qa', `electron-client-${Date.now()}`);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'tessmora-electron-'));
const assertions = [];
const failures = [];
const tokens = { A: 'synthetic-workspace-A-secret', B: 'synthetic-workspace-B-secret' };
const servers = [];
let leaked = 0, application;
async function listen(callback) {
  const server = createServer(callback); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
const external = await listen((_req, res) => { leaked++; res.end('external'); });
const bytes = Buffer.from('0123456789abcdef');
const addresses = {};
for (const name of ['A', 'B']) addresses[name] = await listen((req, res) => {
  if (req.headers.authorization !== `Bearer ${tokens[name]}`) { res.writeHead(401, { 'content-type': 'application/json' }).end('{"detail":"unauthorized"}'); return; }
  if (req.url.startsWith('/api/test/events')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`id: 1\ndata: ${name}-first\n\n`); setTimeout(() => res.end(`id: 2\ndata: ${name}-final\n\n`), 500); return; }
  if (req.url === '/api/test/media') {
    if (req.headers.range === 'bytes=5-8') res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 5-8/16', 'accept-ranges': 'bytes', 'content-length': 4 }).end(bytes.subarray(5, 9));
    else if (req.headers.range) res.writeHead(416, { 'content-range': 'bytes */16' }).end();
    else res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length }).end(bytes);
    return;
  }
  if (req.url === '/api/test/redirect') { res.writeHead(302, { location: `${external}/leak` }).end(); return; }
  if (req.url === '/api/test/upload') {
    const hash = createHash('sha256'); let size = 0;
    req.on('data', part => { hash.update(part); size += part.length; });
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ size, hash: hash.digest('hex') })));
    return;
  }
  if (req.url === '/api/test/untrusted') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><h1>Untrusted fixture</h1><script>window.fixtureScriptRan=true</script>'); return; }
  const values = {
    '/health': { status: 'ok' },
    '/api/desktop/capabilities': { protocol_version: 1, workspace_id: `synthetic-server-${name.toLowerCase()}`, auth: { required: true }, capabilities: { streaming: true, media_range: true } },
    '/api/setup/status': { managed: false, ready: true, setup_required: false, configured: true, tested: true, prepared: true, capabilities: ['text'], providers: {}, checks: [], progress: { state: 'ready', models: {} } },
    '/api/knowledge/': { knowledge_bases: [] },
    '/api/test/identity': { workspace: name },
  };
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(values[req.url] || { models: [], knowledge_bases: [], runs: [], providers: [], configuration: {}, enabled: false }));
});
async function launch() {
  const app = await electron.launch({ args: [desktop], env: { ...process.env, TESSMORA_DESKTOP_USER_DATA: profile, TESSMORA_FRONTEND_DIR: join(repository, 'frontend/dist') }, timeout: 60000 });
  app.process().stderr.on('data', data => { const line = data.toString(); if (/Error|error/.test(line)) failures.push(line.replaceAll(tokens.A, '[redacted]').replaceAll(tokens.B, '[redacted]').slice(0, 1000)); });
  const launcher = await app.firstWindow(); await launcher.waitForSelector('#workspace-form');
  return { app, launcher };
}
async function add(launcher, name) {
  await launcher.locator('#remote-tab').click();
  await launcher.locator('#name').fill(`Synthetic workspace ${name}`);
  await launcher.locator('#url').fill(addresses[name]);
  await launcher.locator('#token').fill(tokens[name]);
  await launcher.locator('#remember').uncheck();
  const pending = application.waitForEvent('window');
  await launcher.locator('#submit').click();
  const page = await pending;
  await page.waitForURL(/^tessmora:/);
  await page.waitForFunction(() => Boolean(window.tessmoraDesktop));
  await page.waitForFunction(() => document.body.innerText.length > 30);
  return page;
}
try {
  let launched = await launch(); application = launched.app; let launcher = launched.launcher;
  await launcher.screenshot({ path: join(output, 'launcher-zh.png') });
  await launcher.locator('#language').click();
  assert.equal(await launcher.locator('#library-title').innerText(), 'A place for your knowledge');
  await launcher.screenshot({ path: join(output, 'launcher-en.png') });
  await launcher.locator('#language').click();
  const a = await add(launcher, 'A');
  const idA = await a.evaluate(() => window.tessmoraDesktop.workspaceId);
  const isolation = await a.evaluate(() => ({ node: typeof require, launcher: typeof window.tessmoraLauncher, bridgeKeys: Object.keys(window.tessmoraDesktop), auth: sessionStorage.getItem('tessmora.setup-token') }));
  assert.equal(isolation.node, 'undefined'); assert.equal(isolation.launcher, 'undefined'); assert.equal(isolation.auth, null);
  assert.ok(!isolation.bridgeKeys.some(key => /token|secret/i.test(key)));
  assertions.push('real Electron renderer is sandboxed; workspace credentials are absent from renderer bridge and storage');
  const streamed = await a.evaluate(async () => {
    const begin = performance.now(); const response = await fetch('/api/test/events'); const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value); const firstMs = performance.now() - begin;
    let rest = ''; while (true) { const next = await reader.read(); if (next.done) break; rest += new TextDecoder().decode(next.value); }
    return { first, rest, firstMs, totalMs: performance.now() - begin };
  });
  assert.match(streamed.first, /A-first/); assert.ok(!streamed.first.includes('A-final')); assert.match(streamed.rest, /A-final/); assert.ok(streamed.firstMs < streamed.totalMs - 150);
  assertions.push('SSE arrives incrementally in the actual Electron renderer');
  const media = await a.evaluate(async () => {
    const part = await fetch('/api/test/media', { headers: { Range: 'bytes=5-8' } });
    const result = { status: part.status, range: part.headers.get('content-range'), bytes: await part.text() };
    const invalid = await fetch('/api/test/media', { headers: { Range: 'bytes=100-' } }); return { ...result, invalid: invalid.status };
  });
  assert.deepEqual(media, { status: 206, range: 'bytes 5-8/16', bytes: '5678', invalid: 416 });
  assertions.push('Range 206, exact media bytes, Content-Range and 416 survive the Electron protocol');
  const uploaded = await a.evaluate(async () => (await fetch('/api/test/upload', { method: 'POST', body: new Uint8Array(4 * 1024 * 1024).fill(7) })).json());
  assert.deepEqual(uploaded, { size: 4 * 1024 * 1024, hash: createHash('sha256').update(Buffer.alloc(4 * 1024 * 1024, 7)).digest('hex') });
  assertions.push('4 MiB synthetic upload arrives byte-identically through the actual renderer');
  const blocked = await a.evaluate(async () => (await fetch('/api/test/redirect')).status); assert.equal(blocked, 502); assert.equal(leaked, 0);
  assertions.push('cross-origin redirects do not forward workspace credentials');
  await a.evaluate(() => { localStorage.setItem('qa-marker', 'workspace-A'); return new Promise((resolve, reject) => { const request = indexedDB.open('qa-attachments', 1); request.onupgradeneeded = () => request.result.createObjectStore('files'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(new Blob(['A attachment']), 'same-name.pdf'); tx.oncomplete = () => { db.close(); resolve(); }; }; }); });
  await a.evaluate(() => window.tessmoraDesktop.chooseWorkspace());
  const b = await add(launcher, 'B');
  const bState = await b.evaluate(async () => ({ marker: localStorage.getItem('qa-marker'), identity: await (await fetch('/api/test/identity')).json(), databases: await indexedDB.databases() }));
  assert.equal(bState.marker, null); assert.equal(bState.identity.workspace, 'B'); assert.ok(!bState.databases.some(db => db.name === 'qa-attachments'));
  await b.evaluate(() => localStorage.setItem('qa-marker', 'workspace-B'));
  assertions.push('two actual workspace windows isolate credentials, localStorage and IndexedDB attachment history');
  await a.screenshot({ path: join(output, 'workspace-a.png') });
  const invalidCaller = await application.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const workspace = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith('tessmora:'));
    return { sandbox: workspace.webContents.getLastWebPreferences().sandbox, nodeIntegration: workspace.webContents.getLastWebPreferences().nodeIntegration };
  }); assert.equal(invalidCaller.sandbox, true); assert.equal(invalidCaller.nodeIntegration, false);
  const popup = application.waitForEvent('window');
  await a.evaluate(() => window.open('/api/test/untrusted', '_blank'));
  const untrusted = await popup; await untrusted.waitForLoadState();
  const preview = await untrusted.evaluate(() => ({ bridge: typeof window.tessmoraDesktop, node: typeof require, ran: Boolean(window.fixtureScriptRan) }));
  assert.deepEqual(preview, { bridge: 'undefined', node: 'undefined', ran: false }); await untrusted.close();
  assertions.push('API HTML preview has no native bridge and cannot run embedded script');
  await application.close(); application = undefined;
  assert.equal((await fetch(addresses.A + '/health', { headers: { Authorization: `Bearer ${tokens.A}` } })).status, 200);
  assertions.push('quitting the desktop does not stop the remote server');
  launched = await launch(); application = launched.app; launcher = launched.launcher;
  await launcher.locator('.workspace-actions button').filter({ hasText: '更新凭证' }).first().click();
  await launcher.locator('#token').fill(tokens.A); await launcher.locator('#remember').uncheck();
  const pending = application.waitForEvent('window'); await launcher.locator('#submit').click(); const restarted = await pending;
  await restarted.waitForFunction(() => Boolean(window.tessmoraDesktop));
  const persisted = await restarted.evaluate(async () => ({ id: window.tessmoraDesktop.workspaceId, marker: localStorage.getItem('qa-marker'), attachment: await new Promise((resolve, reject) => { const request = indexedDB.open('qa-attachments', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const read = db.transaction('files').objectStore('files').get('same-name.pdf'); read.onsuccess = async () => { resolve(await read.result.text()); db.close(); }; }; }) }));
  assert.deepEqual(persisted, { id: idA, marker: 'workspace-A', attachment: 'A attachment' });
  assertions.push('workspace origin, history and attachment bytes survive complete application restart and reauthentication');
  const manifest = await readFile(join(profile, 'workspaces.json'), 'utf8'); assert.ok(!manifest.includes(tokens.A) && !manifest.includes(tokens.B));
  assertions.push('connection manifest contains no synthetic credentials');
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: true, platform: `${platform()}-${arch()}`, assertions, stream: streamed, media, diagnostics: failures, limitations: ['Synthetic authenticated HTTP servers on loopback; no real-model or packaged-installer acceptance in this client test.'] }, null, 2));
  console.log(JSON.stringify({ passed: true, output, assertions: assertions.length }));
} catch (error) {
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: false, assertions, error: String(error), diagnostics: failures }, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  await application?.close().catch(() => {});
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(profile, { recursive: true, force: true });
}
