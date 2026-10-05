import test from 'node:test';
import assert from 'node:assert/strict';
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
const config = { run_id: 'test', model, budget: { output_tokens: 1000, wall_seconds: 30 }, tools, prompt: '查证后回答' };

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
  const runtime = createRuntime(config, {
    emit: () => {}, providerStream: () => { called = true; throw new Error('must not call'); },
    callHost: async (method) => method === 'model_request' ? { allowed: false, message: 'budget_exhausted' } : {},
  });
  const result = await runtime.run();
  assert.equal(called, false);
  assert.equal(result.terminal, 'failed');
  assert.match(result.message, /budget_exhausted/);
});

test('host closing admission limits paid generation to a final answer with existing evidence', async () => {
  let requests = 0;
  const runtime = createRuntime(config, {
    emit: () => {},
    providerStream: (_model, context) => {
      if (++requests === 1) return response([toolCall('s', 'search', { query: '事实' })]);
      assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), ['submit_answer']);
      assert.ok(context.messages.some(message => message.role === 'toolResult'));
      assert.match(context.messages.at(-1).content, /收尾阶段/);
      return response([toolCall('a', 'submit_answer', { answer: '已查到的事实[1]' })]);
    },
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000, final_turn: requests === 1 };
      if (method === 'model_usage') return {};
      return { content: [{ type: 'text', text: '事实[1]' }], details: params.name === 'submit_answer'
        ? { terminal: 'completed', answer: params.args.answer } : { evidence_ids: [1] } };
    },
  });
  const result = await runtime.run();
  assert.equal(result.terminal, 'completed', result.message);
  assert.equal(requests, 2);
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
  const runtime = createRuntime({ ...config, model: { ...model, contextWindow: 12000 } }, {
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
