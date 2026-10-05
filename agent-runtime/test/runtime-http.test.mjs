import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Type } from 'typebox';
import { createRuntime, SYSTEM_PROMPT } from '../src/runtime.mjs';

async function sseEndpoint(t, responses) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const frames = responses[requests.length - 1];
    if (!frames) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Unexpected model request' } }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function wireConfig(baseUrl, provider = 'deepseek') {
  return { run_id: 'http-protocol', api_key: 'test-only', prompt: '查证后提交结果',
    budget: { output_tokens: 1000, wall_seconds: 10 },
    tools: [
      { name: 'search', description: 'Search', parameters: Type.Object({ query: Type.String() }) },
      { name: 'submit_answer', description: 'Finish', parameters: Type.Object({ answer: Type.String() }) },
    ],
    model: { id: 'local-fixture', name: 'local-fixture', api: 'openai-completions', provider,
      baseUrl, reasoning: true, input: ['text'], contextWindow: 64000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
        thinkingFormat: provider === 'deepseek' ? 'deepseek' : 'qwen', maxTokensField: 'max_tokens' } } };
}

// Keep the real Agent loop AND Pi's OpenAI serializer. Only the remote HTTP
// endpoint and host are controlled, so a mocked provider cannot hide dropped
// tool feedback, broken call/result pairing, or overwritten system messages.
for (const answerChecks of [false, true]) {
  for (const closing of [false, true]) {
    test(`HTTP repair preserves host feedback (checks=${answerChecks}, closing=${closing})`,
      { timeout: 15000 }, async (t) => {
        const requests = [], events = [], hostCalls = [];
        const prompt = '依据来源回答，正文不超过250字；信息不足须说明范围。';
        const source = JSON.stringify({ evidence: [{ id: 1, content: '来源原文：数值为17，模型权重固定。' }] });
        const feedback = JSON.stringify({ code: 'invalid_answer', retryable: false,
          message: '正文单元按非空行编号。请修正后重新提交。',
          detail: { body_characters: 322, declared_max_characters: 250, over_by: 72,
            suggested_body_characters: 212, units: [
              { unit_id: 'a1', characters: 322, text_prefix: '初稿包含引号"、换行\n及Unicode：π😀。' },
              { unit_id: 'l1', characters: 8, text_prefix: '尚未取得全部材料。' },
            ], errors: [{ code: 'incomplete_statements', expected_units: ['a1', 'l1'] },
              { code: 'answer_too_long', actual: 322, maximum: 250 }] } });
        const script = [
          { id: 'search-1', name: 'search', arguments: { query: '数值及固定条件' } },
          { id: 'rejected-1', name: 'submit_answer', arguments: { answer: '初稿[99]' } },
          { id: 'accepted-1', name: 'submit_answer', arguments: { answer: '数值为17，模型权重固定。[1]' } },
        ];
        const server = createServer(async (request, response) => {
          let body = '';
          for await (const chunk of request) body += chunk;
          requests.push({ path: request.url, body: JSON.parse(body) });
          const call = script[requests.length - 1];
          if (!call) {
            response.writeHead(400, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'Unexpected extra model call' } }));
            return;
          }
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          for (const frame of [
            { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } }] },
            { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
              usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } },
          ]) response.write(`data: ${JSON.stringify(frame)}\n\n`);
          response.end('data: [DONE]\n\n');
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
        const definitions = [
          { name: 'search', description: 'Search', parameters: Type.Object({ query: Type.String() }) },
          { name: 'submit_answer', description: 'Finish', parameters: Type.Object({ answer: Type.String() }) },
          { name: 'ask_user', description: 'Ask', parameters: Type.Object({ question: Type.String() }) },
          { name: 'recall_evidence', description: 'Recall', parameters: Type.Object({ evidence_ids: Type.Array(Type.Number()) }) },
          ...(answerChecks ? [{ name: 'check_answer', description: 'Check draft', parameters: Type.Object({ answer: Type.String() }) }] : []),
        ];
        const runtime = createRuntime({ run_id: 'http-repair', api_key: 'test-only', prompt,
          answer_checks_enabled: answerChecks, tools: definitions,
          budget: { output_tokens: 1000, wall_seconds: 10 },
          model: { id: 'deepseek-flash', name: 'local-fixture', api: 'openai-completions', provider: 'deepseek',
            baseUrl: `http://127.0.0.1:${server.address().port}`, reasoning: false, input: ['text'],
            contextWindow: 64000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
              thinkingFormat: 'deepseek', maxTokensField: 'max_tokens' } } }, {
          emit: (type, data) => events.push({ type, data }),
          callHost: async (method, params) => {
            hostCalls.push({ method, params });
            if (method === 'model_request') return { allowed: true, max_output_tokens: 1000,
              final_turn: closing && requests.length >= 2, allow_recall: false };
            if (method === 'model_usage') return {};
            if (params.name === 'search') return { content: [{ type: 'text', text: source }],
              details: { artifact_id: 'source-result', evidence_ids: [1] } };
            if (params.tool_call_id === 'rejected-1') return { isError: true,
              content: [{ type: 'text', text: feedback }], details: JSON.parse(feedback) };
            return { content: [{ type: 'text', text: 'accepted' }],
              details: { terminal: 'completed', answer: params.args.answer } };
          },
        });
        t.after(() => runtime.abort());
        const result = await runtime.run();
        assert.equal(result.terminal, 'completed', result.message);
        assert.equal(result.answer, script[2].arguments.answer);
        assert.equal(requests.length, 3);
        const repair = requests[2].body;
        const text = message => typeof message.content === 'string' ? message.content
          : message.content.map(part => part.text || '').join('');
        for (const request of requests) {
          assert.equal(request.path, '/chat/completions');
          const system = request.body.messages.filter(message => message.role === 'system');
          assert.equal(system.length, 1);
          assert.ok(text(system[0]).startsWith(SYSTEM_PROMPT));
          assert.equal(text(system[0]).includes('content_units'), answerChecks);
          assert.ok(request.body.messages.some(message => message.role === 'user' && text(message) === prompt));
          const pending = new Set();
          for (const message of request.body.messages) {
            for (const call of message.tool_calls || []) {
              assert.ok(!pending.has(call.id));
              pending.add(call.id);
            }
            if (message.role === 'tool') assert.ok(pending.delete(message.tool_call_id));
          }
          assert.equal(pending.size, 0, 'Every HTTP tool call must have its result before continuing');
        }
        assert.equal(repair.messages.find(message => message.tool_call_id === 'search-1').content, source);
        assert.equal(repair.messages.find(message => message.tool_call_id === 'rejected-1').content, feedback);
        assert.deepEqual(repair.messages.find(message => message.tool_calls?.[0]?.id === 'rejected-1').tool_calls[0],
          { id: 'rejected-1', type: 'function', function: { name: 'submit_answer', arguments: JSON.stringify(script[1].arguments) } });
        assert.equal(text(repair.messages[0]).includes('宿主预算已进入收尾阶段'), closing);
        assert.deepEqual(repair.tools.map(tool => tool.function.name), closing
          ? ['submit_answer', 'ask_user'] : definitions.map(tool => tool.name));
        assert.deepEqual(hostCalls.filter(call => call.method === 'tool').map(call => call.params.tool_call_id),
          script.map(call => call.id));
        assert.equal(events.filter(event => event.type === 'answer.reset' && event.data.reason === 'validation_failed').length, 1);
        assert.equal(events.filter(event => event.type === 'model.completed').length, 3);
      });
  }
}

test('HTTP tool calls remain host-restricted when the provider ignores removed tools', { timeout: 15000 }, async t => {
  const frames = (id, name, args) => [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } },
  ];
  const { requests, baseUrl } = await sseEndpoint(t, [
    frames('blocked', 'search', { query: 'new research' }),
    frames('finish', 'submit_answer', { answer: '现有依据不足，尚未进一步搜索。' }),
  ]);
  const calls = [], events = [];
  const runtime = createRuntime(wireConfig(baseUrl), {
    emit: (type, data) => events.push({ type, data }),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000, final_turn: true, allow_recall: false };
      if (method === 'model_usage') return {};
      calls.push(params);
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'partial', answer: params.args.answer } };
    },
  });
  t.after(() => runtime.abort());
  assert.equal((await runtime.run()).terminal, 'partial');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].tools.map(tool => tool.function.name), ['submit_answer']);
  assert.deepEqual(calls.map(call => call.name), ['submit_answer']);
  const rejection = requests[1].messages.find(message => message.role === 'tool' && message.tool_call_id === 'blocked');
  assert.match(rejection.content, /预算已进入收尾阶段/);
  const event = events.find(event => event.type === 'tool.rejected');
  assert.equal(event.data.name, 'search');
  assert.equal(event.data.executed, false);
});

test('Qwen HTTP null argument deltas and stop finish reason preserve the actual tool call', { timeout: 15000 }, async t => {
  // The compatible endpoint can finish a complete named tool call with "stop"
  // and send null argument deltas. Neither means a tool-free text response.
  const { requests, baseUrl } = await sseEndpoint(t, [[
    { choices: [{ index: 0, delta: { content: null, tool_calls: [{ index: 0, id: 'finish', type: 'function',
      function: { name: 'submit_answer', arguments: null } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: null, arguments: '{"answer":' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"OK"}' } }] } }] },
    { choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 286, completion_tokens: 19, total_tokens: 305 } },
  ]]);
  const calls = [], usage = [], events = [];
  const runtime = createRuntime(wireConfig(baseUrl, 'aliyun_bailian'), {
    emit: (type, data) => events.push({ type, data }),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000 };
      if (method === 'model_usage') { usage.push(params); return {}; }
      calls.push(params);
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed', answer: params.args.answer } };
    },
  });
  t.after(() => runtime.abort());
  const result = await runtime.run();
  assert.equal(result.terminal, 'completed', result.message);
  assert.equal(result.answer, 'OK');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].enable_thinking, false);
  assert.deepEqual(calls, [{ tool_call_id: 'finish', name: 'submit_answer', args: { answer: 'OK' } }]);
  assert.equal(usage[0].usage.totalTokens, 305);
  assert.equal(events.find(event => event.type === 'model.completed').data.stop_reason, 'stop');
});

test('registered requirements survive real Pi compaction, HTTP serialization and budget closing', { timeout: 15000 }, async t => {
  const requirements = { version: 1, max_characters: 250, length_quote: '正文不超过250字',
    required_points: ['比较两种方法并说明适用条件'],
    length_origin: { kind: 'current_question', start: 3, end: 12 },
    interpretation: 'Pi interpretation; meaning not independently verified.' };
  const frames = (id, name, args) => [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } },
  ];
  const { requests, baseUrl } = await sseEndpoint(t, [
    frames('register', 'set_answer_requirements', { max_characters: 250, length_quote: requirements.length_quote,
      required_points: requirements.required_points }),
    ...[1, 2, 3, 4].map(n => frames(`search-${n}`, 'search', { query: `方法${n}` })),
    frames('finish', 'submit_answer', { answer: '依据现有材料，条件不同。[4]' }),
  ]);
  const config = wireConfig(baseUrl);
  config.answer_checks_enabled = true;
  config.prompt = '比较两种方法，正文不超过250字。';
  config.tools.unshift({ name: 'set_answer_requirements', description: 'Register requirements', parameters: Type.Object({
    max_characters: Type.Number(), length_quote: Type.String(), required_points: Type.Array(Type.String()),
  }) });
  const events = [], calls = [];
  const runtime = createRuntime(config, {
    emit: (type, data) => events.push({ type, data }),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000,
        final_turn: requests.length === 5, allow_recall: false };
      if (method === 'model_usage') return {};
      calls.push(params);
      if (params.name === 'set_answer_requirements') return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'recorded', answer_requirements: requirements }) }],
        details: { artifact_id: 'requirements-result', evidence_ids: [], answer_requirements: requirements },
      };
      if (params.name === 'search') {
        const id = Number(params.tool_call_id.split('-')[1]);
        return { content: [{ type: 'text', text: JSON.stringify({ evidence: [{ id, content: '原文'.repeat(8000) }] }) }],
          details: { artifact_id: `search-result-${id}`, evidence_ids: [id] } };
      }
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed', answer: params.args.answer } };
    },
  });
  t.after(() => runtime.abort());
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(requests.length, 6);
  assert.deepEqual(calls.map(call => call.name), ['set_answer_requirements', 'search', 'search', 'search', 'search', 'submit_answer']);
  for (const request of requests.slice(1)) {
    const system = request.messages.filter(message => message.role === 'system');
    assert.equal(system.length, 1);
    assert.ok(system[0].content.includes(JSON.stringify(requirements)));
    assert.ok(request.messages.some(message => message.role === 'user' &&
      (typeof message.content === 'string' ? message.content : message.content.map(part => part.text || '').join('')) === config.prompt));
  }
  const closing = requests.at(-1);
  assert.match(closing.messages[0].content, /宿主预算已进入收尾阶段/);
  assert.deepEqual(closing.tools.map(tool => tool.function.name), ['submit_answer']);
  assert.match(closing.messages.find(message => message.tool_call_id === 'register').content, /archived_result/);
  assert.ok(events.some(event => event.type === 'context.compacted'));
  assert.equal(calls.at(-1).args.max_characters, undefined, 'the final answer need not repeat the stored cap');
});

test('removed tools report closure before malformed argument errors consume a final model turn', { timeout: 15000 }, async t => {
  const frames = (id, name, args) => [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } },
  ];
  const { requests, baseUrl } = await sseEndpoint(t, [
    frames('unavailable', 'search', { query: ['wrong type'], modalities: '["doc"]', limit: '6' }),
    frames('finish', 'submit_answer', { answer: '本次检索未找到所需信息的依据。' }),
  ]);
  const events = [], calls = [];
  const runtime = createRuntime(wireConfig(baseUrl), {
    emit: (type, data) => events.push({ type, data }),
    callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true, max_output_tokens: 1000, final_turn: true, allow_recall: false };
      if (method === 'model_usage') return {};
      calls.push(params.name);
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'partial', answer: params.args.answer } };
    },
  });
  t.after(() => runtime.abort());
  assert.equal((await runtime.run()).terminal, 'partial');
  assert.deepEqual(calls, ['submit_answer']);
  assert.equal(requests.length, 2);
  const error = requests[1].messages.find(message => message.tool_call_id === 'unavailable').content;
  assert.match(error, /预算已进入收尾阶段/);
  assert.doesNotMatch(error, /Validation failed|must be|Received arguments/);
  const rejection = events.find(event => event.type === 'tool.rejected');
  assert.equal(rejection.data.executed, false);
  assert.equal(rejection.data.message, error);
});
