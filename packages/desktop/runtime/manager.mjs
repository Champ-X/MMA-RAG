import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';

function contained(root, target) {
  const path = relative(root, target);
  return path && !path.startsWith('..') && !isAbsolute(path);
}

function runtimeError(message) {
  return Object.assign(new Error(message), { code: 'LOCAL_RUNTIME_UNAVAILABLE' });
}

export async function startLocalWorkspace({ workspaceDir, runtimeDir, signal, onProgress = () => {} }) {
  if (signal?.aborted) throw runtimeError('工作区启动已取消。');
  let root, python, host;
  try {
    root = await realpath(runtimeDir || join(process.resourcesPath, 'runtime'));
    const manifest = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'));
    if (manifest.format !== 1 || manifest.apiProtocol !== 1 || manifest.platform !== process.platform + '-' + process.arch) throw new Error();
    python = await realpath(resolve(root, manifest.executables.python));
    host = await realpath(join(root, 'backend', 'desktop_host.py'));
    if (!contained(root, python) || !contained(root, host)) throw new Error();
  } catch {
    throw runtimeError('本机运行包缺失或与平台不兼容，请安装或修复对应运行包。');
  }
  // GUI and development launches must see the same workspace configuration.
  // Only pass the platform session, locale, system TLS and network proxy settings.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(home|userprofile|username|appdata|localappdata|programdata|systemroot|windir|systemdrive|comspec|pathext|temp|tmp|tmpdir|lang|lc_.*|path|https?_proxy|all_proxy|no_proxy|ssl_cert_file|requests_ca_bundle|securitysessionid)$/i.test(name)));
  const posix = process.platform !== 'win32';
  const child = spawn(python, ['-E', '-s', '-B', host], {
    cwd: root, env, stdio: ['pipe', 'pipe', 'ignore'], detached: posix, windowsHide: true,
  });
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  let failure;
  let stopping = false;
  const stop = async () => {
    if (!stopping) {
      stopping = true;
      child.stdin.end();
      const timer = setTimeout(() => killOwned(), 30000);
      timer.unref();
      closed.then(() => clearTimeout(timer));
    }
    await closed;
  };
  function killOwned() {
    if (!child.pid) return;
    try {
      if (posix) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL'); // The Windows host owns a kill-on-close Job Object.
    } catch { /* Process group already exited. */ }
  }
  const abort = () => { void stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  const lines = createInterface({ input: child.stdout });
  child.stdin.on('error', () => {});
  const startup = new Promise((accept, reject) => {
    child.once('error', () => {
      failure = runtimeError('无法启动应用内的 Python 运行环境。');
      reject(failure);
    });
    child.once('close', (code, exitSignal) => {
      if (posix) killOwned();
      signal?.removeEventListener('abort', abort);
      lines.close();
      resolveClosed({ code, signal: exitSignal, message: failure?.message });
      reject(failure || runtimeError('本地服务已停止。请检查工作区日志。'));
    });
    lines.on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      const { phase, message } = event;
      if (typeof phase !== 'string' || typeof message !== 'string') return;
      onProgress({ phase, message });
      if (phase === 'error') failure = runtimeError(message);
      if (phase === 'ready' && !stopping) {
        if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(event.url) || typeof event.token !== 'string' || event.token.length < 32 || !/^[a-f\d-]{36}$/i.test(event.workspaceId)) {
          failure = runtimeError('本地服务返回了无效的连接信息。');
          void stop();
          return;
        }
        accept({ url: event.url, token: event.token, workspaceId: event.workspaceId, stop, closed });
      }
    });
  });
  child.stdin.write(JSON.stringify({ workspaceDir: resolve(workspaceDir) }) + '\n');
  if (signal?.aborted) abort();
  const deadline = setTimeout(abort, 310000);
  deadline.unref();
  try { return await startup; } finally { clearTimeout(deadline); }
}
