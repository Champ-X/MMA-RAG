const api = window.tessmoraLauncher;
const $ = id => document.getElementById(id);
const words = {
  title: ['本机资料库', 'Your local library'],
  otherWays: ['其他打开方式', 'Other ways to connect'],
  workspaces: ['已保存的工作区', 'Saved workspaces'],
  local: ['本地文件夹', 'Local folder'],
  localSummary: ['创建或打开独立的桌面工作区，无需账号。', 'Create or open a desktop workspace. No account needed.'],
  remote: ['连接服务器', 'Connect to a server'],
  remoteSummary: ['用服务地址和访问凭证打开远程资料库。', 'Use a server address and credential to access your library.'],
  localHint: ['选择一个空目录来新建，或选择已有的桌面工作区目录来继续。', 'Choose an empty folder to start fresh, or select an existing desktop workspace folder.'],
  remoteHint: ['连接已启用访问认证的 Tessmora 实例。资料和任务保存在该服务器上。', 'Connect to an authenticated Tessmora instance. Your files and tasks stay on that server.'],
  name: ['工作区名称', 'Workspace name'], directory: ['资料目录', 'Data folder'],
  chooseDirectory: ['选择文件夹', 'Choose a folder'], address: ['服务地址', 'Server address'],
  credential: ['访问凭证', 'Access credential'],
  credentialHint: ['填写服务器管理员发给你的访问凭证。模型 API Key 用于工作区内的模型设置。', 'Use the access credential issued by your server administrator. Model API keys belong in the workspace model settings.'],
  remember: ['使用系统凭证库记住此连接', 'Remember using the system credential store'],
  keychainUnavailable: ['系统凭证库不可用，凭证仅在本次会话有效。', 'The system credential store is unavailable. This credential lasts for this session.'],
  createLocal: ['打开文件夹工作区', 'Open folder workspace'], connectRemote: ['连接并打开', 'Connect and open'],
  connecting: ['正在打开…', 'Opening…'], close: ['关闭', 'Close'],
  quit: ['退出 Tessmora', 'Quit Tessmora'], historyHint: ['要继续浏览器里的旧对话，请用原浏览器打开。', 'To continue a past browser conversation, open Tessmora in the same browser.'],
  remove: ['移除', 'Remove'], reconnect: ['更新凭证', 'Update credential'], reconnectTitle: ['更新服务器凭证', 'Update server credential'],
  checking: ['正在检测本机服务', 'Checking local service'], online: ['本机服务在线', 'Service online'],
  protected: ['服务需要认证', 'Sign-in required'], unavailable: ['本机服务未就绪', 'Service unavailable'], unrecognized: ['未识别到 Tessmora', 'Tessmora not detected'],
  checkingHint: ['正在检查这台电脑上运行的 Tessmora。', 'Checking for Tessmora on this computer.'],
  onlineHint: ['直接使用网页版已有的素材空间和文件，无需桌面账号或重新导入。', 'Open the files and spaces you already use on the web. No desktop account or import needed.'],
  protectedHint: ['这个地址要求登录。可以在原浏览器登录，或在下方用服务器访问凭证连接。', 'This address requires authentication. Sign in with your browser, or use a server credential below.'],
  unavailableHint: ['先启动这台电脑上的 Tessmora 网页服务，再检测一次。也可以在下方打开独立工作区。', 'Start your local Tessmora web service, then check again. You can also open a separate workspace below.'],
  unrecognizedHint: ['这个地址返回的页面与 Tessmora 不匹配。请检查网页服务，或在下方连接其他服务器。', 'This address did not return a Tessmora service. Check the web service or connect to another server below.'],
  openExisting: ['打开已有资料', 'Open existing library'], openBrowser: ['在浏览器打开', 'Open in browser'],
  signIn: ['在浏览器登录', 'Sign in via browser'], check: ['重新检测', 'Check again'], wait: ['检测中…', 'Checking…'],
};
const dialog = $('workspace-dialog');
let lang = localStorage.getItem('language') === 'en' ? 1 : 0;
let mode = 'local', directory = null, busy = false, reconnectId = null, profiles = [];
let serviceState = 'checking', detecting = false, checkedAt = 0, openingService = false;
const text = key => words[key][lang];

function renderService() {
  $('signal').dataset.state = serviceState;
  $('service-state').textContent = text(serviceState);
  $('service-description').textContent = text(serviceState + 'Hint');
  const label = { online: 'openExisting', checking: 'wait', protected: 'signIn' }[serviceState] || 'check';
  $('service-action').textContent = text(openingService ? 'connecting' : label);
  $('open-service').disabled = busy || detecting || openingService;
  $('open-browser').hidden = serviceState !== 'online';
}
function updateForm() {
  const remote = mode === 'remote';
  $('local-fields').hidden = remote;
  $('remote-fields').hidden = $('credential-fields').hidden = !remote;
  $('token').required = $('url').required = remote;
  $('connect-title').textContent = text(reconnectId ? 'reconnectTitle' : mode);
  $('form-hint').textContent = text(remote ? 'remoteHint' : 'localHint');
  $('name').placeholder = lang ? 'My library' : '我的资料库';
  $('directory-label').textContent = directory || text('chooseDirectory');
  $('submit').textContent = text(busy ? 'connecting' : remote ? 'connectRemote' : 'createLocal');
}
function translate() {
  document.documentElement.lang = lang ? 'en' : 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach(node => node.textContent = text(node.dataset.i18n));
  $('language-label').textContent = lang ? '中文' : 'English';
  $('cancel-form').setAttribute('aria-label', text('close'));
  updateForm(); renderService(); renderProfiles();
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('button:not(#quit), input').forEach(node => node.disabled = value);
  $('name').disabled = $('url').disabled = busy || Boolean(reconnectId);
  updateForm(); renderService();
}
function clearFeedback() {
  for (const id of ['status', 'home-status']) $(id).textContent = '';
  $('error').hidden = $('home-error').hidden = true;
}
function showError(error) {
  const box = $(dialog.open ? 'error' : 'home-error');
  clearFeedback();
  if (error?.code === 'KEYCHAIN_LOCKED') { $('keychain-note').hidden = false; $('remember').checked = false; }
  box.textContent = error?.message || (lang ? 'Could not complete the operation. Please try again.' : '操作未完成，请重试。');
  box.hidden = false;
}
function result(response) { if (!response.ok) throw response.error; return response.value; }
function renderProfiles() {
  $('workspace-list').replaceChildren(); $('recent').hidden = profiles.length === 0;
  for (const profile of profiles) {
    const row = document.createElement('div'); row.className = 'workspace-row';
    const open = document.createElement('button'); open.className = 'workspace-open'; open.type = 'button'; open.dataset.workspaceId = profile.id;
    const icon = profile.mode === 'local' ? '#folder' : '#server';
    open.innerHTML = '<svg aria-hidden="true"><use href="' + icon + '"/></svg>';
    const copy = document.createElement('span'); copy.className = 'workspace-copy';
    const name = document.createElement('span'); name.className = 'workspace-name'; name.textContent = profile.name;
    const detail = document.createElement('span'); detail.className = 'workspace-detail'; detail.textContent = profile.mode === 'local' ? profile.directory : profile.url; detail.title = detail.textContent;
    copy.append(name, detail); open.append(copy); open.addEventListener('click', () => connect(profile));
    const actions = document.createElement('span'); actions.className = 'workspace-actions';
    if (profile.mode === 'remote') {
      const edit = document.createElement('button'); edit.textContent = text('reconnect');
      edit.addEventListener('click', () => showForm('remote', profile)); actions.append(edit);
    }
    const remove = document.createElement('button'); remove.textContent = text('remove');
    remove.addEventListener('click', async () => {
      setBusy(true);
      try { result(await api.forget(profile.id)); await refresh(); } catch (error) { showError(error); } finally { setBusy(false); }
    });
    actions.append(remove); row.append(open, actions); $('workspace-list').append(row);
  }
}
async function refresh() {
  const state = result(await api.list()); profiles = state.workspaces;
  $('app-mark').src = state.logo; $('library-art').src = state.illustration;
  renderProfiles();
}
function showForm(nextMode, profile) {
  clearFeedback(); mode = nextMode; reconnectId = profile?.id || null; directory = null;
  $('workspace-form').reset(); $('remember').checked = false; $('keychain-note').hidden = true;
  $('name').value = profile?.name || ''; $('url').value = profile?.url || '';
  setBusy(false);
  if (!dialog.open) dialog.showModal();
  $(reconnectId ? 'token' : 'name').focus();
}
async function connect(profile, token) {
  clearFeedback(); setBusy(true);
  $(dialog.open ? 'status' : 'home-status').textContent = text('connecting');
  try {
    result(await api.connect({ id: profile.id, token, remember: $('remember').checked }));
    $('token').value = ''; dialog.close(); clearFeedback();
  } catch (error) {
    if (profile.mode === 'remote' && ['CREDENTIAL_REQUIRED', 'AUTH_FAILED', 'CREDENTIAL_UNREADABLE', 'KEYCHAIN_LOCKED'].includes(error.code)) showForm('remote', profile);
    showError(error);
  } finally { await refresh().catch(showError); setBusy(false); }
}
$('workspace-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (reconnectId) { await connect(profiles.find(w => w.id === reconnectId), $('token').value); return; }
  clearFeedback(); setBusy(true); $('status').textContent = text('connecting');
  try {
    const profile = result(await api.create({ mode, name: $('name').value, directory, url: $('url').value, token: $('token').value, remember: $('remember').checked }));
    $('token').value = ''; await refresh(); await connect(profile);
  } catch (error) { showError(error); }
  finally { setBusy(false); }
});
$('choose-directory').addEventListener('click', async () => {
  try {
    const selected = result(await api.chooseDirectory());
    if (selected) {
      directory = selected; $('directory-label').textContent = selected;
      if (!$('name').value.trim()) $('name').value = selected.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 80) || '';
    }
  } catch (error) { showError(error); }
});
async function detect() {
  if (detecting || openingService) return;
  detecting = true; serviceState = 'checking'; renderService();
  try { serviceState = result(await api.detectLocalWeb()); }
  catch { serviceState = 'unavailable'; }
  finally { detecting = false; checkedAt = Date.now(); renderService(); }
}
async function openBrowser() {
  try { result(await api.browseLocalWeb()); } catch (error) { showError(error); }
}
$('open-service').addEventListener('click', async () => {
  if (serviceState === 'protected') { await openBrowser(); return; }
  if (serviceState !== 'online') { await detect(); return; }
  openingService = true; clearFeedback(); setBusy(true);
  try { serviceState = result(await api.openLocalWeb()).state; }
  catch (error) { showError(error); }
  finally { openingService = false; setBusy(false); }
});
$('open-browser').addEventListener('click', openBrowser);
$('local-tab').addEventListener('click', () => showForm('local'));
$('remote-tab').addEventListener('click', () => showForm('remote'));
$('cancel-form').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
dialog.addEventListener('close', () => { reconnectId = null; $('token').value = ''; });
$('language').addEventListener('click', () => { lang = 1 - lang; localStorage.setItem('language', lang ? 'en' : 'zh'); translate(); });
$('quit').addEventListener('click', () => api.quit());
api.onProgress(value => {
  if (busy && !openingService) $(dialog.open ? 'status' : 'home-status').textContent = value.message;
  else if (value.phase === 'stopped') showError({ message: value.message });
  else if (value.phase === 'auth') {
    const profile = profiles.find(item => item.id === value.id);
    if (profile?.mode === 'remote') { showForm('remote', profile); showError({ message: value.message }); }
  }
});
function recheckWhenVisible() {
  if (!document.hidden && !dialog.open && !busy && Date.now() - checkedAt > 15000) void detect();
}
document.addEventListener('visibilitychange', recheckWhenVisible);
setInterval(() => { if (serviceState !== 'online') recheckWhenVisible(); }, 20000);
document.documentElement.classList.toggle('on-mac', navigator.platform.startsWith('Mac'));
translate();
refresh().catch(showError);
void detect();
