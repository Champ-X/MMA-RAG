import { WorkspaceError } from './workspaces.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile);

export async function transferCommand(app, args) {
  const runtime = !app.isPackaged && process.env.TESSMORA_RUNTIME_DIR || join(process.resourcesPath, 'runtime');
  const manifest = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'));
  const python = join(runtime, manifest.executables.python);
  try {
    const { stdout } = await exec(python, ['-B', '-E', '-s', '-m', 'app.modules.desktop_transfer', ...args],
      { cwd: join(runtime, 'backend'), windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const response = JSON.parse(stdout.trim().split('\n').at(-1));
    if (!response.ok) throw new Error();
    return response;
  } catch (error) {
    let detail;
    try { detail = JSON.parse(String(error.stderr).trim().split('\n').at(-1)).message; } catch { /* Keep fallback below. */ }
    throw new WorkspaceError('TRANSFER_FAILED', detail || '工作区传输未完成，请检查目录、可用空间和归档完整性。');
  }
}

export async function backupWorkspace({ app, dialog, store, stopLocalWorkspaces }) {
  const selection = await dialog.showOpenDialog({ title: '选择已登记的本地工作区', properties: ['openDirectory'] });
  if (selection.canceled) return;
  const workspace = await realpath(selection.filePaths[0]);
  const profile = (await store.read()).workspaces.find(p => p.mode === 'local' && p.directory === workspace);
  if (!profile) throw new WorkspaceError('WORKSPACE_MISSING', '请先在启动器中打开一次要备份的本地工作区。');
  const target = await dialog.showSaveDialog({ title: '备份到新文件', defaultPath: 'Tessmora-' + profile.id + '.zip',
    filters: [{ name: 'Tessmora 工作区备份', extensions: ['zip'] }] });
  if (target.canceled) return;
  const choice = await dialog.showMessageBox({ buttons: ['取消', '备份'], cancelId: 0, defaultId: 1, message: '关闭此工作区并创建备份？',
    detail: '应用将保存会话、停止本地进程，并校验备份中的资料。恢复后需要重新授权模型服务。' });
  if (choice.response !== 1) return;
  const temporary = await mkdtemp(join(tmpdir(), 'tessmora-backup-'));
  try {
    const archives = await stopLocalWorkspaces(temporary, profile.id);
    const history = archives?.get?.(profile.id) ?? archives?.[profile.id];
    await transferCommand(app, ['backup', '--workspace', workspace, '--output', target.filePath, ...(history ? ['--client-history', history] : [])]);
    await transferCommand(app, ['verify', '--archive', target.filePath]);
    await dialog.showMessageBox({ message: '备份已通过校验。', detail: target.filePath + (history ? '' : '\n此备份未附客户端会话。需要时可从工作区设置单独导出。') });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function restoreWorkspace({ app, dialog, store, showLauncher }) {
  const archive = await dialog.showOpenDialog({ title: '打开 Tessmora 工作区备份', properties: ['openFile'],
    filters: [{ name: 'Tessmora 工作区备份', extensions: ['zip'] }] });
  if (archive.canceled) return;
  const selection = await dialog.showSaveDialog({ title: '指定一个新的工作区目录', buttonLabel: '恢复到此目录',
    defaultPath: join(dirname(archive.filePaths[0]), 'Tessmora-restored') });
  if (selection.canceled) return;
  const result = await transferCommand(app, ['restore', '--archive', archive.filePaths[0], '--destination', selection.filePath]);
  const profile = await store.add({ mode: 'local', name: basename(selection.filePath).slice(0, 80), directory: selection.filePath });
  await store.bindIdentity(profile.id, result.workspace_id);
  await showLauncher();
  await dialog.showMessageBox({ message: '已恢复到新工作区。', detail: selection.filePath +
    (result.client_history_path ? '\n在工作区设置中导入附带的会话归档：' + result.client_history_path : '') + '\n打开工作区后重新配置模型凭证。' });
}
