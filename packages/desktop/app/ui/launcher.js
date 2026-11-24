const api = window.tessmoraLauncher;
const $ = id => document.getElementById(id);
const words = {
  title: ['让资料在这里相遇', 'A place for your knowledge'], intro: ['打开一个工作区，继续阅读、提问和探索。', 'Open a workspace to keep reading, asking and exploring.'],
  workspaces: ['你的工作区', 'Your workspaces'], empty: ['还没有连接工作区。', 'No workspaces connected yet.'], emptyHint: ['在这台电脑上创建，或连接已有服务。', 'Create one on this computer or connect to a server.'],
  background: ['关窗后，本地任务仍可继续。从菜单栏可重新打开或退出。', 'Local tasks continue when the window closes. Use the menu bar to reopen or quit.'],
  newWorkspace: ['添加工作区', 'Add a workspace'], choose: ['选择资料与任务运行的位置。', 'Choose where your files and tasks live.'],
  local: ['本地工作区', 'On this computer'], remote: ['连接服务器', 'Connect to a server'], name: ['工作区名称', 'Workspace name'],
  directory: ['资料目录', 'Data folder'], chooseDirectory: ['选择文件夹', 'Choose a folder'], localHint: ['原件、索引与任务保存在这里。首次使用会检查并准备运行环境。', 'Originals, indexes and tasks stay here. The app checks and prepares the runtime on first use.'],
  address: ['服务地址', 'Server address'], remoteHint: ['连接受信任且已启用全站认证的 Tessmora。资料保存在服务器。', 'Connect to a trusted Tessmora server with authentication enabled. Files stay on the server.'],
  credential: ['访问凭证', 'Access credential'], remember: ['使用系统凭证库记住此连接', 'Remember using the system credential store'], keychainUnavailable: ['系统凭证库暂不可用。凭证仅用于本次应用会话。', 'The system credential store is unavailable. Credentials will last only for this app session.'],
  createLocal: ['创建并打开', 'Create and open'], connectRemote: ['连接并打开', 'Connect and open'], connecting: ['正在打开…', 'Opening…'], cancelReconnect: ['返回添加工作区', 'Back to adding a workspace'],
  footer: ['一个工作区，一份独立的资料与历史。', 'Separate files and history for every workspace.'], quit: ['退出 Tessmora', 'Quit Tessmora'],
  remove: ['移除', 'Remove'], reconnect: ['更新凭证', 'Credential'], reconnectTitle: ['重新连接工作区', 'Reconnect workspace'],
};
let lang = localStorage.getItem('language') === 'en' ? 1 : 0;
let mode = 'local', directory = null, busy = false, reconnectId = null, profiles = [];
const text = key => words[key]?.[lang] || key;
function translate() {
  document.documentElement.lang = lang ? 'en' : 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach(node => node.textContent = text(node.dataset.i18n));
  $('language').textContent = lang ? '中文' : 'English';
  $('name').placeholder = lang ? 'My library' : '我的资料库';
  if (directory) $('directory-label').textContent = directory;
  $('connect-title').textContent = text(reconnectId ? 'reconnectTitle' : 'newWorkspace');
  $('submit').textContent = text(busy ? 'connecting' : mode === 'remote' ? 'connectRemote' : 'createLocal');
  renderProfiles();
}
function setMode(value) {
  mode = value;
  $('local-tab').setAttribute('aria-selected', String(mode === 'local'));
  $('remote-tab').setAttribute('aria-selected', String(mode === 'remote'));
  $('local-fields').hidden = mode !== 'local';
  $('remote-fields').hidden = mode !== 'remote';
  $('credential-fields').hidden = mode !== 'remote';
  $('url').required = mode === 'remote';
  $('token').required = mode === 'remote';
  $('status').textContent = ''; $('error').hidden = true;
  translate();
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('button:not(#quit),input').forEach(node => node.disabled = value);
  if (!value && reconnectId) { $('name').disabled = true; $('url').disabled = true; $('local-tab').disabled = true; $('remote-tab').disabled = true; }
  $('submit').textContent = text(value ? 'connecting' : mode === 'remote' ? 'connectRemote' : 'createLocal');
}
function showError(error) {
  $('error').textContent = error?.message || (lang ? 'The operation could not be completed. Please try again.' : '操作未完成，请重试。');
  $('error').hidden = false; $('status').textContent = '';
}
function result(response) { if (!response.ok) throw response.error; return response.value; }
function renderProfiles() {
  $('workspace-list').replaceChildren(); $('count').textContent = String(profiles.length); $('empty').hidden = profiles.length > 0;
  for (const profile of profiles) {
    const row = document.createElement('div'); row.className = 'workspace-row';
    const open = document.createElement('button'); open.className = 'workspace-open'; open.type = 'button'; open.dataset.workspaceId = profile.id;
    open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 3h9v11H3z"/></svg>';
    const copy = document.createElement('span'); copy.className = 'workspace-copy';
    const name = document.createElement('span'); name.className = 'workspace-name'; name.textContent = profile.name;
    const detail = document.createElement('span'); detail.className = 'workspace-detail'; detail.textContent = profile.mode === 'local' ? profile.directory : profile.url; detail.title = detail.textContent;
    copy.append(name, detail); open.append(copy); open.addEventListener('click', () => connect(profile));
    const actions = document.createElement('span'); actions.className = 'workspace-actions';
    if (profile.mode === 'remote') { const edit = document.createElement('button'); edit.textContent = text('reconnect'); edit.addEventListener('click', () => editCredential(profile)); actions.append(edit); }
    const remove = document.createElement('button'); remove.textContent = text('remove'); remove.addEventListener('click', async () => {
      setBusy(true); try { result(await api.forget(profile.id)); await refresh(); } catch (error) { showError(error); } finally { setBusy(false); }
    }); actions.append(remove); row.append(open, actions); $('workspace-list').append(row);
  }
}
async function refresh() {
  const state = result(await api.list()); profiles = state.workspaces;
  $('keychain-note').hidden = state.credentialStorageAvailable;
  if (!state.credentialStorageAvailable) $('remember').checked = false;
  renderProfiles();
}
function editCredential(profile) {
  reconnectId = profile.id; setMode('remote');
  $('name').value = profile.name; $('url').value = profile.url; $('token').value = '';
  $('cancel-reconnect').hidden = false; setBusy(false); $('token').focus();
}
async function connect(profile, token) {
  $('error').hidden = true; setBusy(true); $('status').textContent = text('connecting');
  try {
    result(await api.connect({ id: profile.id, token, remember: $('remember').checked }));
    $('token').value = ''; $('status').textContent = '';
  } catch (error) {
    if (['CREDENTIAL_REQUIRED', 'AUTH_FAILED', 'CREDENTIAL_UNREADABLE', 'KEYCHAIN_LOCKED'].includes(error.code)) editCredential(profile);
    showError(error);
  } finally { setBusy(false); await refresh(); }
}
$('workspace-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (reconnectId) { await connect(profiles.find(w => w.id === reconnectId), $('token').value); return; }
  $('error').hidden = true; setBusy(true); $('status').textContent = text('connecting');
  try {
    const profile = result(await api.create({ mode, name: $('name').value, directory, url: $('url').value, token: $('token').value, remember: $('remember').checked }));
    $('token').value = ''; await refresh();
    await connect(profile);
  } catch (error) { showError(error); }
  finally { setBusy(false); }
});
$('choose-directory').addEventListener('click', async () => {
  try { const selected = result(await api.chooseDirectory()); if (selected) { directory = selected; $('directory-label').textContent = selected; } } catch (error) { showError(error); }
});
$('local-tab').addEventListener('click', () => setMode('local'));
$('remote-tab').addEventListener('click', () => setMode('remote'));
$('language').addEventListener('click', () => { lang = 1 - lang; localStorage.setItem('language', lang ? 'en' : 'zh'); translate(); });
$('cancel-reconnect').addEventListener('click', () => { reconnectId = null; $('workspace-form').reset(); $('cancel-reconnect').hidden = true; setBusy(false); setMode('local'); });
$('quit').addEventListener('click', () => api.quit());
api.onProgress(value => {
  if (busy) $('status').textContent = value.message;
  else if (value.phase === 'auth') {
    const profile = profiles.find(item => item.id === value.id);
    if (profile?.mode === 'remote') { editCredential(profile); showError({ message: value.message }); }
  }
});
translate();
refresh().catch(showError);
