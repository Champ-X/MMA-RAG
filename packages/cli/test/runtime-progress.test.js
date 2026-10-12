import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import stringWidth from 'fast-string-width';
import { fitLine } from '../src/terminal.js';
import { commandFormatter } from '../src/invocation.js';
import { startRuntime } from '../src/runtime.js';
import { MINIO_IMAGE, LEGACY_MINIO_IMAGE } from '../src/runtime-images.js';
import { activitySummary, runtimeFailure, runtimeJournal } from '../src/runtime-progress.js';
import { TessmoraError } from '../src/errors.js';

test('progress fits terminal cells with CJK, emoji, control codes and narrow windows', () => {
  for (const columns of [1, 20, 58, 80, 120]) {
    const text = fitLine('\x1b[31m正在下载\r\n文件 👨‍👩‍👧‍👦 e\u0301' + '依赖包'.repeat(60), columns);
    assert.ok(stringWidth(text) <= columns);
    assert.ok(!/[\r\n\x1b]/.test(text));
    assert.ok(!text.includes('\ufffd'));
  }
});

test('recovery commands reflect the source entry and preserve only instance scope', () => {
  const format = commandFormatter({ home: '/tmp/a b', instance: 'demo', 'credential-file': '/secret.json', proxy: 'https://secret' }, { entry: '/repo/packages/cli/bin/tessmora.js', cwd: '/repo', env: {}, platform: 'linux' });
  assert.equal(format('运行 tessmora setup'), "运行 node packages/cli/bin/tessmora.js setup --home '/tmp/a b' --instance demo");
  assert.ok(!format('tessmora doctor').includes('secret'));
  const global = commandFormatter({}, { entry: '/usr/local/bin/tessmora', env: {} });
  assert.equal(global('tessmora start'), 'tessmora start');
  assert.match(commandFormatter({}, { entry: '/some repo/cli.js', cwd: '/elsewhere', env: {} })('tessmora setup'), /node '\/some repo\/cli.js' setup/);
});

test('raw build noise becomes concise activities without invented percentages', () => {
  const torch = activitySummary('#29 12.15 Downloading https://download-r2.pytorch.org/whl/cpu/torch-2.7.1%2Bcpu.whl (176 MB)');
  assert.match(torch, /Python.*torch/);
  assert.ok(!torch.includes('https://'));
  assert.match(activitySummary('#39 exporting layers'), /写入镜像层/);
  assert.match(activitySummary('#9 CACHED'), /复用/);
  assert.match(activitySummary('sha256:aaaa Downloading 10MB / 90MB'), /10MB \/ 90MB/);
  assert.equal(activitySummary('irrelevant detail'), undefined);
});

test('errors distinguish registry authentication, rate limits, network, disk and unhealthy services', () => {
  for (const [raw, code] of [
    ['quay.io/minio/minio:release HEAD 401 UNAUTHORIZED', 'IMAGE_ACCESS_DENIED'],
    ['429 toomanyrequests', 'IMAGE_RATE_LIMIT'], ['TLS handshake timeout', 'RUNTIME_NETWORK'],
    ['no space left on device', 'DOCKER_DISK_FULL'], ['container is unhealthy', 'SERVICE_START_FAILED'],
    ['the --mount option requires BuildKit', 'BUILDER_MISSING'],
  ]) {
    const result = runtimeFailure(new TessmoraError('COMMAND_FAILED', 'docker failed', raw), { phase: 'storage', target: 'MinIO', logPath: '/private/log' });
    assert.equal(result.code, code);
    assert.ok(result.hint.includes('/private/log'));
    assert.ok(!result.hint.includes(raw));
  }
});

test('runtime logs persist privately and redact credentials and control sequences', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tessmora-journal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = runtimeJournal({ dir });
  journal.write('password=private-value https://user:proxy-password@proxy.example https://example?token=secret \x1b[31mhello');
  journal.close();
  const text = await readFile(journal.path, 'utf8');
  assert.ok(!text.includes('private-value') && !text.includes('proxy-password') && !text.includes('token=secret'));
  assert.ok(!text.includes('\x1b'));
  assert.equal((await stat(journal.path)).mode & 0o777, 0o600);
});

function fixture({ minio = MINIO_IMAGE, cached = [], fail } = {}) {
  const images = new Set(cached), calls = [], logs = [], events = [];
  const state = { source: '/source', step: 2, url: 'http://127.0.0.1:19000' };
  const deps = {
    dockerCheck: async () => {}, claimDataDir: async () => {}, validatePorts: async () => {},
    ensureEnvironment: async () => ({ TESSMORA_MINIO_IMAGE: minio, TESSMORA_BACKEND_IMAGE: 'backend:local', TESSMORA_FRONTEND_IMAGE: 'frontend:local' }),
    run: async (_command, args) => {
      calls.push(args);
      if (args[0] === 'image' && !images.has(args[2])) throw new Error('missing image');
      if (args[0] === 'tag') images.add(args[2]);
    },
    compose: async (_paths, _state, args, options = {}) => {
      calls.push(args);
      if (args.includes('config')) return JSON.stringify({ services: { minio: { image: minio }, qdrant: { image: 'qdrant:v1' }, redis: { image: 'redis:v7' }, backend: { image: 'backend:local' }, frontend: { image: 'frontend:local' } } });
      options.onLine?.('#1 CACHED');
      if (fail?.(args)) throw new TessmoraError('COMMAND_FAILED', 'docker failed', '401 UNAUTHORIZED');
      if (args.includes('build')) {
        if (args.includes('minio')) images.add(MINIO_IMAGE);
        else { images.add('backend:local'); images.add('frontend:local'); }
      }
    },
    saveState: async () => { calls.push(['save']); },
    waitForService: async () => ({ setup: { ready: false } }),
  };
  const options = { journal: { path: '/log', write: line => logs.push(line) }, onProgress: e => events.push(e) };
  return { state, calls, events, deps, options };
}

test('fresh preparation builds pinned storage first and verifies the app after service health', async () => {
  const f = fixture();
  await startRuntime({}, f.state, f.options, f.deps);
  const builds = f.calls.filter(args => args.includes('build'));
  assert.ok(builds[0].includes('minio'));
  assert.deepEqual(builds[1].slice(-2), ['backend', 'frontend']);
  assert.deepEqual(f.events.filter(e => e.state === 'done').map(e => e.phase), ['check', 'storage', 'build', 'start', 'ready']);
  assert.ok(f.calls.find(args => args.includes('up')).includes('--no-build'));
  assert.ok(f.calls.find(args => args.includes('up')).includes('never'));
  assert.ok(!f.calls.some(args => args.includes('--policy')), 'pull --policy is unavailable in minimum supported Compose 2.20');
});

test('cached official MinIO is reused without pulling the inaccessible registry or touching containers', async () => {
  const f = fixture({ cached: [LEGACY_MINIO_IMAGE] });
  await startRuntime({}, f.state, f.options, f.deps);
  assert.ok(f.calls.some(args => args[0] === 'tag' && args[1] === LEGACY_MINIO_IMAGE && args[2] === MINIO_IMAGE));
  assert.ok(!f.calls.some(args => args.includes('minio') && args.includes('build')));
  assert.ok(!f.calls.some(args => args.includes('down') || args.includes('prune')));
});

test('custom storage image failure stops before expensive app builds and names the failed dependency', async () => {
  const f = fixture({ minio: 'private/minio:pinned', fail: args => args.includes('minio') });
  await assert.rejects(startRuntime({}, f.state, f.options, f.deps), error => error.code === 'IMAGE_ACCESS_DENIED' && error.message.includes('MinIO'));
  assert.ok(!f.calls.some(args => args.includes('build')));
});

test('app build checkpoint survives a later startup failure and retry skips completed builds', async () => {
  let failed = false;
  const f = fixture({ fail: args => { if (args.includes('up') && !failed) { failed = true; return true; } } });
  await assert.rejects(startRuntime({}, f.state, f.options, f.deps));
  assert.equal(f.state.runtimeBuilt, true);
  assert.ok(f.calls.findIndex(args => args[0] === 'save') < f.calls.findIndex(args => args.includes('up')));
  f.calls.length = 0;
  await startRuntime({}, f.state, f.options, f.deps);
  assert.ok(!f.calls.some(args => args.includes('build')));
});
