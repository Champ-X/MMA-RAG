import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, safeStorage, session, shell, Tray } from 'electron';
import { randomUUID } from 'node:crypto';
import { createHistoryExportManager } from './history-export.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { access, mkdir } from 'node:fs/promises';
import { WorkspaceStore, WorkspaceError, normalizeRemoteUrl, validateName } from './workspaces.mjs';
import { CredentialStore } from './credentials.mjs';
import { negotiateWorkspace } from './connection.mjs';
import { createWorkspaceHandler, workspaceOrigin, SCHEME } from './protocol.mjs';

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } }]);
const here = dirname(fileURLToPath(import.meta.url));
if (!app.isPackaged && process.env.TESSMORA_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.TESSMORA_DESKTOP_USER_DATA));
app.setName('Tessmora');
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let launcher, tray, quitting = false, shutdownStarted = false;
let store, credentials, historyExporter;
const workspaceWindows = new Map();
const connections = new Map();
const opening = new Map();
const selectedDirectories = new Set();
const startupControllers = new Set();
const launcherUrl = pathToFileURL(join(here, 'ui/index.html')).href;

function publicError(error) {
  return { code: error instanceof WorkspaceError ? error.code : typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'OPERATION_FAILED',
    message: error instanceof WorkspaceError ? error.message : '操作未完成。请检查服务状态后重试；已有资料已保留。' };
}
function progress(id, event) {
  // Runtime diagnostics stay in the manager; renderer receives only progress fields, never env or credentials.
  const value = { id, phase: String(event?.phase || event?.stage || ''), message: String(event?.message || event?.detail || '正在准备工作区…').slice(0, 500) };
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send('desktop:progress', value);
}
function validLauncher(event) {
  return launcher && !launcher.isDestroyed() && event.sender === launcher.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === launcherUrl;
}
function validWorkspace(event, id) {
  const win = workspaceWindows.get(id);
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) return false;
  try { const url = new URL(event.senderFrame.url); return `${url.protocol}//${url.host}` === workspaceOrigin(id) && !url.pathname.startsWith('/api/'); } catch { return false; }
}
function handle(name, callback) {
  ipcMain.handle(`desktop:${name}`, async (event, value) => {
    if (!validLauncher(event)) return { ok: false, error: { code: 'CALLER_REJECTED', message: '此窗口无权管理工作区。' } };
    try { return { ok: true, value: await callback(value) }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  });
}
function openExternal(url) {
  try {
    const target = new URL(url);
    if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password) void shell.openExternal(target.href);
  } catch { /* Unknown schemes and local files are not opened. */ }
}
function restrictWindow(win, { origin, preview = false } = {}) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (origin && (`${target.protocol}//${target.host}` === origin || url.startsWith(`blob:${origin}/`))) {
        const child = new BrowserWindow({ title: 'Tessmora · 原件', width: 1040, height: 780, show: false,
          webPreferences: { session: win.webContents.session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
        restrictWindow(child, { origin, preview: true });
        child.once('ready-to-show', () => child.show());
        void child.loadURL(url).catch(() => child.close());
      } else openExternal(url);
    } catch { /* Invalid URLs cannot spawn a window. */ }
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('will-navigate', (event, url) => {
    if (origin && (url.startsWith(`${origin}/`) || (preview && url.startsWith(`blob:${origin}/`)))) return;
    if (!origin && url === launcherUrl) return;
    event.preventDefault();
    openExternal(url);
  });
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
}
async function showLauncher() {
  if (launcher && !launcher.isDestroyed()) { launcher.show(); launcher.focus(); return; }
  launcher = new BrowserWindow({ title: 'Tessmora', width: 980, height: 720, minWidth: 760, minHeight: 580, backgroundColor: '#f5f7f5', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:tessmora-launcher' } });
  restrictWindow(launcher);
  launcher.on('close', event => { if (!quitting) { event.preventDefault(); launcher.hide(); } });
  launcher.once('ready-to-show', () => launcher.show());
  await launcher.loadURL(launcherUrl);
}
function frontendDirectory() {
  if (!app.isPackaged && process.env.TESSMORA_FRONTEND_DIR) return resolve(process.env.TESSMORA_FRONTEND_DIR);
  return app.isPackaged ? join(process.resourcesPath, 'frontend') : resolve(here, '../../../frontend/dist');
}
async function openWorkspace(id, suppliedToken, remember = true) {
  if (shutdownStarted || maintenance) throw new WorkspaceError('WORKSPACE_BUSY', '应用正在备份或退出，请完成后再打开工作区。');
  if (suppliedToken) {
    if (opening.has(id)) throw new WorkspaceError('WORKSPACE_BUSY', '工作区正在打开，请稍后重试。');
    const profile = await store.get(id);
    if (profile.mode !== 'remote') throw new WorkspaceError('LOCAL_CREDENTIAL_MANAGED', '本地凭证由应用管理。');
    const info = await negotiateWorkspace({ url: profile.url, token: suppliedToken });
    if (info.serverId) await store.bindIdentity(id, info.serverId);
    await credentials.set(id, suppliedToken, { persist: remember });
    workspaceWindows.get(id)?.destroy();
    connections.set(id, { url: profile.url, token: suppliedToken, info });
  }
  const active = workspaceWindows.get(id);
  if (active && !active.isDestroyed()) {
    if (connections.has(id)) { active.show(); active.focus(); return { id }; }
    active.destroy();
  }
  if (opening.has(id)) return opening.get(id);
  const operation = (async () => {
    const profile = await store.get(id);
    let connection = connections.get(id);
    if (!connection) {
      progress(id, { phase: 'connect', message: profile.mode === 'local' ? '正在准备本地工作区…' : '正在验证工作区连接…' });
      if (profile.mode === 'local') {
        const controller = new AbortController();
        startupControllers.add(controller);
        try {
          const { startLocalWorkspace } = await import('../runtime/manager.mjs');
          connection = await startLocalWorkspace({ workspaceDir: profile.directory, onProgress: event => progress(id, event), signal: controller.signal,
            ...(!app.isPackaged && process.env.TESSMORA_RUNTIME_DIR ? { runtimeDir: resolve(process.env.TESSMORA_RUNTIME_DIR) } : {}) });
        } finally { startupControllers.delete(controller); }
      } else {
        const token = suppliedToken || await credentials.get(id);
        const info = await negotiateWorkspace({ url: profile.url, token });
        if (info.serverId) await store.bindIdentity(id, info.serverId);
        if (suppliedToken) await credentials.set(id, token, { persist: remember });
        connection = { url: profile.url, token, info };
      }
      if (profile.mode === 'local') {
        try {
          const info = await negotiateWorkspace({ url: connection.url, token: connection.token });
          if (!info.serverId) throw new WorkspaceError('PROTOCOL_INCOMPATIBLE', '本地运行包未提供工作区身份，请修复运行环境。');
          await store.bindIdentity(id, info.serverId);
          connection.info = info;
        } catch (error) { await connection.stop?.(); throw error; }
      }
      connections.set(id, connection);
      if (profile.mode === 'local' && connection.closed?.then) {
        const ownedConnection = connection;
        void connection.closed.then(async () => {
          if (shutdownStarted || connections.get(id) !== ownedConnection) return;
          connections.delete(id);
          const stale = workspaceWindows.get(id);
          // Hiding checkpoints renderer history; the next open replaces this stopped connection.
          stale?.hide();
          await showLauncher();
          progress(id, { phase: 'stopped', message: '本地服务已停止。资料已保留，请重新打开工作区；若再次失败，请检查运行包与磁盘空间。' });
        }).catch(() => {});
      }
    }
    await access(join(frontendDirectory(), 'index.html')).catch(() => { throw new WorkspaceError('FRONTEND_MISSING', '桌面界面资源缺失。开发环境请先构建 frontend；已安装应用请重新安装。'); });
    const workspaceSession = session.fromPartition(`persist:tessmora-${id}`);
    if (workspaceSession.protocol.isProtocolHandled && await workspaceSession.protocol.isProtocolHandled(SCHEME)) workspaceSession.protocol.unhandle(SCHEME);
    await workspaceSession.protocol.handle(SCHEME, createWorkspaceHandler({ id, baseUrl: connection.url, token: connection.token, frontendDir: frontendDirectory(),
      onAuthenticationFailure: () => progress(id, { phase: 'auth', message: '访问凭证已失效，请关闭此工作区窗口后重新连接。' }) }));
    const win = new BrowserWindow({ title: `${profile.name} — Tessmora`, width: 1440, height: 960, minWidth: 880, minHeight: 640,
      backgroundColor: '#f5f7f5', show: false,
      webPreferences: { preload: join(here, 'workspace-preload.cjs'), session: workspaceSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, additionalArguments: [`--tessmora-api-origin=${connection.url}`, `--tessmora-server-id=${connection.info?.serverId || ''}`, `--tessmora-workspace-mode=${profile.mode}`] } });
    workspaceWindows.set(id, win);
    restrictWindow(win, { origin: workspaceOrigin(id) });
    win.on('page-title-updated', event => { event.preventDefault(); win.setTitle(`${profile.name} — Tessmora`); });
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
    win.on('closed', () => workspaceWindows.delete(id));
    win.once('ready-to-show', () => { win.show(); launcher?.hide(); });
    await win.loadURL(`${workspaceOrigin(id)}/`);
    progress(id, { phase: 'ready', message: '工作区已打开。' });
    return { id, legacy: Boolean(connection.info?.legacy) };
  })();
  opening.set(id, operation);
  try { return await operation; } finally { opening.delete(id); }
}
let maintenance = false;
async function exportProfileHistory(profile, directory) {
  let win = workspaceWindows.get(profile.id), temporary = false;
  const ses = session.fromPartition(`persist:tessmora-${profile.id}`);
  if (!win || win.isDestroyed()) {
    temporary = true;
    if (await ses.protocol.isProtocolHandled(SCHEME)) ses.protocol.unhandle(SCHEME);
    await ses.protocol.handle(SCHEME, createWorkspaceHandler({ id: profile.id, baseUrl: profile.url || 'http://127.0.0.1:1', token: '', frontendDir: frontendDirectory(), offline: true }));
    win = new BrowserWindow({ show: false, webPreferences: { session: ses, preload: join(here, 'workspace-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
      additionalArguments: [`--tessmora-api-origin=${profile.url || ''}`, `--tessmora-server-id=${profile.serverId || ''}`, `--tessmora-workspace-mode=${profile.mode}`] } });
    workspaceWindows.set(profile.id, win);
    restrictWindow(win, { origin: workspaceOrigin(profile.id) });
  }
  try {
    if (temporary) await win.loadURL(`${workspaceOrigin(profile.id)}/`);
    return await historyExporter.request(win, profile.id, join(directory, `${profile.id}-${randomUUID()}.tessmora-chat`));
  } finally {
    if (temporary) { win.destroy(); workspaceWindows.delete(profile.id); ses.protocol.unhandle(SCHEME); }
  }
}
export async function stopLocalWorkspaces(backupDir, onlyId) {
  if (opening.size || maintenance) throw new WorkspaceError('WORKSPACE_BUSY', '工作区正在启动或备份，请完成后再试。');
  maintenance = true;
  try {
    const files = {};
    const profiles = (await store.read()).workspaces.filter(profile => !onlyId || profile.id === onlyId);
    if (backupDir) {
      for (const profile of profiles) files[profile.id] = await exportProfileHistory(profile, backupDir);
    }
    for (const profile of profiles.filter(profile => profile.mode === 'local')) {
      const connection = connections.get(profile.id);
      connections.delete(profile.id);
      workspaceWindows.get(profile.id)?.hide();
      await connection?.stop?.();
      workspaceWindows.get(profile.id)?.destroy();
    }
    return files;
  } finally { maintenance = false; }
}
function desktopAction(action) {
  void action().catch(error => dialog.showMessageBox({ type: 'error', title: 'Tessmora', message: publicError(error).message }));
}
async function initialize() {
  const data = app.getPath('userData');
  await mkdir(data, { recursive: true, mode: 0o700 });
  store = new WorkspaceStore(data);
  credentials = new CredentialStore(join(data, 'credentials'), safeStorage);
  historyExporter = createHistoryExportManager({ ipcMain, isAuthorized: validWorkspace });
  handle('list', async () => ({ ...(await store.read()), credentialStorageAvailable: credentials.available(), running: [...connections.keys()] }));
  handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog(launcher, { title: '选择工作区资料目录', properties: ['openDirectory', 'createDirectory'] });
    const directory = result.canceled ? null : result.filePaths[0];
    if (directory) selectedDirectories.add(directory);
    return directory;
  });
  handle('create', async value => {
    if (!value || typeof value !== 'object') throw new WorkspaceError('INPUT_INVALID', '连接信息不完整。');
    const { mode, directory, token, remember = true } = value;
    const name = validateName(value.name);
    let info;
    if (mode === 'remote') info = await negotiateWorkspace({ url: normalizeRemoteUrl(value.url), token });
    else if (mode !== 'local' || !selectedDirectories.has(directory)) throw new WorkspaceError('DIRECTORY_REQUIRED', '请通过“选择文件夹”指定资料目录。');
    const profile = await store.add({ mode, name, directory, url: value.url });
    try {
      if (mode === 'remote') {
        if (info.serverId) await store.bindIdentity(profile.id, info.serverId);
        await credentials.set(profile.id, token, { persist: remember });
      }
      return profile;
    } catch (error) { await store.remove(profile.id); await credentials.remove(profile.id); throw error; }
  });
  handle('connect', async value => {
    if (!value || typeof value.id !== 'string') throw new WorkspaceError('WORKSPACE_NOT_FOUND', '请选择工作区。');
    return openWorkspace(value.id, typeof value.token === 'string' ? value.token : undefined, value.remember !== false);
  });
  handle('forget', async id => {
    const profile = await store.get(id);
    if (opening.has(id)) throw new WorkspaceError('WORKSPACE_BUSY', '工作区正在打开，请稍后重试。');
    const choice = await dialog.showMessageBox(launcher, { type: 'question', buttons: ['保留连接', '移除此连接'], defaultId: 0, cancelId: 0,
      message: `移除“${profile.name}”的连接？`, detail: '知识库原件与服务端资料会保留。此应用内的会话、附件缓存和保存的访问凭证将被移除。' });
    if (choice.response !== 1) return { removed: false };
    workspaceWindows.get(id)?.destroy();
    const connection = connections.get(id);
    connections.delete(id);
    if (profile.mode === 'local') await connection?.stop?.();
    await credentials.remove(id);
    const ses = session.fromPartition(`persist:tessmora-${id}`);
    ses.protocol.unhandle(SCHEME);
    await ses.clearStorageData();
    await ses.clearCache();
    await store.remove(id);
    return { removed: true };
  });
  handle('quit', () => { app.quit(); return true; });
  ipcMain.handle('desktop:show-launcher', async (event, value) => {
    if (!validWorkspace(event, value?.workspaceId)) return false;
    await showLauncher(); return true;
  });
  const pixels = Buffer.alloc(22 * 22 * 4);
  for (let y = 3; y < 19; y++) for (let x = 3; x < 19; x++) {
    if (y < 7 || (x >= 9 && x < 13)) pixels[(y * 22 + x) * 4 + 3] = 255;
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: 22, height: 22, scaleFactor: 1 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Tessmora');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开工作区', click: () => void showLauncher() }, { type: 'separator' }, { label: '退出 Tessmora', click: () => app.quit() }]));
  tray.on('click', () => void showLauncher());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Tessmora', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { label: '退出 Tessmora', accelerator: 'Command+Q', click: () => app.quit() }] }] : []),
    { label: '工作区', submenu: [
      { label: '选择工作区…', accelerator: 'CmdOrCtrl+Shift+O', click: () => void showLauncher() },
      { label: '导入或导出会话…', click: () => { const win = BrowserWindow.getFocusedWindow(); const entry = [...workspaceWindows].find(([, value]) => value === win); if (entry) void win.loadURL(`${workspaceOrigin(entry[0])}/settings?section=history`); else void showLauncher(); } },
      { label: '备份本地工作区…', click: () => desktopAction(async () => (await import('./transfer.mjs')).backupWorkspace({ app, dialog, store, stopLocalWorkspaces })) },
      { label: '从备份恢复…', click: () => desktopAction(async () => (await import('./transfer.mjs')).restoreWorkspace({ app, dialog, store, showLauncher })) },
      { type: 'separator' },
      { label: '检查更新…', click: () => desktopAction(async () => (await import('./updates.mjs')).checkForUpdates({ app, dialog, store, stopLocalWorkspaces, beginInstall: () => { quitting = true; } })) },
      { label: '导出诊断报告…', click: () => desktopAction(async () => (await import('./diagnostics.mjs')).exportDiagnostics({ app, dialog, store })) },
      { type: 'separator' }, { role: 'close' }, ...(process.platform !== 'darwin' ? [{ role: 'quit' }] : [])] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  await showLauncher();
}
app.on('second-instance', () => void showLauncher());
app.on('activate', () => void showLauncher());
app.on('window-all-closed', () => {});
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  for (const controller of startupControllers) controller.abort();
  void (async () => {
    await Promise.allSettled([...opening.values()]);
    await Promise.allSettled([...connections.values()].map(connection => connection.stop?.()));
    quitting = true;
    tray?.destroy();
    app.quit();
  })();
});
if (single) app.whenReady().then(initialize).catch(async () => {
  dialog.showErrorBox('Tessmora 无法启动', '无法初始化应用。请检查配置目录的访问权限，或重新安装应用。');
  quitting = true; app.quit();
});
