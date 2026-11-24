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
// An optional restored workspace must be a disposable result of the transfer QA.
const workspace = process.argv[4] ? resolve(process.argv[4]) : join(root, '测试 workspace');
if (!process.argv[4]) await mkdir(workspace);
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
  await ui.locator('a[href="/knowledge"]').first().click();
  await ui.getByText('Installed synthetic library', { exact: true }).first().waitFor({ timeout: 20000 });
  await ui.screenshot({ path: join(output, 'installed-library.png') });
  result.libraryOpenedWithoutProviderKeys = true;
  if (process.argv[4]) {
    const manifest = JSON.parse(await readFile(resolve(process.argv[5]), 'utf8'));
    result.restored = await ui.evaluate(async () => {
      const catalog = (await (await fetch('/api/knowledge/')).json()).knowledge_bases;
      const hashes = {}, locators = {};
      for (const name of ['manual.pdf', 'recording.mp4']) {
        const kb = catalog.find(k => k.name === 'Synthetic ' + name);
        const files = (await (await fetch('/api/knowledge/' + kb.id + '/files')).json()).files;
        const original = files.find(f => f.name === name);
        const path = '/api/knowledge/' + kb.id + '/files/' + original.id + '/stream';
        const bytes = await (await fetch(path)).arrayBuffer();
        hashes[name] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        if (name.endsWith('.pdf')) { locators.pdf = path + '#page=2'; continue; }
        const response = await fetch('/api/chat/reference-video-url', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kb_id: kb.id, file_path: 'videos/' + original.id + '_' + name }) });
        const url = (await response.json()).video_url;
        const range = await fetch(url, { headers: { range: 'bytes=0-31' } });
        if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 32) throw Error('Original media range was not served');
        const video = document.createElement('video');
        video.muted = true; video.preload = 'auto';
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Video seek timed out')), 10000);
          video.onloadedmetadata = () => { video.currentTime = 7; };
          video.onerror = () => { clearTimeout(timer); reject(Error('Bundled Chromium could not decode the original video')); };
          video.onseeked = () => { clearTimeout(timer); resolve(); };
          video.src = url;
        });
        const frame = document.createElement('canvas'); frame.width = 320; frame.height = 180;
        const ctx = frame.getContext('2d'); ctx.drawImage(video, 0, 0, 320, 180);
        const [red, green, blue] = ctx.getImageData(160, 90, 1, 1).data;
        if (blue < 180 || red > 60 || green > 60) throw Error('Expected blue rectangle at seven seconds');
        locators.videoTime = video.currentTime; locators.rgb = [red, green, blue];
        video.removeAttribute('src'); video.load();
      }
      return { hashes, locators };
    });
    for (const [name, digest] of Object.entries(result.restored.hashes))
      assert.equal(digest, manifest.files.find(f => f.path === name).sha256);
  }
  await writeFile(join(output, 'report.json'), JSON.stringify({ platform: process.platform, arch: process.arch, ...result }, null, 2));
  await launcher.evaluate(() => document.getElementById('quit').click());
  const exit = await Promise.race([closed, delay(35000, 'timeout', { ref: false })]);
  assert.equal(exit.code, 0);
  console.log('Installed launcher, local workspace, authenticated storage, created KB and orderly quit passed.');
} finally {
  if (child.exitCode === null && !child.signalCode) child.kill();
  await browser?.close().catch(() => {});
}
