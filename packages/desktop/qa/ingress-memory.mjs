// macOS pressure test. Pause only the worker in a newly created QA workspace to isolate ingress RSS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { mkdtemp, mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { startLocalWorkspace } from '../runtime/manager.mjs';
if (process.platform !== 'darwin') throw Error('This RSS sampler uses macOS ps.');
const [runtime, media, output] = process.argv.slice(2).map(v => resolve(v));
await mkdir(output, { recursive: true });
const workspace = await mkdtemp(join(output, 'isolated-'));
const local = await startLocalWorkspace({ workspaceDir: workspace, runtimeDir: runtime });
const headers = { authorization: 'Bearer ' + local.token };
let worker, crashed = false;
try {
  const log = await readFile(join(workspace, 'logs/api.log'), 'utf8');
  const pid = Number(log.match(/Started server process \[(\d+)\]/)?.[1]);
  const field = (id, name) => Number(execFileSync('/bin/ps', ['-p', String(id), '-o', name + '='], { encoding: 'utf8' }).trim());
  assert(pid > 1);
  const host = field(pid, 'ppid');
  const launch = (await readdir(join(workspace, 'temp'))).find(s => s.startsWith('launch-'));
  worker = Number(await readFile(join(workspace, 'temp', launch, 'worker-ready'), 'utf8'));
  assert.equal(field(host, 'ppid'), process.pid);
  assert.equal(field(worker, 'ppid'), host);
  process.kill(worker, 'SIGSTOP');
  const kb = await (await fetch(local.url + '/api/knowledge/', { method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'QA ingress' }) })).json();
  assert(kb.id);
  const seed = await readFile(media);
  const bytes = 128 * 1024 * 1024;
  const ids = [];
  const samples = [];
  for (const count of [1, 4]) {
    const form = new FormData();
    const group = [];
    form.set('kb_id', kb.id);
    for (let i = 0; i < count; i++) {
      const name = 'recording-' + count + '-' + i + '.mp4';
      const path = join(output, name);
      const file = await open(path, 'wx');
      try {
        const box = Buffer.alloc(9);
        box.writeUInt32BE(bytes - seed.length);
        box.write('free', 4); box[8] = count * 10 + i;
        await file.writeFile(Buffer.concat([seed, box]));
        await file.truncate(bytes);
      } finally { await file.close(); }
      form.append('files', await openAsBlob(path), name);
      group.push(randomUUID());
    }
    ids.push(...group);
    form.set('request_ids', JSON.stringify(group));
    const baseline = field(pid, 'rss');
    let peak = baseline, active = true;
    const sample = (async () => { while (active) { peak = Math.max(peak, field(pid, 'rss')); await wait(75); } })();
    const started = performance.now();
    let result;
    try {
      const response = await fetch(local.url + '/api/upload/batch/start', { method: 'POST', headers, body: form });
      assert.equal(response.status, 202);
      result = await response.json();
    } finally { active = false; await sample; }
    assert.equal(result.accepted_count, count);
    assert.deepEqual(result.results.map(r => r.processing_id), group);
    samples.push({ count, bytesPerFile: bytes, elapsedMs: Math.round(performance.now() - started), baselineKiB: baseline, peakKiB: peak, deltaKiB: peak - baseline });
  }
  // Host is a direct child of this test process. Its death must close the listeners and keep accepted inputs.
  process.kill(host, 'SIGKILL'); crashed = true;
  await local.closed;
  await assert.rejects(fetch(local.url + '/health'));
  const manifest = JSON.parse(await readFile(join(runtime, 'runtime.json')));
  const inspection = execFileSync(join(runtime, manifest.executables.python), ['-I', '-c', [
    'import json, pathlib, sqlite3, sys',
    'root = pathlib.Path(sys.argv[1]) / "state" / "ingestion"',
    'db = sqlite3.connect(root / "jobs.sqlite3")',
    'rows = db.execute("select id,state,digest from jobs order by id").fetchall()',
    'print(json.dumps([[i,s,(root/"spool"/d).stat().st_size] for i,s,d in rows]))',
  ].join('\n'), workspace], { encoding: 'utf8' });
  const rows = JSON.parse(inspection);
  assert.deepEqual(rows.map(r => r[0]), ids.sort());
  assert(rows.every(r => r[1] === 'queued' && r[2] === bytes));
  await writeFile(join(output, 'report.json'), JSON.stringify({ case: 'upload-ingress', platform: process.platform, samples, durableItemsAfterCrash: rows.length, maxIngressDeltaKiB: 131072 }, null, 2));
  assert(samples.every(r => r.deltaKiB < 131072), 'API acceptance RSS exceeded the 128 MiB candidate budget');
  console.log(JSON.stringify(samples));
} finally {
  if (!crashed) {
    if (worker) { try { process.kill(worker, 'SIGCONT'); } catch {} }
    await local.stop();
  }
}
