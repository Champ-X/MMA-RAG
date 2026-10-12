import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRuntimeDiagnostics, diagnosticSummary, runtimeServices } from '../src/runtime-diagnostics.js';
import { runtimeFailure } from '../src/runtime-progress.js';
import { TessmoraError } from '../src/errors.js';

function fixture() {
  const calls = [], receipt = [];
  const states = Object.fromEntries(runtimeServices.map((service, index) => [service, {
    ID: String(index + 1).repeat(64), Service: service, State: 'running', Health: 'healthy',
  }]));
  const deps = {
    runtimeSecrets: async () => ['private-storage-value', 'private-model-value'],
    containers: async () => Object.values(states),
    run: async (command, args, options) => {
      calls.push([command, args, options]);
      assert.ok(!args.includes('{{json .}}'), 'full inspect would include Env and credentials');
      const row = Object.values(states).find(row => row.ID === args.at(-1));
      return JSON.stringify({ state: { Status: row.State, ExitCode: row.exitCode || 0, OOMKilled: row.oom || false, Health: { Status: row.Health, Log: [
        { End: '2026-10-12T13:41:30Z', ExitCode: row.Health === 'healthy' ? 0 : 1, Output: 'No nodes replied; private-storage-value' },
      ] } }, restarts: 0 });
    },
    compose: async (_paths, _state, args, options) => {
      calls.push(['compose', args, options]);
      if (args.includes('logs')) return 'INFO booting\nERROR Cannot connect to redis://redis:6379/0: Timeout connecting to server. private-model-value';
      if (args.includes('exec')) return '[{"target":"redis:6379","status":"tcp_timeout","addresses":["172.18.0.2"]}]';
      throw new Error('Unexpected diagnostic command');
    },
  };
  return { calls, receipt, states, deps, options: { journal: { write: text => receipt.push(text) } } };
}

test('diagnosis reports all failing services, scoped health outputs, bounded logs and internal connectivity', async () => {
  const f = fixture();
  f.states.worker.Health = 'unhealthy';
  f.states.frontend.Health = 'unhealthy';
  const diagnostics = await collectRuntimeDiagnostics({}, {}, f.options, f.deps);
  const summary = diagnosticSummary(diagnostics);
  assert.deepEqual(summary.failed, ['frontend', 'worker']);
  assert.match(summary.lines.join('\n'), /4\/6.*就绪/);
  assert.match(summary.lines.join('\n'), /redis:6379 · 连接超时/);
  assert.match(summary.lines.join('\n'), /logs --service worker/);
  assert.match(f.receipt.join('\n'), /Cannot connect to redis/);
  assert.ok(!JSON.stringify(diagnostics).includes('private-'));
  assert.ok(!f.receipt.join('\n').includes('private-'));
  assert.equal(f.calls.filter(([, args]) => args.includes('logs')).length, 2);
  assert.equal(f.calls.filter(([, args]) => args.includes('exec')).length, 1);
  assert.ok(f.calls.every(([, , options]) => options.timeout <= 8000));
  const error = runtimeFailure(new TessmoraError('COMMAND_FAILED', 'docker failed', 'container frontend is unhealthy'), { phase: 'start', diagnostics, logPath: '/private/setup.log' });
  assert.match(error.message, /frontend、worker/);
  assert.match(error.hint, /\/private\/setup.log/);
});

test('healthy containers do not trigger historical log errors or extra network probes', async () => {
  const f = fixture();
  const diagnostics = await collectRuntimeDiagnostics({}, {}, f.options, f.deps);
  assert.deepEqual(diagnosticSummary(diagnostics).failed, []);
  assert.ok(!f.calls.some(([command]) => command === 'compose'));
  assert.ok(!diagnosticSummary(diagnostics).lines.join('\n').includes('No nodes'));
});

test('exited OOM and missing services are distinguished from unhealthy probes', async () => {
  const f = fixture();
  f.states.worker.State = 'exited'; f.states.worker.Health = ''; f.states.worker.exitCode = 137; f.states.worker.oom = true;
  delete f.states.frontend;
  const summary = diagnosticSummary(await collectRuntimeDiagnostics({}, {}, f.options, f.deps));
  assert.deepEqual(summary.failed, ['frontend', 'worker']);
  assert.match(summary.lines.join('\n'), /frontend · missing/);
  assert.match(summary.lines.join('\n'), /内存不足（OOM）/);
  assert.ok(!f.calls.some(([, args]) => args.includes('exec')));
});

test('Docker outage and per-service log failures produce partial diagnostics without masking the failure', async () => {
  const f = fixture();
  f.deps.containers = async () => { throw new TessmoraError('COMMAND_FAILED', 'Docker unavailable', 'password=hidden'); };
  const unavailable = await collectRuntimeDiagnostics({}, {}, f.options, f.deps);
  assert.match(unavailable.unavailable, /Docker unavailable/);
  assert.ok(!unavailable.unavailable.includes('hidden'));
  f.deps.containers = async () => Object.values(f.states);
  f.states.worker.Health = 'unhealthy';
  f.deps.compose = async () => { throw new Error('timed out'); };
  const summary = diagnosticSummary(await collectRuntimeDiagnostics({}, {}, f.options, f.deps));
  assert.deepEqual(summary.failed, ['worker']);
  assert.match(summary.lines.join('\n'), /诊断未完整采集/);
  assert.match(summary.lines.join('\n'), /网络探测未完成/);
});

test('logs are bounded and unexpected services and non-container IDs are never inspected', async () => {
  const f = fixture();
  f.states.worker.Health = 'unhealthy'; f.states.worker.ID = '--help';
  f.states.foreign = { Service: 'foreign', State: 'running', ID: 'a'.repeat(64) };
  const compose = f.deps.compose;
  f.deps.compose = async (...args) => args[2].includes('logs') ? 'z'.repeat(50000) : compose(...args);
  const result = await collectRuntimeDiagnostics({}, {}, f.options, f.deps);
  assert.equal(result.services.length, 6);
  assert.equal(result.services.find(row => row.service === 'worker').logs.length, 12000);
  assert.ok(!f.calls.some(([, args]) => args.at(-1) === '--help' || args.at(-1) === 'a'.repeat(64)));
});
