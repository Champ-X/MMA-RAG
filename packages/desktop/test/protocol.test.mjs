import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceHandler, workspaceOrigin } from '../app/protocol.mjs';

const id = 'workspace-12345678';
async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(), 'tessmora-proxy-'));
  await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><p>Installed UI</p>');
  await writeFile(join(root, 'private.txt'), 'must-not-leak');
  await symlink(join(root, 'private.txt'), join(root, 'dist', 'linked.txt'));
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, handler: createWorkspaceHandler({ id, baseUrl, token: 'main-process-secret', frontendDir: join(root, 'dist') }) };
}
const request = (path, init) => new Request(`${workspaceOrigin(id)}${path}`, init);
test('API forwarding restricts destinations, replaces caller credentials and streams SSE incrementally', async t => {
  let observed;
  const { handler } = await fixture(t, (req, res) => {
    observed = req.headers;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write('data: first\n\n'); setTimeout(() => res.end('data: final\n\n'), 180);
  });
  const start = performance.now();
  const result = await handler(request('/api/events?after=8', { headers: { Authorization: 'Bearer renderer-secret', cookie: 'leak=never', 'last-event-id': '8' } }));
  const reader = result.body.getReader(); const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), 'data: first\n\n');
  assert.ok(performance.now() - start < 170, 'first event arrives before stream finishes');
  assert.equal(observed.authorization, 'Bearer main-process-secret'); assert.equal(observed['x-tessmora-setup-token'], 'main-process-secret');
  assert.equal(observed.cookie, undefined); assert.equal(observed['last-event-id'], '8');
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: final\n\n');
  assert.equal((await handler(new Request('tessmora://different-workspace/api/x'))).status, 403);
  assert.equal((await handler(request('/api/x', { headers: { origin: 'https://evil.example' } }))).status, 403);
});
test('media range statuses and exact bytes survive forwarding', async t => {
  const media = Buffer.from('0123456789abcdef');
  const { handler } = await fixture(t, (req, res) => {
    if (req.headers.range === 'bytes=5-8') res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 5-8/16', 'accept-ranges': 'bytes', 'content-length': 4 }).end(media.subarray(5, 9));
    else res.writeHead(416, { 'content-range': 'bytes */16' }).end();
  });
  const part = await handler(request('/api/media', { headers: { range: 'bytes=5-8' } }));
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 5-8/16'); assert.equal(await part.text(), '5678');
  const invalid = await handler(request('/api/media', { headers: { range: 'bytes=99-' } }));
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */16');
});
test('streaming upload preserves bytes, type and cancellation closes upstream stream', async t => {
  let disconnected;
  const closed = new Promise(resolve => { disconnected = resolve; });
  const { handler } = await fixture(t, (req, res) => {
    if (req.url === '/api/upload') {
      const hash = createHash('sha256'); let length = 0;
      req.on('data', chunk => { hash.update(chunk); length += chunk.length; });
      req.on('end', () => res.end(JSON.stringify({ length, hash: hash.digest('hex'), type: req.headers['content-type'] })));
    } else { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: open\n\n'); res.on('close', disconnected); }
  });
  const bytes = new Uint8Array(4 * 1024 * 1024).fill(7);
  const source = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 65536) controller.enqueue(bytes.subarray(i, i + 65536)); controller.close(); } });
  const response = await handler(request('/api/upload', { method: 'POST', body: source, duplex: 'half', headers: { 'content-type': 'application/octet-stream' } }));
  assert.deepEqual(await response.json(), { length: bytes.length, hash: createHash('sha256').update(bytes).digest('hex'), type: 'application/octet-stream' });
  const stream = await handler(request('/api/stream')); const reader = stream.body.getReader(); await reader.read(); await reader.cancel();
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream remained open')), 1500))]);
});
test('redirects stay on the configured API origin, and API documents are sandboxed', async t => {
  let host;
  const { handler, baseUrl } = await fixture(t, (req, res) => {
    if (req.url === '/api/redirect') res.writeHead(307, { location: `${host}/api/destination` }).end();
    else if (req.url === '/api/external') res.writeHead(302, { location: 'https://outside.example/file' }).end();
    else res.writeHead(200, { 'content-type': 'text/html' }).end('<script>danger()</script>');
  }); host = baseUrl;
  const local = await handler(request('/api/redirect')); assert.equal(local.status, 307); assert.equal(local.headers.get('location'), `${workspaceOrigin(id)}/api/destination`);
  assert.equal((await handler(request('/api/external'))).status, 502);
  const doc = await handler(request('/api/doc')); assert.match(doc.headers.get('content-security-policy'), /^sandbox;/);
});
test('only installed static resources are served with SPA deep links and traversal protection', async t => {
  const { handler } = await fixture(t, (_req, res) => res.end('unused'));
  assert.match(await (await handler(request('/chat'))).text(), /Installed UI/);
  assert.equal((await handler(request('/assets/missing.js'))).status, 404);
  assert.equal((await handler(request('/linked.txt'))).status, 403);
  assert.equal((await handler(request('/..%2fprivate.txt'))).status, 403);
  assert.equal((await handler(request('/chat', { method: 'POST', body: 'x' }))).status, 405);
});
