import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Type } from 'typebox';
import { createRuntime } from '../src/runtime.mjs';

const unit = (id, text, start = 0, origin = 'unmarked_parsed_text') =>
  ({ id, text, start, end: start + [...text].length, origin });
const evidence = (id, title, text) => ({ id, source_id: `source-${id}`, file_name: title,
  version: `version-${id}`, observation: 'parsed_text', locator: { chunk_index: id, text_start: 0 },
  content_units: [unit(`e${id}s1`, text)] });

async function exercise(t, scenario) {
  const requests = [], admissions = [], events = [], hostCalls = [];
  const oldRows = [evidence(1, '预算📘说明.pdf', '## 原始章节\n' + '记录🔎与条件'.repeat(9000))];
  if (scenario.many) {
    oldRows.splice(0, 1, ...Array.from({ length: 30 }, (_, i) =>
      evidence(i + 1, `材料${i}📘.pdf`, `## 章节${i}\n` + '逐字材料'.repeat(600))));
  }
  if (scenario.forged) oldRows.push(evidence(999, '未交付来源.pdf', '不应进入导航'));
  if (scenario.origins) {
    const heading = '## 标题📘\n', caption = '[图注：' + '图像描述🔎'.repeat(60);
    oldRows[0].content_units = [unit('e1s1', heading),
      unit('e1s2', caption, [...heading].length, 'generated_caption'),
      unit('e1s3', '后续原文'.repeat(9000), [...heading, ...caption].length)];
  }
  if (scenario.tiny) oldRows[0] = { id: 1, content_units: [unit('e1s1', '短')] };
  const latestRows = [evidence(105, '另一份研究.pdf', '## 方法与约束\n' + 'recent-source '.repeat(2300))];
  const oldText = scenario.malformed ? 'not-json '.repeat(7000) : JSON.stringify({ evidence: oldRows });
  const latestText = JSON.stringify({ evidence: latestRows });
  const oldIds = scenario.many ? oldRows.map(e => e.id) : [1];
  const calls = [
    ['old', 'search', { query: '预算' }], ['latest', 'search', { query: '方法' }],
    ...Array.from({ length: scenario.mixed ? 2 : 3 }, (_, i) => [`invalid-${i}`, 'submit_answer', { answer: [i] }]),
    ...(scenario.mixed ? [['notes', 'search', { query: '附属记录' }]] : []),
    ['recall', 'recall_evidence', { evidence_ids: [105] }],
    ['final', 'submit_answer', { answer: '完成本次有据说明。[105]' }],
  ];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const [id, name, args] = calls[requests.length - 1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const frame of [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function',
        function: { name, arguments: JSON.stringify(args) } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } },
    ]) response.write(`data: ${JSON.stringify(frame)}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const runtime = createRuntime({ run_id: 'navigation-http', api_key: 'test-only', prompt: '核对两个来源后回答',
    answer_checks_enabled: scenario.enabled !== false,
    tools: [
      { name: 'search', description: 'Search', parameters: Type.Object({ query: Type.String() }) },
      { name: 'recall_evidence', description: 'Recall', parameters: Type.Object({ evidence_ids: Type.Array(Type.Number()) }) },
      { name: 'submit_answer', description: 'Finish', parameters: Type.Object({ answer: Type.String() }) },
    ], model: { id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'deepseek',
      baseUrl: `http://127.0.0.1:${server.address().port}`, reasoning: false, input: ['text'],
      contextWindow: 16000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } },
  }, {
    emit: (type, data) => events.push({ type, data }),
    callHost: async (method, params) => {
      if (method === 'model_request') {
        admissions.push(params);
        return { allowed: true };
      }
      if (method === 'model_usage') return {};
      hostCalls.push(params);
      if (params.tool_call_id === 'notes') return { content: [{ type: 'text', text: '附属过程记录'.repeat(700) }],
        details: { artifact_id: 'notes-artifact', evidence_ids: [] } };
      if (params.tool_call_id === 'old') return { content: [{ type: 'text', text: oldText }],
        details: { artifact_id: 'old-artifact', evidence_ids: oldIds } };
      if (params.tool_call_id === 'latest' || params.name === 'recall_evidence')
        return { content: [{ type: 'text', text: latestText }], details: { artifact_id: params.tool_call_id, evidence_ids: [105] } };
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed', answer: params.args.answer } };
    },
  });
  t.after(() => runtime.abort());
  assert.equal((await runtime.run()).terminal, 'completed');
  assert.equal(requests.length, calls.length, 'No extra model request is introduced by navigation');
  assert.ok(!hostCalls.some(call => call.tool_call_id.startsWith('invalid')));
  for (const request of requests) {
    const pending = new Set();
    for (const message of request.messages) {
      for (const call of message.tool_calls || []) pending.add(call.id);
      if (message.role === 'tool') assert.ok(pending.delete(message.tool_call_id));
    }
    assert.equal(pending.size, 0, 'Actual provider requests keep tool/result pairings');
  }
  return { requests, admissions, events, hostCalls, oldRows, oldIds, oldText, latestRows, latestText };
}

for (const scenario of [{}, { mixed: true }, { enabled: false }, { malformed: true },
  { forged: true }, { many: true }, { origins: true }, { tiny: true }]) {
  test(`archived evidence navigation reaches actual Pi HTTP ${JSON.stringify(scenario)}`, { timeout: 15000 }, async t => {
    const run = await exercise(t, scenario);
    const request = run.requests[5];
    const oldContent = request.messages.find(message => message.tool_call_id === 'old').content;
    if (scenario.tiny) {
      assert.equal(oldContent, run.oldText, 'Never expand a small source result merely to attach navigation');
      return;
    }
    const marker = JSON.parse(oldContent);
    assert.equal(marker.archived_result, 'old-artifact');
    assert.deepEqual(marker.evidence_ids, run.oldIds);
    if (scenario.enabled === false || scenario.malformed) {
      assert.equal(marker.evidence_navigation, undefined, 'No guessed preview or change to the ordinary Pi route');
      return;
    }
    const navigation = marker.evidence_navigation;
    assert.ok(navigation?.entries.length, 'Archived IDs need source identity and exact navigation excerpts');
    assert.ok(Buffer.byteLength(JSON.stringify(navigation)) <= 4096);
    assert.ok(Buffer.byteLength(oldContent) < Buffer.byteLength(run.oldText));
    assert.match(marker.instruction, /定位.*复读|复读.*定位/);
    for (const entry of navigation.entries) {
      const source = run.oldRows.find(item => item.id === entry.evidence_id);
      assert.ok(run.oldIds.includes(entry.evidence_id));
      assert.equal(entry.source_id, source.source_id);
      assert.equal(entry.file_name, source.file_name);
      assert.equal(entry.observation, source.observation);
      assert.equal(entry.version, source.version);
      assert.equal(entry.locator.chunk_index, source.locator.chunk_index);
      assert.ok(entry.excerpts.length > 0);
      assert.ok(entry.excerpts.reduce((total, part) => total + [...part.text].length, 0) <= 160);
      for (const excerpt of entry.excerpts) {
        const original = source.content_units.find(part => part.id === excerpt.span_id);
        assert.equal(excerpt.text, [...original.text].slice(0, excerpt.end - excerpt.start).join(''));
        assert.equal(excerpt.start, original.start);
        assert.equal(excerpt.origin, original.origin);
      }
    }
    assert.equal(navigation.omitted_evidence_count, run.oldIds.length - navigation.entries.length);
    assert.ok(!navigation.entries.some(entry => entry.evidence_id === 999));
    if (scenario.many) assert.ok(navigation.omitted_evidence_count > 0, 'Truncated navigation is explicit');
    if (scenario.origins) assert.equal(navigation.entries[0].excerpts[1].origin, 'generated_caption');
    assert.ok(run.events.some(event => event.type === 'context.compacted'
      && event.data.archived_evidence_indexes?.some(index => index.artifact_id === 'old-artifact'
        && index.evidence_ids.includes(1))));
      const latest = JSON.parse(request.messages.find(message => message.tool_call_id === 'latest').content);
      if (latest.archived_result) assert.equal(latest.evidence_navigation.entries[0].evidence_id, 105);
      else assert.deepEqual(latest.evidence, run.latestRows);
      assert.deepEqual(run.hostCalls.find(call => call.name === 'recall_evidence').args.evidence_ids, [105]);
      assert.equal(run.requests.at(-1).messages.find(message => message.tool_call_id === 'recall').content, run.latestText);
  });
}
