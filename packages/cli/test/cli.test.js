import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { locations, saveState, ensureEnvironment, projectName } from '../src/config.js';
import { availablePort } from '../src/docker.js';

const bin = fileURLToPath(new URL('../bin/tessmora.js', import.meta.url));
function cli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, NO_COLOR: '1' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('non-TTY setup exits with actionable JSON instead of hanging on a prompt', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-notty-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const result = await cli(['setup', '--home', home, '--json']);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).error.code, 'INTERACTIVE_REQUIRED');
  assert.ok(!result.stdout.includes('\u001b'));
});

test('an unfinished instance resumes setup and explicit start gives recovery guidance', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-early-resume-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await saveState(locations({ home }), { mode: 'local', step: 1, stage: 'capabilities' });
  const resumed = await cli(['--home', home, '--json']);
  assert.equal(JSON.parse(resumed.stdout).error.code, 'INTERACTIVE_REQUIRED');
  const started = await cli(['start', '--home', home, '--json', '--no-open']);
  assert.equal(JSON.parse(started.stdout).error.code, 'SETUP_INCOMPLETE');
  assert.match(JSON.parse(started.stdout).error.hint, /node .*tessmora\.js setup --home /);
  assert.ok(JSON.parse(started.stdout).error.hint.includes(home));
});

test('incomplete setup and doctor both explain Docker recovery in JSON without host mutations', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-docker-doctor-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = locations({ home });
  await saveState(paths, { mode: 'local', step: 2, stage: 'runtime', capabilities: ['text'] });
  const fakeBin = join(home, 'bin'); await mkdir(fakeBin);
  const fakeDocker = join(fakeBin, 'docker');
  const callLog = join(home, 'calls.jsonl');
  await writeFile(fakeDocker, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nconst args=process.argv.slice(2); appendFileSync(${JSON.stringify(callLog)},JSON.stringify(args)+'\\n');\nif(args[0]==='--version') console.log('Docker 29.0.0'); else if(args[0]==='context') console.log('default'); else { console.error('Cannot connect to the Docker daemon'); process.exitCode=1; }\n`);
  await chmod(fakeDocker, 0o755);
  const env = { PATH: `${fakeBin}:${process.env.PATH}`, DOCKER_HOST: '', DOCKER_CONTEXT: '' };
  const setup = await cli(['setup', '--home', home, '--yes', '--json', '--no-open'], env);
  assert.equal(setup.code, 1);
  const error = JSON.parse(setup.stdout).error;
  assert.equal(error.code, 'DOCKER_NOT_RUNNING');
  assert.match(error.hint, /https:\/\/docs.docker.com\//);
  assert.equal(JSON.parse(await readFile(paths.manifest, 'utf8')).step, 2);
  const doctor = await cli(['doctor', '--home', home, '--json'], env);
  assert.equal(doctor.code, 1);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.configured, false);
  assert.equal(report.checks.find(check => check.name === 'docker').code, 'DOCKER_NOT_RUNNING');
  assert.ok((await readFile(callLog, 'utf8')).trim().split('\n').map(JSON.parse).every(([command]) => ['--version', 'version', 'context'].includes(command)));
});

test('remote setup performs only read requests; stop cannot mutate remote service', async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push([req.method, req.url]);
    assert.equal(req.headers['x-tessmora-setup-token'], undefined);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? { status: 'healthy' } : { ready: true, capabilities: ['text'] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const home = await mkdtemp(join(tmpdir(), 'tessmora-remote-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const result = await cli(['setup', '--home', home, '--mode', 'remote', '--url', `http://127.0.0.1:${server.address().port}`, '--yes', '--no-open', '--json']);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).stage, 'ready');
  assert.ok(requests.every(([method]) => method === 'GET'));
  const stop = await cli(['stop', '--home', home, '--json']);
  assert.equal(JSON.parse(stop.stdout).error.code, 'REMOTE_READ_ONLY');
});

test('unmanaged remote connection preserves server ready=false without forcing managed setup', async (t) => {
  const server = createServer((req, res) => {
    assert.equal(req.method, 'GET');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? { status: 'healthy' } : { managed: false, ready: false, capabilities: ['text'] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const home = await mkdtemp(join(tmpdir(), 'tessmora-legacy-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const result = await cli(['setup', '--home', home, '--mode', 'remote', '--url', `http://127.0.0.1:${server.address().port}`, '--yes', '--no-open', '--json']);
  const output = JSON.parse(result.stdout);
  assert.equal(result.code, 0);
  assert.equal(output.reachable, true);
  assert.equal(output.ready, false);
  assert.equal(output.stage, 'connected');
  assert.ok(result.stderr.includes('源码服务'));
  assert.ok(!result.stderr.includes('远程服务尚未完成配置'));
});

test('doctor detects storage outages even when health and an empty knowledge list look healthy', async (t) => {
  let storageReady = false;
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    assert.equal(req.method, 'GET');
    res.setHeader('Content-Type', 'application/json');
    const body = req.url === '/health' ? { status: 'healthy' } : req.url === '/api/setup/status' ? { ready: true, setup_required: false } :
      req.url === '/api/setup/storage' ? { success: storageReady, checks: [
        { name: 'qdrant', success: storageReady, message: 'Qdrant HTTP 502', hint: '检查内部服务代理设置' }, { name: 'minio', success: true },
      ] } : { knowledge_bases: [] };
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const home = await mkdtemp(join(tmpdir(), 'tessmora-storage-doctor-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await saveState(locations({ home }), { mode: 'remote', url: `http://127.0.0.1:${server.address().port}`, step: 6 });
  const failed = await cli(['doctor', '--home', home, '--json']);
  assert.equal(failed.code, 1);
  const storage = JSON.parse(failed.stdout).checks.find(row => row.name === 'knowledge_storage');
  assert.equal(storage.success, false);
  assert.equal(storage.code, 'STORAGE_UNAVAILABLE');
  assert.match(storage.message, /Qdrant.*502/);
  assert.ok(!requests.includes('/api/knowledge/'));
  storageReady = true;
  const recovered = await cli(['doctor', '--home', home, '--json']);
  assert.equal(recovered.code, 0);
  assert.equal(JSON.parse(recovered.stdout).success, true);
});

test('invalid credentials never persist; model download interruption resumes from saved checkpoint', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-resume-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  let tests = 0, preparations = 0, configSaved = false, interrupted = true, ready = false, storageReady = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === '/health') return res.end('{"status":"healthy"}');
    if (req.url === '/api/setup/storage') return res.end(JSON.stringify({ success: storageReady, checks: [
      { name: 'qdrant', success: storageReady, message: 'Qdrant HTTP 502', hint: '检查代理绕过设置' }, { name: 'minio', success: true },
    ] }));
    if (req.url === '/api/setup/status' || req.method === 'GET' && req.url === '/api/setup/config') return res.end(JSON.stringify({ ready, configured: configSaved, tested: configSaved, prepared: ready, providers: {}, capabilities: ['text'] }));
    if (req.url === '/api/setup/test') {
      tests++;
      const success = body.credentials.deepseek === 'valid-secret';
      return res.end(JSON.stringify({ success, test_receipt: success ? 'receipt' : null, results: [{ provider: 'deepseek', model: 'chat', capability: 'chat', success, message: `bad ${body.credentials.deepseek}` }] }));
    }
    if (req.url === '/api/setup/config') { configSaved = true; return res.end('{"configured":true}'); }
    if (req.url === '/api/setup/prepare') {
      preparations++;
      if (interrupted) return res.end('{"state":"interrupted","models":{"bge_m3":{"state":"interrupted","message":"network interrupted"}}}');
      ready = true; return res.end('{"state":"ready","completed":1,"total":1}');
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const storagePort = await availablePort(19000);
  const fakeBin = join(home, 'bin'); await mkdir(fakeBin);
  const fakeDocker = join(fakeBin, 'docker');
  await writeFile(fakeDocker, `#!${process.execPath}\nconst args=process.argv.slice(2); if(args.includes('ps')) console.log(JSON.stringify([{Service:'frontend',State:'running',Publishers:[{PublishedPort:${port}}]}])); else if(args.includes('config')) console.log(JSON.stringify({services:{backend:{image:'test/backend'},frontend:{image:'test/frontend'},minio:{image:'test/minio'},qdrant:{image:'test/qdrant'},redis:{image:'test/redis'}}})); else if(args.includes('version')) console.log('29.0.0');\n`);
  await chmod(fakeDocker, 0o755);
  const env = { PATH: `${fakeBin}:${process.env.PATH}`, TESSMORA_DEEPSEEK_API_KEY: '', TESSMORA_SILICONFLOW_API_KEY: '' };
  const paths = locations({ home });
  const state = { mode: 'local', step: 2, stage: 'runtime', project: projectName(paths), port, storagePort, dataDir: join(home, 'data'), capabilities: ['text'], url: `http://127.0.0.1:${port}`, backendImage: 'test/backend', frontendImage: 'test/frontend' };
  await saveState(paths, state); await ensureEnvironment(paths, state); await saveState(paths, { ...state, step: 3, stage: 'models' });
  const file = join(home, 'credentials.json'); await writeFile(file, '{"deepseek":"bad-secret","siliconflow":"private-key"}');
  const args = ['setup', '--home', home, '--yes', '--no-open', '--json', '--credential-file', file];
  const storageFailure = await cli(args, env);
  assert.equal(JSON.parse(storageFailure.stdout).error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(tests, 0, 'storage failure must precede paid model probes');
  assert.equal(configSaved, false);
  storageReady = true;
  const invalid = await cli(args, env);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'MODEL_TEST_FAILED', invalid.stdout + invalid.stderr);
  assert.equal(configSaved, false);
  assert.ok(!invalid.stderr.includes('bad-secret'));
  await writeFile(file, '{"deepseek":"valid-secret","siliconflow":"private-key"}');
  const interruptedResult = await cli(args, env);
  assert.equal(JSON.parse(interruptedResult.stdout).error.code, 'MODEL_PREPARE_FAILED', interruptedResult.stdout + interruptedResult.stderr);
  assert.equal(JSON.parse(await readFile(paths.manifest, 'utf8')).step, 4);
  interrupted = false;
  const resumed = await cli(args.slice(1), env);
  assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).stage, 'ready');
  assert.equal(tests, 2, 'resume must not repeat completed credential test');
  const manifest = await readFile(paths.manifest, 'utf8');
  assert.ok(!manifest.includes('valid-secret'));
  assert.ok(!manifest.includes('private-key'));
  // A saved "ready" checkpoint must not hide missing cache or changed model settings.
  ready = false;
  const repaired = await cli(args, env);
  assert.equal(repaired.code, 0, repaired.stdout + repaired.stderr);
  assert.equal(preparations, 3);
  assert.equal(tests, 2, 'missing cache should not retest unchanged credentials');
  configSaved = false; ready = false;
  const reconfigured = await cli(args, env);
  assert.equal(reconfigured.code, 0, reconfigured.stdout + reconfigured.stderr);
  assert.equal(tests, 3, 'changed configuration must be tested before reporting ready');
});
