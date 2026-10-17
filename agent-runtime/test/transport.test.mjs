import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchWithIdleTimeout } from '../src/transport.mjs';

async function endpoint(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('idle watchdog stops both a stalled connection and a stalled response body', async t => {
  for (const headers of [false, true]) {
    const url = await endpoint(t, (_req, res) => {
      if (headers) { res.writeHead(200); res.write('first chunk'); }
    });
    await assert.rejects(async () => {
      const response = await fetchWithIdleTimeout(fetch, url, {}, undefined, 60);
      await response.text();
    });
  }
});

test('active data refreshes the idle timer instead of imposing a whole-request deadline', async t => {
  const url = await endpoint(t, (_req, res) => {
    let count = 0;
    const timer = setInterval(() => { res.write('x'); if (++count === 6) { clearInterval(timer); res.end(); } }, 20);
    res.on('close', () => clearInterval(timer));
  });
  const response = await fetchWithIdleTimeout(fetch, url, {}, undefined, 100);
  assert.equal(await response.text(), 'xxxxxx');
});

test('explicit cancellation still aborts the provider stream immediately', async t => {
  const url = await endpoint(t, (_req, res) => { res.writeHead(200); res.write('start'); });
  const controller = new AbortController();
  const response = await fetchWithIdleTimeout(fetch, url, {}, controller.signal);
  controller.abort();
  await assert.rejects(response.text());
});
