// Launch the actual packaged executable with a disposable profile and inspect its Chromium UI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { WorkspaceStore } from '../app/workspaces.mjs';

const binary = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'Tessmora installed '));
const userData = join(root, 'profile');
const workspace = join(root, '测试 workspace');
await mkdir(workspace);
const store = new WorkspaceStore(userData);
const profile = await store.add({ mode: 'local', directory: workspace, name: 'QA local' });
const child = spawn(binary, ['--user-data-dir=' + userData, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
  { stdio: 'ignore', windowsHide: false });
const closed = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
let browser;
async function until(operation, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until && child.exitCode === null && !child.signalCode) {
    const result = await operation();
    if (result) return result;
    await delay(200);
  }
  throw new Error('Packaged desktop UI did not reach the expected state');
}
try {
  const port = await until(async () => (await readFile(join(userData, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0]);
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const pages = () => browser.contexts().flatMap(c => c.pages());
  const launcher = await until(async () => pages().find(p => p.url().startsWith('file:')));
  await launcher.locator('.workspace-open').filter({ hasText: 'QA local' }).click();
  const ui = await until(async () => pages().find(p => p.url().startsWith('tessmora://' + profile.id)));
  await ui.waitForLoadState('domcontentloaded');
  const result = await ui.evaluate(async () => {
    const call = async (path, init) => {
      const res = await fetch(path, init);
      if (!res.ok) throw Error(path + ' returned ' + res.status);
      return res.json();
    };
    const info = await call('/api/desktop/capabilities');
    const storage = await call('/api/setup/storage');
    const before = await call('/api/setup/status');
    const kb = await call('/api/knowledge/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Installed synthetic library' }) });
    const catalog = await call('/api/knowledge/');
    return { info, storage, setupRequired: before.setup_required, kbFound: JSON.stringify(catalog).includes(kb.id) };
  });
  assert(result.setupRequired && result.storage.success && result.kbFound);
  await ui.screenshot({ path: join(output, 'installed-workspace.png') });
  await writeFile(join(output, 'report.json'), JSON.stringify({ platform: process.platform, arch: process.arch, ...result }, null, 2));
  await launcher.evaluate(() => document.getElementById('quit').click());
  const exit = await Promise.race([closed, delay(35000, 'timeout', { ref: false })]);
  assert.equal(exit.code, 0);
  console.log('Installed launcher, local workspace, authenticated storage, created KB and orderly quit passed.');
} finally {
  if (child.exitCode === null && !child.signalCode) child.kill();
  await browser?.close().catch(() => {});
}
