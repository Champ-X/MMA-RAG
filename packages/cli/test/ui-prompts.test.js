import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'fast-string-width';
import { isCancel } from '@clack/core';
import { choose, enter } from '../src/ui-prompts.js';
import { paragraph, stepHeading } from '../src/presentation.js';
import { activity } from '../src/ui-spinner.js';

function terminal(t) {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  let transcript = '';
  const output = new Writable({ write(chunk, _encoding, next) { transcript += chunk; next(); } });
  Object.assign(output, { isTTY: true, columns: 60, rows: 24 });
  t.after(() => { input.destroy(); output.destroy(); });
  return { input, output, read: () => stripVTControlCharacters(transcript), async key(key) { await delay(15); input.write(key); await delay(15); } };
}

test('prompt navigation preserves initial choice, disabled options and cancellation', { timeout: 5000 }, async t => {
  const term = terminal(t);
  const options = [{ value: 'a', label: '本机' }, { value: 'b', label: '不可用', disabled: true }, { value: 'c', label: '远程', hint: '服务地址' }];
  const value = choose('运行方式？', options, { ...term, initialValue: 'c' });
  await term.key('\u001b[A');
  await term.key('\r');
  assert.equal(await value, 'a');
  const cancelled = choose('继续？', options, term);
  await term.key('\u0003');
  assert.ok(isCancel(await cancelled));
});

test('multiselect rejects an empty submission and preserves explicit selection', { timeout: 5000 }, async t => {
  const term = terminal(t);
  const value = choose('选择能力', [{ value: 'text', label: '文档' }, { value: 'image', label: '图片' }], { ...term, multiple: true, initialValues: [] });
  await term.key('\r');
  assert.match(term.read(), /至少选择一项/);
  await term.key('\u001b[B');
  await term.key(' ');
  await term.key('\r');
  assert.deepEqual(await value, ['image']);
});

test('editable defaults, validation and masked credentials survive the custom renderer', { timeout: 5000 }, async t => {
  const term = terminal(t);
  const value = enter('网页端口', { ...term, initialValue: '300', validate: value => value === '3001' ? undefined : '端口不正确' });
  await term.key('\r');
  assert.match(term.read(), /端口不正确/);
  await term.key('1');
  await term.key('\r');
  assert.equal(await value, '3001');
  const secret = enter('API Key', { ...term, secret: true });
  await term.key('synthetic-private-key');
  await term.key('\r');
  assert.equal(await secret, 'synthetic-private-key');
  assert.ok(!term.read().includes('synthetic-private-key'));
  assert.match(term.read(), /已填写/);
});

test('CJK, composed glyphs and navigation respect narrow terminal cell widths', () => {
  for (const columns of [32, 40, 60, 88, 120]) {
    const output = { columns };
    const text = `${paragraph('中文目录 👨‍👩‍👧‍👦 e\u0301 /long/path/'.repeat(8), { output })}\n${stepHeading(3, '准备运行环境', '准备 Docker 与所需组件', output)}`;
    for (const line of stripVTControlCharacters(text).split('\n')) assert.ok(stringWidth(line) < columns, `${columns}: ${line}`);
    assert.ok(text.includes('👨‍👩‍👧‍👦'));
  }
});

test('activity completion is idempotent and releases input and resize listeners', async t => {
  const term = terminal(t);
  const before = { keys: term.input.listenerCount('keypress'), resize: term.output.listenerCount('resize'), signals: process.listenerCount('SIGINT') };
  const spinner = activity('正在准备运行环境', term);
  term.output.columns = 40;
  term.output.emit('resize');
  spinner.message('正在下载本地检索模型');
  spinner.stop('准备完成');
  spinner.stop('重复完成');
  assert.match(term.read(), /准备完成/);
  assert.ok(!term.read().includes('重复完成'));
  assert.equal(term.input.listenerCount('keypress'), before.keys);
  assert.equal(term.output.listenerCount('resize'), before.resize);
  assert.equal(process.listenerCount('SIGINT'), before.signals);
});
