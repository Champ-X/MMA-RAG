import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locations, saveState, readState, ensureEnvironment, readEnvironment, projectName, normalizeUrl, validateDataDir, dotenvValue } from '../src/config.js';
import { redact, publicError } from '../src/errors.js';
import { parseCapabilities, parsePort, requiredProviders } from '../src/wizard.js';

test('private state and runtime credentials persist independently of package installation', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = locations({ home });
  const state = await saveState(paths, { mode: 'local', step: 2, dataDir: join(home, "knowledge's $folder"), port: 13001, storagePort: 19000 });
  const first = await ensureEnvironment(paths, state);
  const second = await ensureEnvironment(paths, { ...state, port: 13002, step: 3 });
  assert.equal(first.TESSMORA_SETUP_TOKEN, second.TESSMORA_SETUP_TOKEN);
  assert.equal(first.TESSMORA_MINIO_PASSWORD, second.TESSMORA_MINIO_PASSWORD);
  assert.equal((await readEnvironment(paths)).TESSMORA_DATA_DIR, state.dataDir);
  assert.equal((await readState(paths)).port, 13001);
  assert.equal((await stat(paths.env)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.manifest)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.dir)).mode & 0o777, 0o700);
  assert.ok(!(await readFile(paths.manifest, 'utf8')).includes(first.TESSMORA_SETUP_TOKEN));
});

test('missing runtime secret of existing installation is never regenerated', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await assert.rejects(ensureEnvironment(locations({ home }), { mode: 'local', step: 4, dataDir: join(home, 'data') }), { code: 'RUNTIME_ENV_MISSING' });
  await assert.rejects(ensureEnvironment(locations({ home }), { mode: 'local', step: 0, runtimeCreated: true, dataDir: join(home, 'data') }), { code: 'RUNTIME_ENV_MISSING' });
  const paths = locations({ home });
  const state = { mode: 'local', step: 2, dataDir: join(home, 'data') };
  await ensureEnvironment(paths, state);
  const partial = (await readFile(paths.env, 'utf8')).replace(/^TESSMORA_MINIO_PASSWORD=.*\n/m, '');
  await writeFile(paths.env, partial);
  await assert.rejects(ensureEnvironment(paths, { ...state, step: 3 }), { code: 'RUNTIME_ENV_MISSING' });
  assert.equal(await readFile(paths.env, 'utf8'), partial);
});

test('Compose single-quoted paths preserve Windows backslashes without interpolation', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-dotenv-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = join(home, 'runtime.env');
  const value = String.raw`C:\Users\test\knowledge's $folder`;
  assert.equal(dotenvValue(value), String.raw`'C:\Users\test\knowledge\'s $folder'`);
  await writeFile(env, `TESSMORA_DATA_DIR=${dotenvValue(value)}\n`);
  assert.equal((await readEnvironment({ env })).TESSMORA_DATA_DIR, value);
});

test('instance names cannot escape config path and projects stay isolated', () => {
  assert.throws(() => locations({ instance: '../escape' }), { code: 'INVALID_INSTANCE' });
  assert.notEqual(projectName(locations({ home: '/tmp/a' })), projectName(locations({ home: '/tmp/b' })));
  assert.match(projectName(locations({ home: '/tmp/a' })), /^tessmora-default-[a-f0-9]{8}$/);
});

test('capabilities, URLs and ports reject ambiguous or unsafe inputs', () => {
  assert.deepEqual(parseCapabilities('audio,image,audio'), ['text', 'audio', 'image']);
  assert.throws(() => parseCapabilities('other'), { code: 'INVALID_CAPABILITY' });
  assert.throws(() => parsePort('3001junk'), { code: 'INVALID_PORT' });
  assert.throws(() => normalizeUrl('https://user:key@example.com'), { code: 'INVALID_URL' });
  assert.throws(() => normalizeUrl('file:///etc/passwd'), { code: 'INVALID_URL' });
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
  assert.ok(validateDataDir('/'));
});

test('credential-like and known secret values are redacted from user errors', () => {
  const redacted = redact('Authorization=Bearer sk-abcdefghijklmnop API_KEY=abc123 password=hello private-token', ['private-token']);
  for (const secret of ['sk-abcdefghijklmnop', 'abc123', 'hello', 'private-token']) assert.ok(!redacted.includes(secret));
  assert.ok(!JSON.stringify(publicError(new Error('private-token'), ['private-token'])).includes('private-token'));
});

test('media credential requirements follow actual selected task routes', () => {
  const status = { checks: [{ task: 'final_generation', provider: 'deepseek' }, { task: 'embedding', provider: 'siliconflow' }], task_models: { image_captioning: 'caption-model', audio_transcription: 'aliyun_bailian:audio', video_parsing: 'aliyun_bailian:video' }, models: [{ id: 'caption-model', provider: 'siliconflow' }] };
  assert.deepEqual(requiredProviders(['text', 'image'], status), ['deepseek', 'siliconflow']);
  assert.deepEqual(requiredProviders(['text', 'video'], status), ['deepseek', 'siliconflow', 'aliyun_bailian']);
  assert.deepEqual(requiredProviders(['text', 'image'], { ...status, capability_checks: { text: status.checks, image: [{ task: 'pi_vision', provider: 'aliyun_bailian' }, { task: 'image_captioning', provider: 'siliconflow' }] } }), ['deepseek', 'siliconflow', 'aliyun_bailian']);
});
