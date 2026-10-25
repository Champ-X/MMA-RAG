import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai';
import { createRuntime } from '../src/runtime.mjs';

const model = { id: 'fixture', name: 'fixture', provider: 'test', api: 'openai-completions',
  baseUrl: 'http://invalid.test', input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 4000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const tools = [
  { name: 'inspect_media', description: 'Inspect', parameters: Type.Object({ source_id: Type.String() }) },
  { name: 'update_answer_plan', description: 'Plan', parameters: Type.Object({ items: Type.Array(Type.Any()) }) },
  { name: 'submit_answer', description: 'Submit', parameters: Type.Object({ answer: Type.String() }) },
];
const call = (n, name, args) => ({ type: 'toolCall', id: `call-${n}`, name, arguments: args });
function response(content, emitDelta = false) {
  const stream = createAssistantMessageEventStream();
  const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content, stopReason: 'toolUse', timestamp: Date.now(), usage: { input: 1, output: 1, totalTokens: 2,
      cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message });
    if (emitDelta) {
      stream.push({ type: 'toolcall_delta', contentIndex: 0, delta: '{', partial: message });
      stream.push({ type: 'toolcall_delta', contentIndex: 0, delta: '}', partial: message });
    }
    stream.push({ type: 'done', reason: 'toolUse', message });
  });
  return stream;
}
const finish = { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed' } };
const planItem = (state = {}) => ({ id: 'choice', requirement: 'Choose one', quote: 'Choose one', status: 'pending', research_state: state });

for (const checked of [false, true]) test(`evidence IDs and provider usage do not manufacture progress (${checked})`, async () => {
  let turns = 0, inspections = 0;
  const runtime = createRuntime({ run_id: 'stable-evidence', model, tools, prompt: 'Choose one' }, {
    emit: () => {}, providerStream: () => response([++turns <= 7
      ? call(turns, 'inspect_media', { source_id: 'same' }) : call(turns, 'submit_answer', { answer: 'Done' })]),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      if (params.name === 'submit_answer') return finish;
      const id = ++inspections;
      return { content: [{ type: 'text', text: JSON.stringify({ evidence: [{ id, source_id: 'same',
        version: `generated-${id}`, observation: 'media_observation', locator: { start_sec: 0, end_sec: 30 },
        provenance: { source_version: 'original-v1', usage: { total_tokens: id }, calls: [{ usage: { total_tokens: id } }] },
        ...(checked ? { content_units: [{ id: `e${id}s1`, start: 0, end: 4, text: 'Same' }] } : { content: 'Same' }),
        citation: { type: 'audio', id } }] }) }], details: { artifact_id: `artifact-${id}`, evidence_ids: [id] } };
    },
  });
  assert.equal((await runtime.run()).code, 'repeated_tool_result');
  assert.equal(inspections, 4);
});

for (const changing of ['content', 'source_version', 'interval']) test(`actual ${changing} changes remain progress`, async () => {
  let turns = 0;
  const runtime = createRuntime({ run_id: 'new-evidence', model, tools, prompt: 'Compare all necessary evidence' }, {
    emit: () => {}, providerStream: () => response([++turns <= 7
      ? call(turns, 'inspect_media', { source_id: 'same' }) : call(turns, 'submit_answer', { answer: 'Done' })]),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      if (params.name === 'submit_answer') return finish;
      return { content: [{ type: 'text', text: JSON.stringify({ evidence: [{ id: turns, source_id: 'same',
        content: changing === 'content' ? `New condition ${turns}` : 'Same',
        provenance: { source_version: changing === 'source_version' ? `v${turns}` : 'v1' },
        locator: { start_sec: changing === 'interval' ? turns * 30 : 0 } }] }) }], details: {} };
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(turns, 8);
});

test('unchanged research plans receive a soft review without extra requests or disabled tools', async () => {
  let turns = 0;
  const events = [], contexts = [];
  const runtime = createRuntime({ run_id: 'review', model, tools, prompt: 'Choose one', answer_plan_enabled: true }, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, context) => {
      contexts.push(JSON.stringify(context));
      assert.ok(getCurrentTools(context.messages).some(tool => tool.name === 'inspect_media'));
      const n = ++turns;
      return response([n === 1 ? call(n, 'update_answer_plan', { items: [planItem()] })
        : n <= 7 ? call(n, 'inspect_media', { source_id: `candidate-${n}` })
          : call(n, 'submit_answer', { answer: 'Done' })]);
    },
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      if (params.name === 'submit_answer') return finish;
      const body = params.name === 'update_answer_plan' ? { answer_plan: { items: params.args.items }, retained_evidence: [] }
        : { evidence: [{ id: turns, source_id: params.args.source_id, content: 'A new candidate' }] };
      return { content: [{ type: 'text', text: JSON.stringify(body) }], details: { artifact_id: `a${turns}` } };
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(turns, 8);
  assert.equal(events.filter(event => event.type === 'research.review').length, 2);
  assert.ok(contexts[4].includes('研究状态复核'));
  assert.ok(!contexts[3].includes('研究状态复核'));
  assert.deepEqual(events.find(event => event.type === 'research.review').data.pending_item_ids, ['choice']);
});

test('plan updates reset stale-plan feedback and current originals replace duplicated plan bodies', async () => {
  let turns = 0;
  const events = [];
  const original = 'VERBATIM_EVIDENCE '.repeat(1500) + 'IMPORTANT COUNTEREVIDENCE';
  const retained = { id: 1, source_id: 'candidate', file_name: 'original.txt', modality: 'doc',
    observation: 'parsed_text', content: original, version: 'v1', locator: { page: 1 },
    retained_range: { start: 0, end: original.length, original_characters: original.length, truncated: false } };
  const runtime = createRuntime({ run_id: 'working-set', model, tools, prompt: 'Choose one', answer_plan_enabled: true }, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: (_model, context) => {
      const n = ++turns;
      if (n === 1 || n === 4) return response([call(n, 'update_answer_plan', { items: [planItem(n === 4
        ? { verified_conditions: ['A condition verified'], open_questions: ['Check counterevidence'] } : {})] })]);
      if (n <= 6) return response([call(n, 'inspect_media', { source_id: `candidate-${n}` })]);
      const planResults = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'update_answer_plan');
      assert.equal(planResults.length, 2, 'tool-result pairing is retained');
      assert.ok(planResults.every(message => JSON.stringify(message).includes('current_plan_in_working_memory')));
      assert.ok(planResults.every(message => !JSON.stringify(message).includes('IMPORTANT COUNTEREVIDENCE')));
      assert.ok(context.messages.some(message => message.role === 'user' && JSON.stringify(message).includes(original)));
      assert.ok(getCurrentTools(context.messages).some(tool => tool.name === 'inspect_media'));
      return response([call(n, 'submit_answer', { answer: 'Done' })]);
    },
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      if (params.name === 'submit_answer') return finish;
      const body = params.name === 'update_answer_plan'
        ? { answer_plan: { items: params.args.items }, retained_evidence: [retained] }
        : { evidence: [{ id: turns, source_id: params.args.source_id, content: 'New condition' }] };
      return { content: [{ type: 'text', text: JSON.stringify(body) }], details: { artifact_id: `a${turns}` } };
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(events.filter(event => event.type === 'research.review').length, 0);
  assert.ok(events.some(event => event.type === 'context.compacted' && event.data.reason === 'working_memory_deduplication'));
});

test('model telemetry records input size and first content timing without serializing its text', async () => {
  const events = [], admissions = [];
  const runtime = createRuntime({ run_id: 'timing', model, tools, prompt: 'Choose one' }, {
    emit: (type, data) => events.push({ type, data }),
    providerStream: () => response([call(1, 'submit_answer', { answer: 'private answer' })], true),
    callHost: async (method, params) => {
      if (method === 'model_request') { admissions.push(params); return { allowed: true }; }
      if (method === 'model_usage') return {};
      return finish;
    },
  });
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(events.find(event => event.type === 'model.started').data.input_bytes, admissions[0].input_bytes);
  const first = events.filter(event => event.type === 'model.first_content');
  assert.equal(first.length, 1);
  assert.equal(first[0].data.content_type, 'tool_call');
  assert.ok(first[0].data.duration_ms >= 0);
  assert.ok(!JSON.stringify(first).includes('private answer'));
});

for (const scenario of ['new_packets', 'reused_packets', 'body_only', 'wrong_span', 'wrong_ids', 'nonretryable']) {
  test(`partial media progress is accepted only with host attestation: ${scenario}`, async () => {
    let turns = 0;
    const runtime = createRuntime({ run_id: 'partial-observation', model, tools, prompt: 'Read the required interval' }, {
      emit: () => {}, providerStream: () => response([++turns <= 5
        ? call(turns, 'inspect_media', { source_id: 'same' }) : call(turns, 'submit_answer', { answer: 'Done' })]),
      callHost: async (method, params) => {
        if (method === 'model_request') return { allowed: true };
        if (method === 'model_usage') return {};
        if (params.name === 'submit_answer') return finish;
        const evidence = { id: turns, source_id: 'same', content: 'Observed condition',
          provenance: { source_version: 'v1' }, locator: { start_sec: scenario === 'reused_packets' ? 0 : turns * 30 } };
        const proof = { coverage: 'partial', artifact_id: `tool_artifact${turns}`, evidence_ids: [turns],
          partial_observation_span_id: `tool:${params.tool_call_id}` };
        const details = { code: 'media_model_unavailable', retryable: scenario !== 'nonretryable',
          ...(scenario === 'body_only' ? {} : proof) };
        if (scenario === 'wrong_span') details.partial_observation_span_id = 'tool:unrelated';
        if (scenario === 'wrong_ids') details.evidence_ids = [turns + 100];
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ...proof,
          code: details.code, evidence: [evidence], message: `Transient error ${turns}` }) }], details };
      },
    });
    const result = await runtime.run();
    if (scenario === 'new_packets') {
      assert.equal(result.terminal, 'completed');
      assert.equal(turns, 6);
    } else {
      assert.equal(result.code, 'repeated_tool_failure');
      assert.equal(turns, scenario === 'reused_packets' ? 4 : 3);
    }
  });
}

test('a packet delivered before a later partial failure cannot be counted as newly acquired again', async () => {
  let turns = 0;
  const runtime = createRuntime({ run_id: 'already-delivered', model, tools, prompt: 'Read the required interval' }, {
    emit: () => {}, providerStream: () => response([++turns <= 7
      ? call(turns, 'inspect_media', { source_id: 'same' }) : call(turns, 'submit_answer', { answer: 'Done' })]),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      if (params.name === 'submit_answer') return finish;
      const evidence = { id: turns, source_id: 'same', content: 'Already known', provenance: { source_version: 'v1' } };
      const details = { artifact_id: `tool_artifact${turns}`, evidence_ids: [turns],
        ...(turns > 1 ? { coverage: 'partial', partial_observation_span_id: `tool:${params.tool_call_id}`,
          code: 'media_model_unavailable', retryable: true } : {}) };
      return { isError: turns > 1, content: [{ type: 'text', text: JSON.stringify({ evidence: [evidence] }) }], details };
    },
  });
  assert.equal((await runtime.run()).code, 'repeated_tool_failure');
  assert.equal(turns, 4);
});
