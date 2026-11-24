import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { release } from 'node:os';

export async function buildDiagnostics({ app, store, resources = process.resourcesPath }) {
  const platform = process.platform + '-' + process.arch;
  const manifest = await readFile(join(resources, 'runtime', 'runtime.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  const profiles = (await store.read()).workspaces;
  const workspaces = [];
  for (const profile of profiles) {
    if (profile.mode === 'remote') { workspaces.push({ mode: 'remote' }); continue; }
    const logs = [];
    for (const component of ['api', 'worker', 'qdrant']) {
      const metadata = await stat(join(profile.directory, 'logs', component + '.log')).catch(() => null);
      if (metadata?.isFile()) logs.push({ component, bytes: metadata.size, updated: metadata.mtime.toISOString() });
    }
    const entries = await readdir(join(profile.directory, 'state')).catch(() => []);
    workspaces.push({ mode: 'local', components: ['ingestion', 'pi-agent', 'objects-metadata'].filter(e => entries.includes(e)), logs });
  }
  return { format: 1, generatedAt: new Date().toISOString(), appVersion: app.getVersion(), platform,
    osRelease: release(), runtime: { platform: manifest.platform, version: manifest.version, apiProtocol: manifest.apiProtocol }, workspaces };
}
export async function exportDiagnostics({ app, dialog, store }) {
  const choice = await dialog.showSaveDialog({ title: '导出诊断报告', defaultPath: 'tessmora-diagnostics.json',
    filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (choice.canceled) return;
  const data = await buildDiagnostics({ app, store });
  await writeFile(choice.filePath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}
