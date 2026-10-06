import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Type } from 'typebox';
import { createRuntime, SYSTEM_PROMPT } from '../src/runtime.mjs';

async function sseEndpoint(t, responses) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    // Socket boundaries can split a UTF-8 code point in a long draft.
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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

for (const provider of ['deepseek', 'aliyun_bailian']) {
  test(`closing admission measures resolved tool declarations without changing the HTTP request (${provider})`,
    { timeout: 15000 }, async t => {
      const requirements = { max_characters: 250, length_quote: '正文不超过250字', required_points: ['原文中的数值'] };
      const source = JSON.stringify({ evidence: [{ id: 1, content: '实际原文🔎：测量值为17。' }] });
      const draft = '最近草稿需要精简。'.repeat(30);
      const feedback = '实际字数超限，请保留来源中的数值和条件，重新组织正文。';
      const call = (id, name, args) => [
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function',
          function: { name, arguments: JSON.stringify(args) } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } },
      ];
      async function run({ bounded, enabled = true, midConversation = false, limit = 18000 }) {
        const { requests, baseUrl } = await sseEndpoint(t, [
          call('register', 'set_answer_requirements', requirements),
          call('read', 'search', { query: '数值' }),
          call('draft', 'submit_answer', { answer: draft }),
          call('finish', 'submit_answer', { answer: '测量值为17。[1]' }),
        ]);
        const admissions = [], events = [], settled = [];
        const base = wireConfig(baseUrl, provider);
        const runtime = createRuntime({ ...base, answer_checks_enabled: enabled,
          prompt: '原问题🔎，正文不超过250字。',
          model: { ...base.model, contextWindow: 200000,
            compat: { ...base.model.compat, supportsMidConvoSystemMessages: midConversation } },
          tools: [...base.tools.map(tool => tool.name === 'search'
            ? { ...tool, description: 'READ_ONLY_SEARCH_SCHEMA_'.repeat(1500) } : tool),
          { name: 'set_answer_requirements', description: 'Register', parameters: Type.Object({
            max_characters: Type.Number(), length_quote: Type.String(), required_points: Type.Array(Type.String()),
          }) }],
        }, {
          emit: (type, data) => events.push({ type, data }),
          callHost: async (method, params) => {
            if (method === 'model_request') {
              admissions.push(params);
              if (bounded && requests.length === 3 && params.input_bytes > limit) {
                return { allowed: false, max_input_bytes: limit, final_turn: true, allow_recall: false };
              }
              return { allowed: true, max_output_tokens: 1000, final_turn: requests.length >= 2, allow_recall: false };
            }
            if (method === 'model_usage') { settled.push(params); return {}; }
            if (params.name === 'set_answer_requirements') return { content: [{ type: 'text', text: 'recorded' }],
              details: { answer_requirements: requirements } };
            if (params.name === 'search') return { content: [{ type: 'text', text: source }],
              details: { evidence_ids: [1], artifact_id: 'source-artifact' } };
            if (params.tool_call_id === 'draft') return { isError: true, content: [{ type: 'text', text: feedback }],
              details: { code: 'answer_too_long', rejected_answer_span_id: 'tool:draft' } };
            return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed', answer: params.args.answer } };
          },
        });
        t.after(() => runtime.abort());
        return { result: await runtime.run(), requests, admissions, events, settled };
      }
      // The unbounded control uses the same experimental prompt and the same
      // provider serializer. Only host admission differs, not model responses.
      const control = await run({ bounded: false });
      const bounded = await run({ bounded: true });
      assert.equal(control.result.terminal, 'completed');
      assert.equal(bounded.result.terminal, 'completed', bounded.result.message);
      assert.deepEqual(bounded.requests, control.requests, 'The paid HTTP bodies must be identical');
      assert.equal(bounded.requests.length, 4);
      assert.deepEqual(bounded.admissions.map(item => item.turn), [1, 2, 3, 4, 4]);
      assert.equal(bounded.settled.length, 4, 'No extra provider request or usage settlement');
      assert.ok(bounded.admissions.at(-2).input_bytes > 18000);
      assert.ok(bounded.admissions.at(-1).input_bytes <= 18000);
      const last = bounded.requests.at(-1);
      assert.ok(bounded.admissions.at(-1).input_bytes >= Buffer.byteLength(JSON.stringify(last)));
      assert.deepEqual(last.tools.map(tool => tool.function.name), ['submit_answer']);
      assert.equal(last.messages.find(message => message.tool_call_id === 'read').content, source);
      assert.equal(last.messages.find(message => message.tool_call_id === 'draft').content, feedback);
      const draftCall = last.messages.flatMap(message => message.tool_calls || []).find(item => item.id === 'draft');
      assert.equal(JSON.parse(draftCall.function.arguments).answer, draft);
      assert.match(last.messages[0].content, /本轮已登记的回答要求/);
      assert.ok(JSON.stringify(last.messages).includes('原问题🔎，正文不超过250字。'));
      assert.ok(!bounded.events.some(event => event.type === 'context.compacted'), 'No source body was archived');
      // Do not change default admission, rewrite a transcript using mid-turn
      // system messages, or let a genuinely oversized required input through.
      for (const options of [{ enabled: false }, { midConversation: true }, { limit: 10 }]) {
        const blocked = await run({ bounded: true, ...options });
        assert.equal(blocked.result.terminal, 'failed');
        assert.equal(blocked.requests.length, 3);
        assert.equal(blocked.settled.length, 3);
        assert.match(blocked.result.message, /无法容纳问题与最后一组原文证据/);
      }
    });
}

for (const scenario of [
  { enabled: true, proof: 'valid', mixed: false },
  { enabled: true, proof: 'valid', mixed: false, invalidLatest: true },
  { enabled: false, proof: 'valid', mixed: false },
  { enabled: true, proof: 'missing', mixed: false },
  { enabled: true, proof: 'wrong-span', mixed: false },
  { enabled: true, proof: 'valid', mixed: true },
]) {
  test(`superseded draft archival preserves the latest pair and real HTTP contract ${JSON.stringify(scenario)}`,
    { timeout: 15000 }, async t => {
      const shouldArchive = scenario.enabled && scenario.proof === 'valid' && !scenario.mixed;
      const oldAnswer = '旧稿'.repeat(4000), latestAnswer = '最新'.repeat(4000);
      const requirements = { max_characters: 250, length_quote: '正文不超过250字', required_points: ['说明来源中的数值'] };
      const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
      const frames = calls => [
        { choices: [{ index: 0, delta: { tool_calls: calls.map((item, index) => ({ index, ...item })) } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } },
      ];
      const { requests, baseUrl } = await sseEndpoint(t, [
        frames([call('register', 'set_answer_requirements', requirements)]),
        frames([call('source', 'search', { query: '数值' })]),
        frames([call('old', 'submit_answer', { answer: oldAnswer }),
          ...(scenario.mixed ? [call('other-source', 'search', { query: '其他来源' })] : [])]),
        frames([call('latest', 'submit_answer', { answer: latestAnswer })]),
        ...(scenario.invalidLatest ? [frames([call('invalid', 'submit_answer', { answer: ['malformed draft'] })])] : []),
        frames([call('final', 'submit_answer', { answer: '数值为17。[1]' })]),
      ]);
      const events = [], hostCalls = [], admissions = [];
      const source = JSON.stringify({ evidence: [{ id: 1, content: '实际来源：数值为17。' }] });
      const feedback = id => JSON.stringify({ code: 'answer_too_long', message: `${id}草稿超限，请按250字符要求重新组织答案。` });
      const base = wireConfig(baseUrl);
      const runtime = createRuntime({ ...base, answer_checks_enabled: scenario.enabled,
        model: { ...base.model, contextWindow: 200000 }, prompt: '原问题🔎，正文不超过250字。',
        tools: [...base.tools, { name: 'set_answer_requirements', description: 'Register',
          parameters: Type.Object({ max_characters: Type.Number(), length_quote: Type.String(), required_points: Type.Array(Type.String()) }) }],
      }, {
        emit: (type, data) => events.push({ type, data }),
        callHost: async (method, params) => {
          if (method === 'model_request') {
            admissions.push(params);
            // The last request fits only after discarding the superseded pair.
            if (shouldArchive && requests.length >= 4 && params.input_bytes > 45000)
              return { allowed: false, max_input_bytes: 45000, final_turn: true, allow_recall: false };
            return { allowed: true, max_output_tokens: 1000, final_turn: requests.length >= 3, allow_recall: false };
          }
          if (method === 'model_usage') return {};
          hostCalls.push(params);
          if (params.name === 'set_answer_requirements') return { content: [{ type: 'text', text: 'recorded' }],
            details: { answer_requirements: requirements } };
          if (params.name === 'search') return { content: [{ type: 'text', text: source }],
            details: { evidence_ids: [1], artifact_id: params.tool_call_id } };
          if (params.tool_call_id !== 'final') return { isError: true, content: [{ type: 'text', text: feedback(params.tool_call_id) }],
            details: { code: 'answer_too_long', ...(scenario.proof === 'missing' ? {} :
              { rejected_answer_span_id: `tool:${scenario.proof === 'valid' ? params.tool_call_id : 'unrelated'}` }) } };
          return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed', answer: params.args.answer } };
        },
      });
      t.after(() => runtime.abort());
      const result = await runtime.run();
      assert.equal(result.terminal, 'completed', result.message);
      assert.equal(requests.length, scenario.invalidLatest ? 6 : 5);
      assert.equal(admissions.length, requests.length, 'Archival is not an extra model call or provider retry');
      const last = requests.at(-1);
      const old = last.messages.find(message => message.tool_calls?.some(item => item.id === 'old'));
      assert.equal(Boolean(old), !shouldArchive);
      assert.equal(Boolean(last.messages.find(message => message.tool_call_id === 'old')), !shouldArchive);
      const latest = last.messages.find(message => message.tool_calls?.some(item => item.id === 'latest'));
      assert.equal(JSON.parse(latest.tool_calls[0].function.arguments).answer, latestAnswer);
      assert.equal(last.messages.find(message => message.tool_call_id === 'latest').content, feedback('latest'));
      assert.equal(last.messages.find(message => message.tool_call_id === 'source').content, source);
      assert.equal(hostCalls.find(item => item.tool_call_id === 'old').args.answer, oldAnswer);
      assert.equal(hostCalls.find(item => item.tool_call_id === 'latest').args.answer, latestAnswer);
      assert.ok(!hostCalls.some(item => item.tool_call_id === 'invalid'));
      const text = message => typeof message.content === 'string' ? message.content : message.content.map(part => part.text || '').join('');
      assert.ok(last.messages.some(message => message.role === 'user' && text(message) === '原问题🔎，正文不超过250字。'));
      if (scenario.enabled) assert.match(last.messages[0].content, /本轮已登记的回答要求/);
      for (const request of requests) {
        const pending = new Set();
        for (const message of request.messages) {
          for (const item of message.tool_calls || []) pending.add(item.id);
          if (message.role === 'tool') assert.ok(pending.delete(message.tool_call_id));
        }
        assert.equal(pending.size, 0, 'Every surviving HTTP call retains its result');
      }
      const archived = events.filter(event => event.type === 'context.compacted' && event.data.archived_answer_attempts);
      assert.equal(archived.length, shouldArchive ? 1 : 0);
      if (shouldArchive) {
        assert.deepEqual(archived[0].data.archived_answer_spans, ['tool:old']);
        assert.match(last.messages[0].content, /已归档.*被拒草稿/);
        assert.ok(!JSON.stringify(last).includes(oldAnswer));
      }
    });
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
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          requests.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
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
