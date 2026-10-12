import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm, readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { availablePort, portAvailable, claimDataDir, composeArgs, run } from '../src/docker.js';
import { locations, projectName } from '../src/config.js';

test('port conflicts choose another port without touching the listening process', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const occupied = server.address().port;
  assert.equal(await portAvailable(occupied), false);
  const next = await availablePort(occupied);
  assert.ok(next > occupied);
  // The probe is not a reservation: parallel network tests can claim an ephemeral
  // port immediately after it is released. Assert selection and existing service isolation.
  assert.ok(next < occupied + 100 && next <= 65535);
  assert.equal(server.listening, true);
});

test('a data directory cannot be silently claimed by a second instance', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-data-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const first = locations({ home });
  const second = locations({ home, instance: 'second' });
  const dataDir = join(home, 'data');
  const state = { dataDir, project: projectName(first) };
  await claimDataDir(first, state);
  const original = await readFile(join(dataDir, '.tessmora-instance.json'), 'utf8');
  await claimDataDir(first, state);
  await assert.rejects(claimDataDir(second, { dataDir, project: projectName(second) }), { code: 'DATA_IN_USE' });
  assert.equal(await readFile(join(dataDir, '.tessmora-instance.json'), 'utf8'), original);
});

test('compose arguments scope all commands to private env and instance project', async () => {
  const paths = locations({ home: '/tmp/tessmora-args' });
  const state = { project: projectName(paths), source: process.cwd() };
  const args = await composeArgs(paths, state);
  assert.equal(args[0], '--env-file');
  assert.equal(args[1], paths.env);
  assert.ok(args.includes(projectName(paths)));
  assert.ok(!args.includes('--volumes'));
  assert.ok(!args.includes('down'));
});

test('nonempty unowned data is rejected without a new marker or modified content', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tessmora-unowned-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = locations({ home });
  const dataDir = join(home, 'existing');
  await mkdir(join(dataDir, 'minio'), { recursive: true });
  await writeFile(join(dataDir, 'minio', 'original'), 'existing-user-document');
  await assert.rejects(claimDataDir(paths, { dataDir, project: projectName(paths) }), { code: 'DATA_UNOWNED' });
  assert.equal(await readFile(join(dataDir, 'minio', 'original'), 'utf8'), 'existing-user-document');
  await assert.rejects(access(join(dataDir, '.tessmora-instance.json')), { code: 'ENOENT' });
});

test('log redaction spans subprocess chunks and never emits a partial credential', async () => {
  const emitted = [];
  const output = await run(process.execPath, ['-e', "process.stdout.write('private-'); setTimeout(() => process.stdout.write('credential\\n'), 10)"], { secrets: ['private-credential'], onLine: (line) => emitted.push(line) });
  assert.equal(output, '[redacted]');
  assert.deepEqual(emitted, ['[redacted]']);
});
