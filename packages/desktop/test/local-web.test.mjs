import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocalWeb, localWebOrigin } from '../app/local-web.mjs';

const shell = () => new Response('<title>Tessmora — Test</title>', { headers: { 'content-type': 'text/html' } });

test('discovers the branded local service without reading files or forwarding credentials', async () => {
  const visited = [];
  const state = await detectLocalWeb(async (address, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(Object.keys(options.headers), ['Accept']);
    visited.push(address);
    return visited.length === 1 ? shell() : Response.json({ ready: false, setup_required: true });
  });
  assert.equal(state, 'online');
  assert.deepEqual(visited, [localWebOrigin + '/', localWebOrigin + '/api/setup/status']);
});
test('unrelated pages, redirects, oversized pages and incompatible APIs stay out of the desktop window', async () => {
  for (const response of [new Response('<title>Other product</title>', { headers: { 'content-type': 'text/html' } }),
    Response.redirect('https://example.com/'), new Response('<title>Tessmora</title>' + 'a'.repeat(65536), { headers: { 'content-type': 'text/html' } })]) {
    let calls = 0;
    assert.equal(await detectLocalWeb(async () => { calls++; return response; }), 'unrecognized');
    assert.equal(calls, 1);
  }
  assert.equal(await detectLocalWeb(async url => url.endsWith('/') ? shell() : Response.json({ unrelated: true })), 'unrecognized');
});
test('distinguishes authentication from an unavailable service', async () => {
  assert.equal(await detectLocalWeb(async () => new Response(null, { status: 401 })), 'protected');
  assert.equal(await detectLocalWeb(async url => url.endsWith('/') ? shell() : new Response(null, { status: 403 })), 'protected');
  assert.equal(await detectLocalWeb(async () => { throw new Error('offline'); }), 'unavailable');
});
