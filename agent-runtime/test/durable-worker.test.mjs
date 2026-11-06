import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const response = (res, id, name, args) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const frame of [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ]) res.write(`data: ${JSON.stringify(frame)}\n\n`);
  res.end('data: [DONE]\n\n');
};
const tool = (name, parameter) => ({ name, description: name, parameters: { type: 'object',
  properties: { [parameter]: { type: 'string' } }, required: [parameter], additionalProperties: false } });

async function fixture(t, handleRequest) {
  const directory = await mkdtemp(join(tmpdir(), 'tessmora-durable-worker-'));
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    handleRequest(JSON.parse(Buffer.concat(chunks).toString()), res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { runtime: 'durable', run_id: 'crash-test', submission_id: 'initial', storage_path: join(directory, 'run.sqlite'),
    api_key: 'fixture-only', prompt: 'Research then submit.', tools: [tool('search', 'query'), tool('submit_answer', 'answer')],
    model: { id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'deepseek',
      baseUrl: `http://127.0.0.1:${server.address().port}`, reasoning: false, input: ['text'], contextWindow: 64000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } } };
}

function launch(t, config, handler) {
  const child = spawn(process.execPath, ['src/worker.mjs'], { cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH || '', NO_PROXY: '*' }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit'), frames = [];
  let stderr = '';
  child.stderr.on('data', value => { stderr += value; });
  const lines = createInterface({ input: child.stdout });
  let resolveSettled;
  const settled = new Promise(resolve => { resolveSettled = resolve; });
  lines.on('line', line => {
    const frame = JSON.parse(line); frames.push(frame);
    if (frame.type === 'settled' || frame.type === 'suspended') resolveSettled(frame);
    if (frame.type !== 'request') return;
    const value = handler(frame, child);
    if (value !== undefined) child.stdin.write(JSON.stringify({ type: 'response', id: frame.id, result: value }) + '\n');
  });
  child.stdin.write(JSON.stringify({ type: 'start', config }) + '\n');
  return { child, frames, exited, settled, stderr: () => stderr };
}

test('SIGKILL after a host tool receipt resumes its committed intent without repeating the model request', { timeout: 10000 }, async t => {
  const http = [], turns = [], receipts = new Map();
  const config = await fixture(t, (request, res) => {
    http.push(request);
    if (http.length === 1) response(res, 'stable-search', 'search', { query: 'facts' });
    else response(res, 'stable-answer', 'submit_answer', { answer: 'Fact [1]' });
  });
  const host = frame => {
    if (frame.method === 'model_request') { turns.push(frame.params.turn); return { allowed: true }; }
    if (frame.method === 'model_usage') return {};
    if (!receipts.has(frame.params.tool_call_id)) receipts.set(frame.params.tool_call_id, { content: [{ type: 'text', text: 'saved result' }],
      details: frame.params.name === 'submit_answer' ? { terminal: 'completed' } : { evidence_ids: [1] } });
    return receipts.get(frame.params.tool_call_id);
  };
  let killed = false;
  const first = launch(t, config, (frame, child) => {
    const value = host(frame);
    if (frame.method === 'tool') { killed = true; child.kill('SIGKILL'); return; }
    return value;
  });
  assert.equal((await first.exited)[1], 'SIGKILL');
  assert.ok(killed);
  const second = launch(t, config, host);
  assert.equal((await second.settled).result.terminal, 'completed', second.stderr());
  assert.equal((await second.exited)[0], 0, second.stderr());
  assert.equal(http.length, 2);
  assert.deepEqual(turns, [1, 2]);
  assert.equal(receipts.size, 2);
  assert.equal(second.frames.filter(frame => frame.type === 'request' && frame.method === 'tool' && frame.params.tool_call_id === 'stable-search').length, 1);
});

test('SIGKILL during an HTTP model stream resumes with a new charged attempt and clears partial display', { timeout: 10000 }, async t => {
  let requests = 0, firstChild;
  const config = await fixture(t, (_request, res) => {
    if (++requests === 1) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"index":0,"delta":{"content":"interrupted draft"}}]}\n\n');
      firstChild.kill('SIGKILL');
    } else response(res, 'recovered-answer', 'submit_answer', { answer: 'Recovered' });
  });
  const turns = [];
  const host = frame => frame.method === 'model_request' ? (turns.push(frame.params.turn), { allowed: true })
    : frame.method === 'model_usage' ? {} : { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed' } };
  const first = launch(t, config, host); firstChild = first.child;
  assert.equal((await first.exited)[1], 'SIGKILL');
  const second = launch(t, config, host);
  assert.equal((await second.settled).result.terminal, 'completed', second.stderr());
  assert.equal((await second.exited)[0], 0, second.stderr());
  assert.equal(requests, 2);
  assert.deepEqual(turns, [1, 2]);
  assert.ok(second.frames.some(frame => frame.type === 'event' && frame.event_type === 'answer.reset' && frame.data.reason === 'runtime_resumed'));
});

for (const stop of ['shutdown', 'stdin_end', 'SIGTERM']) {
  test(`${stop} suspends an in-flight host call and keeps it recoverable`, { timeout: 10000 }, async t => {
    let requests = 0;
    const config = await fixture(t, (_request, res) => {
      if (++requests === 1) response(res, 'pending-search', 'search', { query: 'facts' });
      else response(res, 'after-shutdown', 'submit_answer', { answer: 'Recovered' });
    });
    const host = frame => frame.method === 'model_request' ? { allowed: true } : frame.method === 'model_usage' ? {}
      : { content: [{ type: 'text', text: 'saved result' }], details: frame.params.name === 'submit_answer' ? { terminal: 'completed' } : {} };
    const first = launch(t, config, (frame, child) => {
      if (frame.method !== 'tool') return host(frame);
      if (stop === 'stdin_end') child.stdin.end();
      else if (stop === 'SIGTERM') child.kill('SIGTERM');
      else child.stdin.write('{"type":"shutdown"}\n');
    });
    assert.equal((await first.settled).type, 'suspended', first.stderr());
    assert.equal((await first.exited)[0], 0, first.stderr());
    const second = launch(t, config, host);
    assert.equal((await second.settled).result.terminal, 'completed', second.stderr());
    assert.equal((await second.exited)[0], 0, second.stderr());
    assert.equal(requests, 2);
  });
}
