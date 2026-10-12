import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request, readiness, prepareModels } from '../src/api.js';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('real HTTP model-test requests use private header; API errors redact draft credentials', async (t) => {
  const base = await serve(t, async (req, res) => {
    assert.equal(req.headers['x-tessmora-setup-token'], 'private-token');
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).credentials.deepseek, 'secret-draft');
    res.writeHead(422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'rejected secret-draft with private-token' }));
  });
  await assert.rejects(request(base, '/api/setup/test', { token: 'private-token', body: { credentials: { deepseek: 'secret-draft' } } }), (error) => {
    assert.equal(error.code, 'API_ERROR');
    assert.ok(!error.message.includes('secret-draft'));
    assert.ok(!error.message.includes('private-token'));
    return true;
  });
});

test('readiness requires health and a compatible setup response', async (t) => {
  const requests = [];
  const base = await serve(t, (req, res) => {
    requests.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? { status: 'healthy' } : { ready: false, configured: false }));
  });
  assert.equal((await readiness(base)).setup.ready, false);
  assert.deepEqual(requests, ['/health', '/api/setup/status']);
});

test('model preparation reports progress and resumes interrupted server task', async (t) => {
  let attempts = 0;
  let polls = 0;
  const base = await serve(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      attempts++;
      res.end(JSON.stringify({ state: 'running', completed: 0, total: 1 }));
    } else {
      polls++;
      res.end(JSON.stringify({ state: attempts === 1 ? 'interrupted' : 'ready', completed: attempts === 1 ? 0 : 1, total: 1 }));
    }
  });
  await assert.rejects(prepareModels(base, 'token', { pollInterval: 1 }), { code: 'MODEL_PREPARE_FAILED' });
  const updates = [];
  const result = await prepareModels(base, 'token', { pollInterval: 1, onProgress: (progress) => updates.push(progress.state) });
  assert.equal(result.state, 'ready');
  assert.equal(polls, 2);
  assert.deepEqual(updates, ['running', 'ready']);
});

test('redirects cannot forward setup token to another origin', async (t) => {
  const base = await serve(t, (req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1:1/' }); res.end(); });
  await assert.rejects(request(base, '/api/setup/config', { token: 'private' }), { code: 'SERVICE_UNREACHABLE' });
});
