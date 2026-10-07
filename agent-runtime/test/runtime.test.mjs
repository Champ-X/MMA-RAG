import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { createRuntime } from '../src/runtime.mjs';

const model = { id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'test',
  baseUrl: 'http://invalid.test', reasoning: false, input: ['text'], contextWindow: 32000,
  maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const usage = { input: 100, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 130,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const tools = [
  { name: 'search', description: 'Search', parameters: Type.Object({ query: Type.String() }) },
  { name: 'submit_answer', description: 'Finish', parameters: Type.Object({ answer: Type.String() }) },
];

function response(content, stopReason = 'toolUse') {
  const stream = createAssistantMessageEventStream();
  const message = { role: 'assistant', content, stopReason, api: model.api, provider: model.provider,
    model: model.id, timestamp: Date.now(), usage };
  queueMicrotask(() => { stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: stopReason, message }); });
  return stream;
}
const toolCall = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });
const config = { run_id: 'test', model,  tools, prompt: '查证后回答' };

test('experimental statement instructions require an explicit per-run setting', async () => {
  for (const enabled of [false, true]) {
    const runtime = createRuntime({ ...config, answer_checks_enabled: enabled }, {
      emit: () => {},
      providerStream: (_model, context) => {
        const system = context.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
        assert.equal(system.includes('content_units'), enabled);
        assert.equal(system.includes('max_characters'), enabled);
        return response([toolCall('finish', 'submit_answer', { answer: '结果' })]);
      },
      callHost: async method => method === 'model_request' ? { allowed: true, max_output_tokens: 1000 }
        : method === 'model_usage' ? {} : { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed' } },
    });
    assert.equal((await runtime.run()).terminal, 'completed');
  }
});

async function checkThinkingProtocol(t, provider) {
  const requests = [], events = [], settlements = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const frame of [
      { choices: [{ index: 0, delta: { reasoning_content: 'private internal reasoning' } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'finish', type: 'function',
        function: { name: 'submit_answer', arguments: '{"answer":"结果"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130,
          completion_tokens_details: { reasoning_tokens: 17 } } },
    ]) response.write(`data: ${JSON.stringify(frame)}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const runtime = createRuntime({ ...config, api_key: 'test-only', thinking_level: 'medium',
    model: { ...model, id: provider === 'deepseek' ? 'deepseek-flash' : 'qwen3.5-plus', provider, reasoning: true,
      baseUrl: `http://127.0.0.1:${server.address().port}`, compat: { thinkingFormat: provider === 'deepseek' ? 'deepseek' : 'qwen',
        supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } } }, {
    emit: (type, data) => events.push({ type, data }),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000 };
      if (method === 'model_usage') { settlements.push(params); return {}; }
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed' } };
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(requests.length, 1);
  if (provider === 'deepseek') assert.deepEqual(requests[0].thinking, { type: 'enabled' });
  else assert.equal(requests[0].enable_thinking, true);
  assert.equal(requests[0].max_tokens, 1000);
  assert.equal(settlements[0].usage.totalTokens, 130);
  assert.equal(settlements[0].usage.reasoning, 17);
  assert.equal(events.find(e => e.type === 'model.started').data.thinking_level, 'medium');
  assert.ok(!JSON.stringify(events).includes('private internal reasoning'));
}

for (const provider of ['deepseek', 'aliyun_bailian']) {
  test(`Pi thinking accounts usage without exposing raw thinking (${provider})`, t => checkThinkingProtocol(t, provider));
}

test('real Pi Agent closes the search → evidence → answer loop without a second generator', async () => {
  const calls = [], events = [];
  let count = 0;
  const runtime = createRuntime(config, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, context) => {
      if (++count === 1) return response([toolCall('s1', 'search', { query: '事实' })]);
      assert.ok(context.messages.some((message) => message.role === 'toolResult'));
      return response([toolCall('a1', 'submit_answer', { answer: '事实[1]。' })]);
    },
    callHost: async (method, params) => {
      calls.push({ method, params });
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000 };
      if (method === 'model_usage') return {};
      return { content: [{ type: 'text', text: '事实[1]' }], details: params.name === 'submit_answer'
        ? { terminal: 'completed', answer: params.args.answer } : { evidence_ids: [1] } };
    },
  });
  const result = await runtime.run();
  assert.equal(result.terminal, 'completed');
  assert.equal(count, 2);
  assert.deepEqual(calls.filter((call) => call.method === 'tool').map((call) => call.params.name), ['search', 'submit_answer']);
  assert.equal(events.filter((event) => event.type === 'model.completed').length, 2);
});

test('host citation rejection goes back to Pi for repair and cannot complete the run', async () => {
  let attempts = 0, requests = 0;
  const runtime = createRuntime(config, {
    emit: () => {},
    providerStream: () => response([toolCall(`a${++requests}`, 'submit_answer', { answer: requests === 1 ? '猜测[99]' : '有据[1]' })]),
    callHost: async (method) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000 };
      if (method === 'model_usage') return {};
      if (++attempts === 1) return { isError: true, content: [{ type: 'text', text: 'unknown_evidence:99' }], details: {} };
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed' } };
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(attempts, 2);
});

test('request admission rejects before any provider call', async () => {
  let called = false;
  const events = [], calls = [];
  const runtime = createRuntime(config, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: () => { called = true; throw new Error('must not call'); },
    callHost: async (method) => {
      calls.push(method);
      return method === 'model_request' ? { allowed: false, message: 'budget_exhausted' } : {};
    },
  });
  const result = await runtime.run();
  assert.equal(called, false);
  assert.equal(result.terminal, 'failed');
  assert.match(result.message, /budget_exhausted/);
  assert.deepEqual(calls, ['model_request']);
  assert.deepEqual(events.map(event => event.type), ['model.rejected']);
  assert.equal(events[0].data.executed, false);
  assert.match(events[0].data.message, /budget_exhausted/);
});

test('a dispatched provider error still settles its reserved request', async () => {
  const events = [], calls = [];
  const runtime = createRuntime(config, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: () => { throw new Error('provider transport failed'); },
    callHost: async (method) => {
      calls.push(method);
      return method === 'model_request' ? { allowed: true, max_output_tokens: 1000 } : {};
    },
  });
  assert.equal((await runtime.run()).terminal, 'failed');
  assert.deepEqual(calls, ['model_request', 'model_usage']);
  assert.deepEqual(events.map(event => event.type), ['model.started', 'model.completed']);
  assert.equal(events[1].data.stop_reason, 'error');
  assert.match(events[1].data.error, /provider transport failed/);
});

test('cancelling while waiting for admission does not invent a provider call', async () => {
  const events = [], calls = [];
  let admissionReady;
  const ready = new Promise(resolve => { admissionReady = resolve; });
  const runtime = createRuntime(config, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: () => { throw new Error('must not call provider'); },
    callHost: (method, _params, signal) => {
      calls.push(method);
      if (method !== 'model_request') return {};
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled before admission')), { once: true });
        admissionReady();
      });
    },
  });
  const running = runtime.run();
  await ready;
  runtime.abort();
  assert.equal((await running).terminal, 'cancelled');
  assert.deepEqual(calls, ['model_request']);
  assert.deepEqual(events.map(event => event.type), ['model.cancelled']);
  assert.equal(events[0].data.executed, false);
});

test('invalid model tool arguments never reach the host', async () => {
  let requests = 0, badExecuted = false;
  const runtime = createRuntime(config, {
    emit: () => {},
    providerStream: () => ++requests === 1 ? response([toolCall('invalid', 'search', {})])
      : response([toolCall('finish', 'submit_answer', { answer: '无法确定' })]),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000 };
      if (method === 'model_usage') return {};
      if (params.name === 'search') badExecuted = true;
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'partial' } };
    },
  });
  assert.equal((await runtime.run()).terminal, 'partial');
  assert.equal(badExecuted, false);
});

test('long research archives tool bodies while preserving the question and tool-result pairing', async () => {
  let requests = 0;
  const events = [];
  const runtime = createRuntime({ ...config, model: { ...model, contextWindow: 8000 } }, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, context) => {
      assert.ok(context.messages.some(message => message.role === 'user' && message.content.some(part => part.text?.includes('查证后回答'))));
      if (++requests <= 8) return response([toolCall(`s${requests}`, 'search', { query: `资料 ${requests}` })]);
      const results = context.messages.filter(message => message.role === 'toolResult');
      assert.equal(results.length, 8);
      assert.ok(results.some(message => message.content.some(part => part.text?.includes('archived_result'))));
      assert.deepEqual(results.map(message => message.toolCallId), Array.from({ length: 8 }, (_, index) => `s${index + 1}`));
      return response([toolCall('final', 'submit_answer', { answer: '证据[1]' })]);
    },
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000 };
      if (method === 'model_usage') return {};
      return { content: [{ type: 'text', text: '原文'.repeat(1500) }], details: params.name === 'submit_answer'
        ? { terminal: 'completed' } : { artifact_id: `artifact-${requests}`, evidence_ids: [requests] } };
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.ok(events.some(event => event.type === 'context.compacted'));
});
