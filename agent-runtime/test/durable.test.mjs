import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createDurableRuntime } from '../src/durable.mjs';

const model = { id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'test',
  baseUrl: 'http://invalid.test', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const tools = [
  { name: 'search', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'submit_answer', description: 'Answer', parameters: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } },
  { name: 'ask_user', description: 'Ask', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false } },
];
const usage = { input: 30, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 40, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function response(calls, stopReason = 'toolUse', reportedUsage = usage) {
  const stream = createAssistantMessageEventStream();
  const message = { role: 'assistant', content: calls.map(([id, name, args]) => ({ type: 'toolCall', id, name, arguments: args })),
    api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), usage: reportedUsage, stopReason };
  queueMicrotask(() => { stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: stopReason, message }); });
  return stream;
}
async function config(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tessmora-durable-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { runtime: 'durable', run_id: 'test', submission_id: 'initial', storage_path: join(dir, 'run.sqlite'), model, tools, prompt: 'Find evidence' };
}
const result = (text, details = {}) => ({ content: [{ type: 'text', text }], details });

test('Durable commits the search and answer and reopening a settled submission makes no requests', async t => {
  const cfg = await config(t), calls = [], events = [];
  let requests = 0;
  const dependencies = {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, context) => {
      if (++requests === 1) return response([['search-1', 'search', { query: 'facts' }]]);
      assert.ok(context.messages.some(item => item.role === 'toolResult' && item.toolCallId === 'search-1'));
      return response([['answer-1', 'submit_answer', { answer: 'Fact [1]' }]]);
    },
    callHost: async (method, params) => {
      calls.push({ method, params });
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      return result('accepted', params.name === 'submit_answer' ? { terminal: 'completed', answer: params.args.answer } : { evidence_ids: [1] });
    },
  };
  assert.equal((await createDurableRuntime(cfg, dependencies).run()).terminal, 'completed');
  assert.equal(requests, 2);
  assert.equal(calls.filter(item => item.method === 'tool').length, 2);
  assert.equal((await createDurableRuntime(cfg, dependencies).run()).terminal, 'completed');
  assert.equal(requests, 2);
  assert.equal(events.filter(item => item.type === 'model.completed').length, 2);
});

test('a new reply continues the same conversation after ask_user and resets the terminal result', async t => {
  const cfg = await config(t);
  let requests = 0;
  const dependencies = {
    emit: () => {},
    providerStream: (_model, context) => {
      if (++requests === 1) return response([['ask-1', 'ask_user', { question: 'Which date?' }]]);
      assert.ok(context.messages.some(item => item.role === 'toolResult' && item.toolCallId === 'ask-1'));
      assert.ok(context.messages.some(item => item.role === 'user' && item.content === '2026'));
      return response([['answer-2', 'submit_answer', { answer: '2026' }]]);
    },
    callHost: async (method, params) => method === 'model_request' ? { allowed: true } : method === 'model_usage' ? {}
      : result('accepted', params.name === 'ask_user' ? { terminal: 'needs_input', question: params.args.question }
        : { terminal: 'completed', answer: params.args.answer }),
  };
  assert.equal((await createDurableRuntime(cfg, dependencies).run()).terminal, 'needs_input');
  assert.equal((await createDurableRuntime({ ...cfg, submission_id: 'reply-1', prompt: '2026' }, dependencies).run()).terminal, 'completed');
  assert.equal(requests, 2);
});

test('shutdown keeps an in-flight tool pending and resumes its durable intent without repeating the model turn', async t => {
  const cfg = await config(t), turns = [], operations = new Map();
  let requests = 0, attempts = 0, notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const dependencies = {
    emit: () => {},
    providerStream: () => ++requests === 1 ? response([['search-stable', 'search', { query: 'facts' }]])
      : response([['answer-stable', 'submit_answer', { answer: 'Fact [1]' }]]),
    callHost: async (method, params, signal) => {
      if (method === 'model_request') { turns.push(params.turn); return { allowed: true }; }
      if (method === 'model_usage') return {};
      if (params.name === 'submit_answer') return result('accepted', { terminal: 'completed' });
      attempts++;
      if (!operations.has(params.tool_call_id)) operations.set(params.tool_call_id, result('evidence', { evidence_ids: [1] }));
      if (attempts === 1) {
        notifyStarted();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('closed')), { once: true }));
      }
      return operations.get(params.tool_call_id);
    },
  };
  const first = createDurableRuntime(cfg, dependencies), running = first.run();
  await started;
  await first.shutdown();
  await running;
  assert.equal(requests, 1);
  assert.equal((await createDurableRuntime(cfg, dependencies).run()).terminal, 'completed');
  assert.equal(attempts, 2);
  assert.equal(operations.size, 1);
  assert.equal(requests, 2);
  assert.deepEqual(turns, [1, 2]);
});

test('steering is durably deduplicated and only marked applied when it reaches a model request', async t => {
  const cfg = await config(t), events = [];
  let requests = 0, notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = createDurableRuntime(cfg, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, context) => {
      if (++requests === 1) return response([['wait-search', 'search', { query: 'facts' }]]);
      assert.equal(context.messages.filter(item => item.role === 'user' && item.content === 'Only compare 2026').length, 1);
      return response([['steered-answer', 'submit_answer', { answer: '2026' }]]);
    },
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      if (params.name === 'search') { notifyStarted(); await gate; return result('facts'); }
      return result('accepted', { terminal: 'completed' });
    },
  });
  const running = runtime.run();
  await started;
  const input = { request_id: 'steer-once', message: 'Only compare 2026', mode: 'steer' };
  await runtime.input(input);
  await runtime.input(input);
  assert.equal(events.filter(item => item.type === 'input.applied' && item.data.request_id === input.request_id).length, 0);
  release();
  assert.equal((await running).terminal, 'completed');
  assert.equal(events.filter(item => item.type === 'input.applied' && item.data.request_id === input.request_id).length, 1);
});

test('a steer sent immediately after start waits for initial admission instead of being rejected as idle', async t => {
  const cfg = await config(t), events = [];
  let requests = 0;
  const runtime = createDurableRuntime(cfg, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, context) => {
      requests++;
      const steered = context.messages.some(item => item.role === 'user' && item.content === 'Compare only 2026');
      return steered ? response([['early-answer', 'submit_answer', { answer: '2026' }]])
        : response([[`early-search-${requests}`, 'search', { query: 'facts' }]]);
    },
    callHost: async (method, params) => method === 'model_request' ? { allowed: true } : method === 'model_usage' ? {}
      : result('accepted', params.name === 'submit_answer' ? { terminal: 'completed' } : {}),
  });
  const running = runtime.run();
  await runtime.input({ request_id: 'early-steer', message: 'Compare only 2026', mode: 'steer' });
  assert.equal((await running).terminal, 'completed');
  assert.ok(events.some(event => event.type === 'input.applied' && event.data.request_id === 'early-steer'));
  assert.ok(requests <= 2);
});

test('Durable rejects raw schema coercion before the host sees the tool', async t => {
  const cfg = await config(t), called = [];
  let requests = 0;
  const runtime = createDurableRuntime(cfg, {
    emit: () => {},
    providerStream: () => ++requests === 1 ? response([['invalid-search', 'search', { query: null }]])
      : response([['valid-answer', 'submit_answer', { answer: 'No search was executed' }]]),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      called.push(params.name);
      return result('accepted', { terminal: 'completed' });
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.deepEqual(called, ['submit_answer']);
});

test('explicit cancellation stays terminal after reopening and never resumes a provider', async t => {
  const cfg = await config(t);
  let requests = 0, notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const dependencies = {
    emit: () => {},
    providerStream: (_model, _context, options) => {
      requests++;
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), usage, stopReason: 'aborted', errorMessage: 'cancelled' };
      options.signal.addEventListener('abort', () => stream.push({ type: 'error', reason: 'aborted', error: message }), { once: true });
      notifyStarted();
      return stream;
    },
    callHost: async method => method === 'model_request' ? { allowed: true } : {},
  };
  const runtime = createDurableRuntime(cfg, dependencies), running = runtime.run();
  await started;
  await runtime.abort();
  assert.equal((await running).terminal, 'cancelled');
  assert.equal((await createDurableRuntime(cfg, dependencies).run()).terminal, 'cancelled');
  assert.equal(requests, 1);
});

test('Durable retains the existing no-progress stop for repeated schema rejection', async t => {
  const cfg = await config(t);
  let requests = 0;
  const runtime = createDurableRuntime(cfg, {
    emit: () => {},
    providerStream: () => response([[`bad-${++requests}`, 'search', { query: null }]]),
    callHost: async method => method === 'model_request' ? { allowed: true } : {},
  });
  const settled = await runtime.run();
  assert.equal(settled.code, 'repeated_tool_failure');
  assert.equal(requests, 3);
});

test('transient retry reserves distinct host turns and preserves provider-reported cost provenance', async t => {
  const cfg = { ...await config(t), model_turn_offset: 9 }, calls = [], events = [];
  const reportedUsage = { ...usage, cost: { ...usage.cost, total: 0.012, totalFromProvider: true } };
  let requests = 0;
  const runtime = createDurableRuntime(cfg, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, _context, options) => {
      assert.equal(options.maxRetries, 0, 'provider transport must not add retries hidden from host accounting');
      if (++requests > 1) return response([['retry-answer', 'submit_answer', { answer: 'Recovered' }]], 'toolUse', reportedUsage);
      const stream = createAssistantMessageEventStream();
      const failed = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), usage, stopReason: 'error', errorMessage: 'HTTP 503 service temporarily unavailable' };
      queueMicrotask(() => stream.push({ type: 'error', reason: 'error', error: failed }));
      return stream;
    },
    callHost: async (method, params) => {
      calls.push({ method, params });
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      return result('accepted', { terminal: 'completed' });
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(requests, 2);
  assert.deepEqual(calls.filter(call => call.method === 'model_request').map(call => call.params.turn), [10, 11]);
  const receipts = calls.filter(call => call.method === 'model_usage').map(call => call.params);
  assert.deepEqual(receipts.map(receipt => [receipt.turn, receipt.stop_reason]), [[10, 'error'], [11, 'toolUse']]);
  assert.deepEqual(receipts[1].usage, reportedUsage);
  assert.equal(receipts[1].usage.cost.totalFromProvider, true);
  assert.equal(events.findLast(event => event.type === 'model.completed').data.cost_known, false);
});
