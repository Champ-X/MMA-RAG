// Native internal acceptance driver. Every run owns a fresh report directory.
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { case: { type: 'string' }, target: { type: 'string' }, input: { type: 'string' }, out: { type: 'string' } } });
if (!values.case || !values.target || !values.input || !values.out) throw Error('Specify --case --target --input --out.');
const target = process.platform === 'darwin' ? 'macos-' + process.arch : process.platform === 'win32' ? 'windows-' + process.arch : process.platform + '-' + process.arch;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = resolve(values.out);
const input = JSON.parse(await readFile(resolve(values.input), 'utf8'));
await mkdir(out, { recursive: false });
const receipt = { test: values.case, requestedTarget: values.target, actualTarget: target, started: new Date().toISOString(), status: 'running', steps: [] };
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' };
async function step(exe, args, label) {
  const log = await open(join(out, label + '.log'), 'wx');
  const start = Date.now();
  try {
    const status = await new Promise((accept, reject) => {
      const proc = spawn(exe, args, { cwd: root, env, stdio: ['ignore', log.fd, log.fd] });
      proc.on('error', reject); proc.on('close', accept);
    });
    receipt.steps.push({ label, status, durationMs: Date.now() - start });
    if (status !== 0) throw Error(label + ' failed');
  } finally { await log.close(); }
}
try {
  if (target !== values.target) throw Error('Requested native platform unavailable');
  const runtime = input.runtimeDir ? resolve(input.runtimeDir) : null;
  const native = runtime && JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'));
  const py = native && join(runtime, native.executables.python);
  env.PYTHONPATH = join(root, 'backend');
  if (runtime) env.TESSMORA_TEST_QDRANT = join(runtime, native.executables.qdrant);
  const qa = name => join(root, 'packages/desktop/qa', name);
  switch (values.case) {
    case 'native':
      await step(py, [qa('fixtures.py'), '--runtime', runtime, '--output', join(out, 'fixtures')], 'fixtures');
      await step(process.execPath, [qa('native-workspace.mjs'), runtime, out], 'native-workspace');
      break;
    case 'remote':
      await step(process.execPath, [qa('electron-smoke.mjs'), '--out', join(out, 'windows')], 'electron-remote');
      break;
    case 'local-storage':
      await step(process.execPath, [qa('installed-window.mjs'), resolve(input.installedBinary), join(out, 'windows')], 'installed-local');
      break;
    case 'recovery':
      await step(py, ['-m', 'pytest', '-q', 'backend/tests/test_desktop_ingestion_queue.py'], 'job-recovery');
      if (target === 'macos-arm64' && input.videoFixture) await step(process.execPath, [qa('ingress-memory.mjs'), runtime, resolve(input.videoFixture), join(out, 'uploads')], 'ingress');
      break;
    case 'migration':
      await step(py, ['-m', 'pytest', '-q', 'backend/tests/test_desktop_transfer.py'], 'transfer-native');
      break;
    case 'parity':
      if (!input.controlReport || !input.desktopReport) throw Error('Provide matched server and desktop evaluation runs for comparison');
      await step(py, ['scripts/rag-eval', 'retrieval', 'compare', '--baseline', resolve(input.controlReport), '--candidate', resolve(input.desktopReport), '--require-matched', '--output', join(out, 'comparison')], 'matched-retrieval');
      break;
    case 'release':
      await step(process.execPath, ['--test', 'packages/desktop/test/release.test.mjs'], 'release-policy');
      await step(process.execPath, [qa('installed-window.mjs'), resolve(input.installedBinary), join(out, 'windows')], 'installed-window');
      break;
    default: throw Error('Unknown acceptance case');
  }
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed'; receipt.reason = error.message;
  process.exitCode = 1;
} finally {
  receipt.finished = new Date().toISOString();
  await writeFile(join(out, 'report.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(receipt.status, out);
}
