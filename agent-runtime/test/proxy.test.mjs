import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { getGlobalDispatcher } from 'undici';
import { installProxyFromEnv } from '../src/proxy.mjs';

async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }));
  return server.address().port;
}

test('no proxy leaves the native fetch dispatcher unchanged', () => {
  const before = getGlobalDispatcher();
  assert.equal(installProxyFromEnv({}), null);
  assert.equal(getGlobalDispatcher(), before);
});

test('invalid proxy diagnostics omit URL credentials', () => {
  assert.throws(() => installProxyFromEnv({ HTTPS_PROXY: 'socks://private-user:private-secret@proxy' }),
    error => error.message === 'Pi HTTP/HTTPS proxy configuration is invalid.');
});

for (const bypass of [false, true]) {
  test(`actual Pi worker model fetch ${bypass ? 'respects NO_PROXY' : 'traverses the configured HTTP proxy'}`, { timeout: 15000 }, async t => {
    const requests = [];
    const providerPort = await listen(t, createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'answer', type: 'function', function: { name: 'submit_answer', arguments: '{"answer":"proxy verified"}' } }] } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    }));
    const tunnels = [];
    const proxy = createServer();
    proxy.on('connect', (request, socket, head) => {
      tunnels.push(request.url);
      const upstream = connect(providerPort, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
      socket.on('error', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
    });
    const proxyPort = await listen(t, proxy);
    const worker = spawn(process.execPath, ['src/worker.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: { PATH: process.env.PATH || '', HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
        HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: bypass ? '127.0.0.1' : '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => { if (worker.exitCode === null) worker.kill(); });
    let stderr = '';
    worker.stderr.on('data', data => { stderr += data; });
    const exited = once(worker, 'exit');
    const frames = [];
    const lines = createInterface({ input: worker.stdout });
    const finished = new Promise((resolve, reject) => {
      lines.on('line', line => {
        const frame = JSON.parse(line); frames.push(frame);
        if (frame.type === 'request') {
          const result = frame.method === 'model_request' ? { allowed: true, max_output_tokens: 1000 }
            : frame.method === 'model_usage' ? {}
              : { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed', answer: frame.params.args.answer } };
          worker.stdin.write(JSON.stringify({ type: 'response', id: frame.id, result }) + '\n');
        }
        if (frame.type === 'settled') resolve(frame.result);
      });
      worker.on('error', reject);
      worker.on('exit', () => { if (!frames.some(frame => frame.type === 'settled')) reject(new Error(`Worker exited: ${stderr}`)); });
    });
    worker.stdin.write(JSON.stringify({ type: 'start', config: {
      run_id: 'proxy-test', api_key: 'synthetic-key', prompt: 'Submit the answer.', answer_plan_enabled: false,
      tools: [{ name: 'submit_answer', description: 'Finish', parameters: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] } }],
      model: { id: 'local-fixture', name: 'local-fixture', api: 'openai-completions', provider: 'deepseek',
        baseUrl: bypass ? `http://127.0.0.1:${providerPort}` : 'http://pi-provider.invalid',
        reasoning: false, input: ['text'], contextWindow: 64000, maxTokens: 1000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } },
    } }) + '\n');
    assert.equal((await finished).terminal, 'completed', stderr);
    assert.equal((await exited)[0], 0, stderr);
    assert.equal(requests.length, 1);
    assert.deepEqual(tunnels, bypass ? [] : ['pi-provider.invalid:80']);
  });
}
