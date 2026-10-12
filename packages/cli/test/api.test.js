import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request, readiness, prepareModels, storageReadiness } from '../src/api.js';

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

test('model preparation preserves actionable failure phase, code and recovery hint', async (t) => {
  const base = await serve(t, (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ state: 'error', stage: 'models', models: { bge_m3: { state: 'error', phase: 'metadata', error_code: 'MODEL_NETWORK', error_type: 'ConnectionError', message: '下载源无法连接', hint: '检查 Docker 网络或调整下载源' } } }));
  });
  await assert.rejects(prepareModels(base, 'token'), error => {
    assert.match(error.message, /BGE-M3 · 连接下载源/);
    assert.match(error.hint, /MODEL_NETWORK.*ConnectionError/);
    assert.match(error.hint, /Docker.*下载源/);
    assert.equal(error.details.model.error_code, 'MODEL_NETWORK');
    return true;
  });
});

test('storage preflight checks both stores and rejects a misleading empty knowledge list', async (t) => {
  let failed = true;
  const base = await serve(t, (req, res) => {
    assert.equal(req.url, '/api/setup/storage');
    assert.equal(req.method, 'GET');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: !failed, checks: [
      { name: 'qdrant', success: !failed, message: 'Qdrant 返回 HTTP 502。', hint: '检查内部代理绕过设置。', http_status: 502 },
      { name: 'minio', success: true },
    ] }));
  });
  await assert.rejects(storageReadiness(base), error => {
    assert.equal(error.code, 'STORAGE_UNAVAILABLE');
    assert.match(error.message, /Qdrant.*502/);
    assert.match(error.hint, /代理/);
    return true;
  });
  failed = false;
  assert.equal((await storageReadiness(base)).success, true);
});

test('storage failure during preparation stays a storage failure and retains its HTTP status', async (t) => {
  const base = await serve(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ state: 'error', stage: 'storage', error_code: 'STORAGE_UNAVAILABLE', error_type: 'UnexpectedResponse',
      message: 'Qdrant 返回 HTTP 502。', hint: '检查容器网络与代理；配置已保存。', storage: { name: 'qdrant', http_status: 502 }, models: {} }));
  });
  await assert.rejects(prepareModels(base, 'token'), error => {
    assert.equal(error.code, 'STORAGE_UNAVAILABLE');
    assert.equal(error.details.storage.http_status, 502);
    assert.match(error.message, /Qdrant/);
    assert.match(error.hint, /配置已保存/);
    return true;
  });
});
