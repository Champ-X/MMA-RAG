import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Type } from 'typebox';
import { createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai';
import { createRuntime, SYSTEM_PROMPT } from '../src/runtime.mjs';

const model = { id: 'unseen-model', name: 'Unseen model', provider: 'test', api: 'openai-completions',
  baseUrl: 'http://invalid.test', input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 128000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' } };
const tools = [
  { name: 'search', description: 'Search', parameters: Type.Object({ query: Type.String() }) },
  { name: 'submit_answer', description: 'Submit', parameters: Type.Object({ answer: Type.String() }) },
];
const call = (n, name, args) => ({ type: 'toolCall', id: `call-${n}`, name, arguments: args });
function response(content, stopReason = 'toolUse') {
  const stream = createAssistantMessageEventStream();
  const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content, stopReason, timestamp: Date.now(), usage: { input: 9500, output: 500, totalTokens: 10000,
      cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  queueMicrotask(() => { stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: stopReason, message }); });
  return stream;
}

test('research exceeds old model, tool, search and token allowances without closing', async () => {
  let turns = 0, searches = 0, accounted = 0;
  const runtime = createRuntime({ run_id: 'long-run', model, tools, prompt: 'Complete a complex research task' }, {
    emit: () => {},
    providerStream: (_model, context, options) => {
      turns++;
      assert.equal(options.maxTokens, 128000);
      assert.equal(options.timeoutMs, undefined);
      assert.ok(getCurrentTools(context.messages).some(tool => tool.name === 'search'));
      return response([turns <= 65 ? call(turns, 'search', { query: `step ${turns}` })
        : call(turns, 'submit_answer', { answer: 'Completed all steps' })]);
    },
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') { accounted += params.usage.totalTokens; return {}; }
      if (params.name === 'search') { searches++; return { content: [{ type: 'text', text: `Result ${searches}` }], details: {} }; }
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed', answer: params.args.answer } };
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(turns, 66); assert.equal(searches, 65); assert.equal(accounted, 660000);
});

test('plain assistant responses can recover after more than two protocol reminders', async () => {
  let turns = 0;
  const runtime = createRuntime({ run_id: 'reminders', model, tools, prompt: 'Complete the task' }, {
    emit: () => {},
    providerStream: () => ++turns <= 5 ? response([{ type: 'text', text: 'Working' }], 'stop')
      : response([call(turns, 'submit_answer', { answer: 'Done' })]),
    callHost: async method => method === 'model_request' ? { allowed: true }
      : method === 'model_usage' ? {} : { content: [{ type: 'text', text: 'ok' }], details: { terminal: 'completed' } },
  });
  assert.equal((await runtime.run()).terminal, 'completed'); assert.equal(turns, 6);
});

for (const maximum of [128000, 0]) test(`HTTP uses provider output capacity or its default (${maximum})`, async t => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = []; for await (const block of request) body.push(block);
    requests.push(JSON.parse(Buffer.concat(body).toString()));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0,
      id: 'submit', type: 'function', function: { name: 'submit_answer', arguments: '{"answer":"done"}' } }] } }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const runtime = createRuntime({ run_id: 'output-capacity', api_key: 'test-only',
    model: { ...model, maxTokens: maximum, baseUrl: `http://127.0.0.1:${server.address().port}` }, tools, prompt: 'Answer' }, {
    emit: () => {}, callHost: async method => method === 'model_request' ? { allowed: true }
      : method === 'model_usage' ? {} : { content: [{ type: 'text', text: 'ok' }], details: { terminal: 'completed' } },
  });
  t.after(() => runtime.abort());
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(requests[0].max_tokens, maximum || undefined);
});

test('explicit stop aborts an in-flight HTTP call with no run deadline', async t => {
  let received;
  const ready = new Promise(resolve => { received = resolve; });
  const server = createServer((_req, _res) => received());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const runtime = createRuntime({ run_id: 'stop', api_key: 'test-only',
    model: { ...model, baseUrl: `http://127.0.0.1:${server.address().port}` }, tools, prompt: 'Answer' }, {
    emit: () => {}, callHost: async method => method === 'model_request' ? { allowed: true } : {},
  });
  t.after(() => runtime.abort());
  const pending = runtime.run(); await ready; runtime.abort();
  assert.equal((await pending).terminal, 'cancelled');
});

test('relevance guidance is generic and preserves requested comparisons and conflicts', () => {
  assert.match(SYSTEM_PROMPT, /默认不在正文逐项介绍未匹配、未选用的候选或附其引用/);
  assert.match(SYSTEM_PROMPT, /用户要求比较\/排除说明/);
  assert.match(SYSTEM_PROMPT, /不能以精简为由隐瞒关键冲突或限制/);
  assert.doesNotMatch(SYSTEM_PROMPT, /浴血|Red Right Hand|peaky|汤米/);
});

test('oversized selected evidence is archived at the actual context window and can be restored by span', async () => {
  const original = 'source detail '.repeat(24000) + 'TAIL CONDITION';
  const item = { id: 7, source_id: 'report', file_name: 'report.txt', modality: 'doc', content: original,
    retained_range: { start: 0, end: original.length, original_characters: original.length, truncated: false } };
  const plan = { items: [{ id: 'result', requirement: 'Find the condition', status: 'ready', evidence_ids: [7] }] };
  const snapshots = [{ answer_plan: plan, retained_evidence: [item] }, { answer_plan: plan,
    retained_evidence: [{ ...item, content: 'TAIL CONDITION', retained_range: { start: original.length - 14,
      end: original.length, original_characters: original.length, truncated: true } }] }];
  let turns = 0, updates = 0;
  const events = [];
  const runtime = createRuntime({ run_id: 'large-working-set', model: { ...model, contextWindow: 32000, maxTokens: 4000 },
    answer_plan_enabled: true, prompt: 'Find the condition', tools: [...tools,
      { name: 'update_answer_plan', description: 'Plan', parameters: Type.Object({}) },
      { name: 'recall_evidence', description: 'Recall', parameters: Type.Object({ evidence_ids: Type.Array(Type.Number()) }) }] }, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, context) => {
      turns++;
      assert.ok(JSON.stringify(context).length < 32000 * 4, 'Persistent memory must not bypass context archival');
      if (turns === 1) assert.ok(!context.messages.some(message => message.role === 'user' && typeof message.content === 'string' && message.content.startsWith('研究计划已就绪。')));
      if (turns === 2) {
        assert.ok(context.messages.some(message => message.role === 'user' && typeof message.content === 'string' && message.content.startsWith('研究计划已就绪。')));
        const data = context.messages.findLast(message => message.role === 'user' && message.content.includes('"retained_evidence"')).content;
        assert.match(data, /"context_archived_evidence_ids":\[7\]/);
        assert.ok(getCurrentTools(context.messages).some(tool => tool.name === 'recall_evidence'));
      }
      if (turns === 3) assert.match(context.messages.findLast(message => message.role === 'user' && message.content.includes('"retained_evidence"')).content, /TAIL CONDITION/);
      return response([turns < 3 ? call(turns, 'update_answer_plan', {}) : call(turns, 'submit_answer', { answer: 'Condition[7]' })]);
    },
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      if (params.name === 'update_answer_plan') return { content: [{ type: 'text', text: JSON.stringify(snapshots[updates++]) }],
        details: { artifact_id: `plan-${updates}` } };
      return { content: [{ type: 'text', text: 'ok' }], details: { terminal: 'completed' } };
    },
  });
  const result = await runtime.run();
  assert.equal(result.terminal, 'completed', result.message);
  assert.equal(snapshots[0].retained_evidence[0].content, original, 'Archival must preserve durable original evidence');
  assert.ok(events.some(event => event.data.archived_retained_evidence_ids?.includes(7)));
});
