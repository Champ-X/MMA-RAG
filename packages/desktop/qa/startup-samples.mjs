import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startLocalWorkspace } from '../runtime/manager.mjs';
const [runtime, output] = process.argv.slice(2).map(p => resolve(p));
const readings = [];
let workspace;
for (const phase of ['new','new','new','reopen','reopen','reopen','reopen','reopen']) {
  if (phase === 'new') workspace = await mkdtemp(join(output, 'startup-'));
  const start = performance.now();
  const service = await startLocalWorkspace({ workspaceDir: workspace, runtimeDir: runtime });
  const readyMs = Math.round(performance.now() - start);
  await service.stop();
  readings.push({ phase, readyMs, shutdownMs: Math.round(performance.now() - start) - readyMs });
}
await writeFile(join(output, 'startup-samples.json'), JSON.stringify({ platform: process.platform, arch: process.arch, readings,
  method: 'Native service readiness without model credentials. OS file caches were not flushed.' }, null, 2));
