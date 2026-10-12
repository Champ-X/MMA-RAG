import test from 'node:test';
import assert from 'node:assert/strict';
import { modelActivity, modelReporter, chooseModelNetwork, canRepairModelNetwork } from '../src/model-progress.js';
import { BACK } from '../src/ui.js';

test('downloads show measured bytes; load and unknown totals never invent a percentage', () => {
  assert.equal(modelActivity('bge_m3', { state: 'running', phase: 'download', downloaded_bytes: 512 * 1024 ** 2, total_bytes: 2 * 1024 ** 3 }), 'BGE-M3 · 下载 512 MiB / 2.00 GiB · 25%');
  assert.match(modelActivity('bge_m3', { state: 'running', phase: 'download', files_completed: 2, files_total: 8, idle_seconds: 40 }), /2\/8.*等待新数据/);
  assert.doesNotMatch(modelActivity('bge_m3', { phase: 'load', message: '载入模型', downloaded_bytes: 100, total_bytes: 100 }), /%/);
  assert.doesNotMatch(modelActivity('bge_m3', { phase: 'download', total_bytes: 0 }), /%|NaN/);
});

test('reporter retains per-model completion and durable model phases with failure', () => {
  const output = [], log = [];
  const ui = { success: value => output.push(value), spinner: value => ({ message: value => output.push(value), stop: value => output.push(value), error: value => output.push(value) }) };
  const reporter = modelReporter(ui, { write: value => log.push(value) });
  reporter.event({ state: 'running', stage: 'storage', models: {} });
  reporter.event({ state: 'running', stage: 'models', models: { bge_m3: { state: 'running', phase: 'metadata', message: '连接下载源' } } });
  reporter.event({ state: 'running', stage: 'models', models: { bge_m3: { state: 'ready' }, clip: { state: 'running', phase: 'load', message: '载入模型' } } });
  reporter.event({ state: 'error', stage: 'models', models: { bge_m3: { state: 'ready' }, clip: { state: 'error', phase: 'load', message: '内存不足' } } });
  const error = { code: 'MODEL_PREPARE_FAILED', message: '内存不足', hint: '增加可用内存' };
  reporter.close(error);
  reporter.close(error);
  assert.equal(output.filter(line => line.includes('BGE-M3')).length, 1);
  assert.equal(output.filter(line => line.includes('此项尚未完成')).length, 1);
  assert(log.some(line => line.includes('连接下载源')));
  assert(log.some(line => line.includes('内存不足')));
  assert(log.some(line => line.includes('增加可用内存')));
});

test('network repair requires an explicit source choice and never handles disk errors as network', async () => {
  const messages = [];
  const ui = { select: async (_message, options) => { messages.push(options); return 'mirror'; } };
  assert.deepEqual(await chooseModelNetwork(ui, {}), { modelEndpoint: 'https://hf-mirror.com' });
  assert.match(messages[0].find(row => row.value === 'mirror').hint, /第三方/);
  ui.select = async () => BACK;
  assert.equal(await chooseModelNetwork(ui, {}), null);
  assert(canRepairModelNetwork({ details: { model: { error_code: 'MODEL_NETWORK' } } }));
  assert(!canRepairModelNetwork({ details: { model: { error_code: 'MODEL_DISK_FULL' } } }));
  ui.select = async () => 'proxy';
  ui.info = () => {};
  ui.text = async () => 'off';
  assert.deepEqual(await chooseModelNetwork(ui, { proxy: 'http://proxy.example:8080' }), { proxy: '' });
});
