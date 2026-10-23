import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Type } from 'typebox';
import { createRuntime } from '../src/runtime.mjs';
import { promptsFor, SYSTEM_PROMPT } from '../src/prompts.mjs';

const model = { id: 'language-fixture', name: 'Language fixture', api: 'openai-completions', provider: 'test',
  reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

function sendCall(response, id, name, args) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [
    { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ] } }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } })}\n\n`);
  response.end('data: [DONE]\n\n');
}

test('missing or unsupported worker locale keeps the original Chinese system prompt', () => {
  assert.equal(promptsFor().SYSTEM_PROMPT, SYSTEM_PROMPT);
  assert.equal(promptsFor('unknown').SYSTEM_PROMPT, SYSTEM_PROMPT);
  const en = promptsFor('en-US');
  assert.match(en.SYSTEM_PROMPT, /Answer in the user's language/);
  assert.match(en.SYSTEM_PROMPT, /no cumulative run budget/);
  for (const name of ['SYSTEM_PROMPT', 'ANSWER_PLAN_PROMPT', 'ANSWER_CHECKS_PROMPT', 'ANSWER_COMPOSITION_PROMPT']) {
    assert.notEqual(en[name], promptsFor()[name]);
    // The Chinese caption marker is source syntax, retained verbatim in both languages.
    assert.doesNotMatch(en[name].replace('[图注：…]', ''), /[\u4e00-\u9fff]/u);
  }
});

test('concurrent real Pi HTTP requests select system, plan and composition language without changing data', async t => {
  const requests = { 'zh-CN': [], 'en-US': [] };
  const server = createServer(async (request, response) => {
    const language = request.url.includes('en-US') ? 'en-US' : 'zh-CN';
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests[language].push(JSON.parse(Buffer.concat(chunks).toString()));
    if (requests[language].length === 1) sendCall(response, 'plan', 'update_answer_plan', { items: [{ id: 'result', status: 'ready' }] });
    else sendCall(response, 'finish', 'submit_answer', { answer: '中文事实 [1]' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const run = async language => {
    const config = { run_id: language, language, api_key: 'fixture-only',
      model: { ...model, baseUrl: `http://127.0.0.1:${server.address().port}/${language}` },
      answer_plan_enabled: true, answer_checks_enabled: true,
      prompt: JSON.stringify({ current_question: '原始中文问题 English?', history_for_context_only_not_evidence: [{ role: 'user', content: '历史原文' }] }),
      tools: [{ name: 'update_answer_plan', description: language === 'en-US' ? 'Register final deliverables.' : '登记最终交付项。',
        parameters: Type.Object({ items: Type.Array(Type.Object({ id: Type.String(), status: Type.String() })) }) },
      { name: 'submit_answer', description: language === 'en-US' ? 'Submit your final answer.' : '提交最终回答。',
        parameters: Type.Object({ answer: Type.String() }) }],
    };
    const runtime = createRuntime(config, { emit: () => {}, callHost: async (method, params) => {
      if (method === 'model_request') return { allowed: true };
      if (method === 'model_usage') return {};
      if (params.name === 'update_answer_plan') return { content: [{ type: 'text', text: JSON.stringify({
        answer_plan: { items: params.args.items }, retained_evidence: [{ id: 1, source_id: 'kb/file', file_name: '原文件.pdf', content: '不可翻译的证据原文', version: 'v1' }], retention: {},
      }) }], details: {} };
      return { content: [{ type: 'text', text: 'accepted' }], details: { terminal: 'completed' } };
    } });
    config.language = language === 'en-US' ? 'zh-CN' : 'en-US';
    assert.equal((await runtime.run()).terminal, 'completed');
  };
  await Promise.all(['zh-CN', 'en-US'].map(run));
  for (const language of ['zh-CN', 'en-US']) {
    assert.equal(requests[language].length, 2);
    const first = requests[language][0], second = requests[language][1];
    const system = first.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
    assert.match(system, language === 'en-US' ? /You are Tessmora/ : /你是 Tessmora/);
    assert.match(system, /set_answer_requirements/);
    assert.match(system, /update_answer_plan/);
    assert.match(system, language === 'en-US' ? /Answer in the user's language/ : /答案用用户语言/);
    assert.ok(first.messages.some(message => JSON.stringify(message.content).includes('原始中文问题 English?')));
    const contents = second.messages.map(message => JSON.stringify(message.content)).join('\n');
    assert.match(contents, language === 'en-US' ? /host-persisted working data/ : /宿主持久化的工作数据/);
    assert.match(contents, language === 'en-US' ? /The research plan is ready/ : /研究计划已就绪/);
    assert.match(contents, /不可翻译的证据原文/);
    assert.match(contents, /原文件.pdf/);
    assert.match(first.tools[0].function.description, language === 'en-US' ? /Register final/ : /登记最终/);
  }
  assert.deepEqual(requests['zh-CN'][0].tools.map(tool => tool.function.parameters), requests['en-US'][0].tools.map(tool => tool.function.parameters));
});
