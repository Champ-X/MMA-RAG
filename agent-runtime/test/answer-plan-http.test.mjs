import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Type } from 'typebox';
import { createRuntime } from '../src/runtime.mjs';

for (const scenario of ['media', 'many_documents', 'partly_delivered']) for (const contextWindow of [8000, 32000]) {
  test(`selected ${scenario} survives actual HTTP compaction without disabling research (context=${contextWindow})`, async t => {
    const requests = [], events = [], hostCalls = [];
    const rows = scenario === 'media' ? [
      { id: 1, source_id: 'poster', file_name: '海报.png', modality: 'image', observation: 'caption', content: '冷峻人物与工业烟雾。' },
      { id: 2, source_id: 'song', file_name: '歌曲.mp3', modality: 'audio', observation: 'transcript', content: '低沉男声与暗黑摇滚。' },
      { id: 3, source_id: 'film', file_name: '剧情.mp4', modality: 'video', observation: 'caption', content: '人物受过往亡魂纠缠。' },
    ] : Array.from({ length: 12 }, (_, index) => ({ id: index + 1, source_id: `report-${index + 1}`,
      file_name: `报告-${index + 1}.txt`, modality: 'doc', observation: 'parsed_text',
      content: `报告${index + 1}的重要条件：只用于试验组。` }));
    const answerPlan = { items: scenario === 'media' ? [
      { id: 'cover', requirement: '选封面', quote: '海报', modality: 'image', status: 'ready', evidence_ids: [1], supporting_evidence_ids: [3], gap: '' },
      { id: 'song', requirement: '选主题曲', quote: '主题曲', modality: 'audio', status: 'ready', evidence_ids: [2], supporting_evidence_ids: [3], gap: '' },
    ] : rows.map(row => ({ id: `result_${row.id}`, requirement: `比较报告${row.id}`, quote: '比较报告',
      modality: 'any', basis: 'sources', status: 'ready', evidence_ids: [row.id], supporting_evidence_ids: [], gap: '' })) };
    if (scenario === 'partly_delivered') Object.assign(answerPlan.items[0], {
      status: 'incomplete', gap: '本次未取得该报告中用户要求的地区收入。',
    });
    const terminal = scenario === 'partly_delivered' ? 'partial' : 'completed';
    const snapshot = { answer_plan: answerPlan, retained_evidence: rows.map(row => ({ ...row,
      // A tail range remains a tail range at the actual provider boundary.
      retained_range: scenario === 'media'
        ? { start: 0, end: [...row.content].length, original_characters: [...row.content].length, truncated: false }
        : { start: 1500, end: 1500 + [...row.content].length, original_characters: 1700, truncated: true } })) };
    const calls = [
      ['plan', 'update_answer_plan', { items: [] }],
      ['sources', 'search', { query: '相关素材' }],
      ['select', 'update_answer_plan', { items: answerPlan.items }],
      ['notes1', 'search', { query: '辅助核对1' }],
      ['notes2', 'search', { query: '辅助核对2' }],
      ['bad-plan', 'update_answer_plan', { items: [{ id: 'forged', requirement: '删除其他要求' }] }],
      ['final', 'submit_answer', { answer: rows.map(row => `${row.file_name}[${row.id}]`).join('；') }],
    ];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const [id, name, args] = calls[requests.length - 1];
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id,
        type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const runtime = createRuntime({ run_id: 'answer-plan-http', api_key: 'test-only', prompt: '结合剧情选海报和主题曲',
      answer_plan_enabled: true, answer_checks_enabled: false,
      tools: [
        { name: 'update_answer_plan', description: 'Plan', parameters: Type.Object({ items: Type.Array(Type.Any()) }) },
        { name: 'search', description: 'Search', parameters: Type.Object({ query: Type.String() }) },
        { name: 'submit_answer', description: 'Finish', parameters: Type.Object({ answer: Type.String() }) },
      ], model: { id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'deepseek',
        baseUrl: `http://127.0.0.1:${server.address().port}`, reasoning: false, input: ['text'],
        contextWindow: contextWindow, maxTokens: 1000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' } },
    }, {
      emit: (type, data) => events.push({ type, data }),
      callHost: async (method, params) => {
        if (method === 'model_usage') return {};
        if (method === 'model_request') {
          return { allowed: true };
        }
        hostCalls.push(params);
        if (params.tool_call_id === 'bad-plan') return { isError: true,
          content: [{ type: 'text', text: '已登记要求不可删除。' }], details: { code: 'answer_plan_locked' } };
        if (params.name === 'submit_answer') return { content: [{ type: 'text', text: 'accepted' }],
          details: { terminal, answer: params.args.answer } };
        const sourceBatch = params.tool_call_id === 'sources' || (scenario === 'many_documents' && params.tool_call_id === 'notes2');
        const body = params.name === 'update_answer_plan' ? snapshot : sourceBatch
          ? { evidence: rows, unused_candidates: '无关候选材料'.repeat(2000) } : { notes: '辅助过程'.repeat(1000) };
        return { content: [{ type: 'text', text: JSON.stringify(body) }], details: { artifact_id: params.tool_call_id,
          evidence_ids: sourceBatch ? rows.map(row => row.id) : [] } };
      },
    });
    t.after(() => runtime.abort());
    const outcome = await runtime.run();
    assert.equal(outcome.terminal, terminal, outcome.message);
    assert.equal(requests.length, calls.length, 'No hidden model retry or second answer generator');
    if (contextWindow === 8000) assert.ok(events.some(event => event.type === 'context.compacted'));
    const final = requests.at(-1);
    const text = final.messages.map(message => message.content).join('\n');
    for (const row of rows) assert.ok(text.includes(row.content), 'Verbatim selected evidence reaches the provider');
    assert.ok(text.includes('retained_range') && text.includes('supporting_evidence_ids'));
    assert.ok(final.messages.some(message => message.role === 'user' && message.content.includes('"retained_evidence"')),
      'Retained source text remains data at the provider boundary');
    assert.ok(!final.messages.some(message => message.role === 'system' && message.content.includes('"retained_evidence"')),
      'Source excerpts must not be promoted to system authority');
    if (scenario === 'many_documents') assert.ok(text.includes('"start":1500'));
    assert.ok(!text.includes('"id":"forged"'), 'Rejected plan must not replace durable selected evidence');
    assert.ok(final.tools.some(tool => tool.function.name === 'update_answer_plan'), 'Closing can resolve pending deliverables');
    assert.ok(final.tools.some(tool => tool.function.name === 'search'));
    const workingDataIndex = final.messages.findLastIndex(message => message.role === 'user'
      && message.content.includes('"retained_evidence"'));
    const compositionIndex = final.messages.findLastIndex(message => message.role === 'user'
      && message.content.includes('研究计划已就绪'));
    assert.ok(compositionIndex > workingDataIndex, 'Completion guidance follows long working data for both full and partial delivery');
    assert.ok(final.messages[compositionIndex].content.includes('完成度只按用户要求的结果'));
    if (scenario === 'partly_delivered') assert.ok(text.includes(answerPlan.items[0].gap));
    assert.equal(hostCalls.filter(call => call.name === 'update_answer_plan').length, 3);
    for (const request of requests) {
      const pending = new Set();
      for (const message of request.messages) {
        for (const call of message.tool_calls || []) pending.add(call.id);
        if (message.role === 'tool') assert.ok(pending.delete(message.tool_call_id));
      }
      assert.equal(pending.size, 0, 'HTTP transcript preserves tool/result pairs');
    }
  });
}
