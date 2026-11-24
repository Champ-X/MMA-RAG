import { WorkspaceError } from './workspaces.mjs';
import { transferCommand } from './transfer.mjs';
import { access, mkdir, mkdtemp, readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { fileDigest, matchUpdate, newer, verifyRelease } from '../release/policy.mjs';

let busy = false;
async function backups({ app, store, stopLocalWorkspaces }) {
  const base = join(app.getPath('userData'), 'pre-update-backups');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const destination = await mkdtemp(join(base, app.getVersion() + '-'));
  const histories = await stopLocalWorkspaces(destination);
  const profiles = (await store.read()).workspaces.filter(p => p.mode === 'local');
  for (const profile of profiles) {
    try { await access(join(profile.directory, 'workspace.json')); }
    catch (error) {
      if (error.code === 'ENOENT' && !profile.serverId) continue;
      throw new WorkspaceError('UPDATE_UNAVAILABLE', '无法读取已登记的工作区。请先接入它所在的磁盘，再重试更新。');
    }
    const archive = join(destination, profile.id + '.zip');
    const history = histories?.get?.(profile.id) ?? histories?.[profile.id];
    try {
      await transferCommand(app, ['backup', '--workspace', profile.directory, '--output', archive, ...(history ? ['--client-history', history] : [])]);
      await transferCommand(app, ['verify', '--archive', archive]);
    } catch {
      throw new WorkspaceError('UPDATE_UNAVAILABLE', '工作区备份未完成。请检查工作区是否仍被占用，并确认磁盘空间后重新打开工作区。');
    }
  }
  return destination;
}
async function run({ app, dialog, store, stopLocalWorkspaces, beginInstall }) {
  const message = message => dialog.showMessageBox({ type: 'info', message, buttons: ['好'] });
  const trust = await readFile(join(process.resourcesPath, 'release-trust.json'), 'utf8').catch(e => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (!trust || !app.isPackaged) return message('这个内部构建使用本地安装包更新。正式签名版会在这里检查更新。');
  const { feed, publicKey } = JSON.parse(trust);
  const manifest = await fetch(new URL('release.json', feed), { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!manifest.ok) throw new WorkspaceError('UPDATE_UNAVAILABLE', '无法读取发行清单，请检查网络。');
  let size = 0;
  const chunks = [];
  for await (const chunk of manifest.body) {
    size += chunk.length;
    if (size > 65536) throw new WorkspaceError('UPDATE_UNAVAILABLE', '更新清单超出长度限制。');
    chunks.push(chunk);
  }
  let signed;
  try { signed = verifyRelease(JSON.parse(Buffer.concat(chunks).toString()), publicKey, process.platform + '-' + process.arch); }
  catch { throw new WorkspaceError('UPDATE_INVALID', '更新清单签名或版本校验失败。当前程序可继续使用。'); }
  if (!newer(signed.version, app.getVersion())) return message('当前已是此渠道的最新版本。');
  const { default: updaterPackage } = await import('electron-updater');
  const updater = updaterPackage.autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.disableWebInstaller = true;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.setFeedURL({ provider: 'generic', url: feed });
  const check = await updater.checkForUpdates();
  if (!check?.isUpdateAvailable) throw new WorkspaceError('UPDATE_UNAVAILABLE', '发布渠道尚未提供匹配的更新。');
  let artifact;
  try { artifact = matchUpdate(signed, check.updateInfo); }
  catch { throw new WorkspaceError('UPDATE_INVALID', '下载信息与签名清单不一致。当前程序可继续使用。'); }
  const choice = await dialog.showMessageBox({ type: 'question', buttons: ['稍后', '下载、备份并安装'], defaultId: 0, cancelId: 0,
    message: '安装 Tessmora ' + signed.version + '？',
    detail: '下载约 ' + Math.ceil(artifact.size / 1048576) + ' MiB。校验通过后将停止本地任务、备份工作区并重启。' });
  if (choice.response !== 1) return;
  const disk = await statfs(app.getPath('userData'));
  if (disk.bavail * disk.bsize < artifact.size * 2) throw new WorkspaceError('UPDATE_UNAVAILABLE', '可用空间不足以暂存并验证此安装包。');
  let downloaded;
  const collect = event => { downloaded = event.downloadedFile; };
  updater.on('update-downloaded', collect);
  try {
    const paths = await updater.downloadUpdate();
    downloaded ||= paths[0];
  } finally { updater.removeListener('update-downloaded', collect); }
  if (!downloaded) throw new WorkspaceError('UPDATE_UNAVAILABLE', '未找到已下载的安装包。');
  const digest = await fileDigest(downloaded);
  if (digest.sha512 !== artifact.sha512 || digest.size !== artifact.size) throw new WorkspaceError('UPDATE_UNAVAILABLE', '安装包完整性校验失败。');
  await backups({ app, store, stopLocalWorkspaces });
  beginInstall();
  updater.quitAndInstall();
}
export async function checkForUpdates(context) {
  if (busy) return;
  busy = true;
  try { await run(context); } finally { busy = false; }
}
