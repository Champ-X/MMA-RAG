import { ensureEnvironment } from './config.js';
import { openBrowser } from './docker.js';

export async function openWorkspace(paths, state, ui, { printUrl = false, setup = false } = {}, deps = {}) {
  const env = state.mode === 'local' ? await (deps.ensureEnvironment || ensureEnvironment)(paths, state) : {};
  const url = new URL(setup ? 'setup' : './', `${state.url.replace(/\/$/, '')}/`);
  if (env.TESSMORA_SETUP_TOKEN) url.hash = new URLSearchParams({ setup_token: env.TESSMORA_SETUP_TOKEN }).toString();
  if (printUrl) {
    ui.warn('以下链接包含此实例的访问凭证，仅在自己的浏览器打开，请勿分享。');
    ui.connectionLink(url.href);
    return true;
  }
  const opened = await (deps.openBrowser || openBrowser)(url.href);
  if (!opened) ui.warn('未能自动打开浏览器。运行 tessmora open --print-url 获取带凭证的连接链接，再粘贴到浏览器打开。');
  return opened;
}
