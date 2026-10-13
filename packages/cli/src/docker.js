import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { homedir, release } from 'node:os';
import { constants } from 'node:fs';
import { TessmoraError, redact } from './errors.js';
import { ensureEnvironment, projectName } from './config.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let composeCommand;
const activeChildren = new Set();
process.once('exit', () => { for (const child of activeChildren) child.kill('SIGTERM'); });

export async function resolveCompose() {
  if (composeCommand) return composeCommand;
  const found = await findCompose(run);
  composeCommand = found.command;
  return composeCommand;
}

async function findCompose(runner) {
  const versions = [];
  for (const command of [['docker', ['compose']], ['docker-compose', []]]) {
    let version;
    try { version = await runner(command[0], [...command[1], 'version', '--short'], { timeout: 10000 }); }
    catch { continue; }
    const match = /^v?(\d+)\.(\d+)(?:\.|$)/.exec(version.trim());
    if (match && (Number(match[1]) > 2 || Number(match[1]) === 2 && Number(match[2]) >= 20)) return { command, version: version.trim() };
    versions.push(match ? `${match[1]}.${match[2]}` : '未知版本');
  }
  throw new TessmoraError(versions.length ? 'COMPOSE_OUTDATED' : 'COMPOSE_MISSING', versions.length ? `Compose 版本不满足要求（检测到 ${versions.join(' / ')}）。` : '尚未找到 Docker Compose。', '需要 Compose 2.20 或更新版本；Docker Desktop 用户可更新 Desktop，Linux 用户可安装 Compose 插件。');
}

// A Desktop installer may update shell startup files while this wizard is still open.
// Extend only this process's PATH, preserving already discoverable user commands.
export async function refreshDockerPath({ platform = process.platform, home = homedir(), env = process.env, accessible = (path) => access(path, constants.X_OK) } = {}) {
  if (platform !== 'darwin') return false;
  const candidates = [join(home, '.docker', 'bin'), '/usr/local/bin', '/Applications/Docker.app/Contents/Resources/bin', join(home, 'Applications/Docker.app/Contents/Resources/bin')];
  for (const dir of candidates) {
    try { await accessible(join(dir, 'docker')); }
    catch { continue; }
    if ((env.PATH || '').split(':').includes(dir)) continue;
    env.PATH = [env.PATH, dir].filter(Boolean).join(':');
    return true;
  }
  return false;
}

export async function run(command, args, { onLine, secrets = [], timeout = 0, env = process.env } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env, shell: false });
    activeChildren.add(child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let output = '';
    const pending = { stdout: '', stderr: '' };
    const consume = (line) => {
      const clean = redact(line, secrets);
      output = (output + clean).slice(-24000);
      onLine?.(clean.trim());
    };
    const receive = (channel, data) => {
      pending[channel] += data.toString();
      const lines = pending[channel].split(/(?<=[\r\n])/);
      pending[channel] = /[\r\n]$/.test(lines.at(-1)) ? '' : lines.pop() || '';
      for (const line of lines) consume(line);
    };
    child.stdout.on('data', (data) => receive('stdout', data));
    child.stderr.on('data', (data) => receive('stderr', data));
    const timer = timeout ? setTimeout(() => child.kill('SIGTERM'), timeout) : null;
    child.on('error', (error) => {
      activeChildren.delete(child);
      clearTimeout(timer);
      reject(new TessmoraError(error.code === 'ENOENT' ? 'COMMAND_MISSING' : 'COMMAND_FAILED', `${command} 无法运行。`, command === 'docker' ? '安装并启动 Docker Desktop（或 Docker Engine + Compose），再运行此命令。' : error.message));
    });
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
      clearTimeout(timer);
      for (const line of Object.values(pending)) if (line) consume(line);
      if (code === 0) resolveRun(output.trim());
      else reject(new TessmoraError('COMMAND_FAILED', `${command} 执行失败${signal ? ` (${signal})` : ` (${code})`}。`, output || '请检查命令环境后重试。'));
    });
  });
}

export async function dockerCheck({ runner = run } = {}) {
  // Reset stale Compose selection after an in-wizard installation or upgrade.
  if (runner === run) composeCommand = undefined;
  try { await runner('docker', ['--version'], { timeout: 10000 }); }
  catch (error) {
    if (error.code !== 'COMMAND_MISSING') throw new TessmoraError('DOCKER_CLI_FAILED', 'Docker 命令无法正常运行。', '请检查 Docker 安装与终端 PATH，然后重新检测。');
    if (runner === run && await refreshDockerPath()) return dockerCheck();
    throw new TessmoraError('DOCKER_MISSING', '这台电脑尚未找到 Docker 命令。', '安装 Docker 并启动后，回到向导重新检测即可继续。');
  }
  let context;
  try {
    const value = (await runner('docker', ['context', 'show'], { timeout: 5000 })).trim();
    if (/^[a-zA-Z0-9_.-]{1,80}$/.test(value)) context = value;
  } catch { /* Older clients may not expose a context; never change it automatically. */ }
  let version;
  try {
    version = await runner('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 15000 });
    if (!version.trim()) throw new Error('No server version');
  } catch (error) {
    const denied = /permission denied|access is denied|operation not permitted/i.test(`${error.message} ${error.hint || ''}`);
    throw new TessmoraError(denied ? 'DOCKER_PERMISSION' : 'DOCKER_NOT_RUNNING', denied ? '当前用户没有访问 Docker 引擎的权限。' : 'Docker 已安装，但当前引擎尚未连接成功。', '检查当前 Docker 服务或连接设置后重新检测。', { context });
  }
  let found;
  try { found = await findCompose(runner); }
  catch (error) { error.details = { context }; throw error; }
  if (runner === run) composeCommand = found.command;
  let resources = {};
  try { resources = JSON.parse(await runner('docker', ['info', '--format', '{"memoryBytes":{{.MemTotal}},"cpus":{{.NCPU}}}'], { timeout: 10000 })); } catch { /* Resource advisory must not block usable engines. */ }
  return { version, compose: found.version, ...resources, ...(resources.memoryBytes && resources.memoryBytes < 8 * 1024 ** 3 ? { advisory: 'Docker 可用内存不足 8 GiB。文本模型准备与问答可能较慢；完整多模态建议分配更多内存。可在 Docker 设置中调整，此向导不会修改或重启现有引擎。' } : {}) };
}

export async function portAvailable(port, host = '127.0.0.1') {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolvePort(true)));
  });
}

export async function availablePort(preferred, exclude = []) {
  for (let port = preferred; port < Math.min(preferred + 100, 65536); port++) {
    if (!exclude.includes(port) && await portAvailable(port)) return port;
  }
  throw new TessmoraError('PORT_CONFLICT', `端口 ${preferred} 附近没有空闲端口。`, '通过 --port 或 --storage-port 选择其他端口。');
}

export async function detectSource(explicit) {
  const candidate = resolve(explicit || process.cwd());
  try {
    await access(join(candidate, 'deploy', 'compose.build.yaml'));
    await access(join(candidate, 'deploy', 'Dockerfile.backend'));
    return candidate;
  } catch {
    if (explicit) throw new TessmoraError('SOURCE_INVALID', `没有在 ${candidate} 找到 Tessmora 分发源码。`, '--source 应指向包含 deploy/compose.build.yaml 的项目根目录。');
    return undefined;
  }
}

export async function composeArgs(paths, state, { build = false, minioBuild = false } = {}) {
  let asset = join(packageRoot, 'assets', 'compose.yaml');
  if (state.source) asset = join(state.source, 'deploy', 'compose.yaml');
  try { await access(asset); } catch {
    const source = state.source || await detectSource();
    if (!source) throw new TessmoraError('ASSET_MISSING', '安装包缺少 Compose 运行文件。', '请重新安装完整 npm 包，或在源码目录运行 npm run prepare-assets --prefix packages/cli。');
    asset = join(source, 'deploy', 'compose.yaml');
  }
  const args = ['--env-file', paths.env, '--project-name', state.project || projectName(paths), '-f', asset];
  if (build) args.push('-f', join(state.source, 'deploy', 'compose.build.yaml'));
  if (minioBuild) args.push('-f', join(dirname(asset), 'compose.minio-build.yaml'));
  return args;
}

export async function compose(paths, state, args, options = {}) {
  const env = await ensureEnvironment(paths, state);
  const prefix = await composeArgs(paths, state, options);
  const [command, commandPrefix] = await resolveCompose();
  return run(command, [...commandPrefix, ...prefix, ...args], { ...options, env: { ...process.env, ...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])) }, secrets: await runtimeSecrets(paths, state, env) });
}

export async function runtimeSecrets(paths, state, env) {
  env ||= await ensureEnvironment(paths, state);
  let credentials = [];
  try { credentials = Object.values(JSON.parse(await readFile(join(state.dataDir, 'state', 'setup.json'), 'utf8')).credentials || {}); } catch { /* API may not have saved a configuration yet. */ }
  return [env.TESSMORA_SETUP_TOKEN, env.TESSMORA_MINIO_PASSWORD, ...credentials].filter(value => typeof value === 'string' && value);
}

export async function containers(paths, state, options = {}) {
  const output = await compose(paths, state, ['ps', '--all', '--format', 'json'], options);
  if (!output) return [];
  try { const json = JSON.parse(output); return Array.isArray(json) ? json : [json]; } catch {
    return output.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }
}

export async function validatePorts(paths, state) {
  const own = await containers(paths, state);
  for (const [name, port, service] of [['网页', state.port, 'frontend'], ['文件存储', state.storagePort, 'minio']]) {
    const owned = own.some((container) => container.Service === service && container.State === 'running' && (container.Publishers || []).some((pub) => pub.PublishedPort === port));
    if (!owned && !await portAvailable(port)) throw new TessmoraError('PORT_CONFLICT', `${name}端口 ${port} 已被其他程序占用。`, '运行 tessmora configure 选择空闲端口；现有程序不会被关闭。');
  }
}

export async function claimDataDir(paths, state) {
  await mkdir(state.dataDir, { recursive: true });
  const marker = join(state.dataDir, '.tessmora-instance.json');
  try {
    const owner = JSON.parse(await readFile(marker, 'utf8'));
    if (owner.project !== state.project) throw new TessmoraError('DATA_IN_USE', '该数据目录已属于另一个 Tessmora 实例。', '请使用原实例的 --home / --instance，或选择其他数据目录。已有数据保持不变。');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if ((await readdir(state.dataDir)).length) throw new TessmoraError('DATA_UNOWNED', '该目录已有资料，但不属于当前 CLI 实例。未修改目录内容。', '请选择空目录；复用旧安装时请恢复原 CLI 状态目录与存储凭证。');
  try { await writeFile(marker, JSON.stringify({ project: state.project, instance: paths.instance, schema: 1 }) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') return claimDataDir(paths, state); throw error; }
}

export async function openBrowser(url, { platform = process.platform, wsl = Boolean(process.env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(release())), runner = run } = {}) {
  const windows = ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  const commands = platform === 'darwin' ? [['open', [url]]] : platform === 'win32' ? [windows]
    : wsl ? [['wslview', [url]], windows, ['xdg-open', [url]]] : [['xdg-open', [url]]];
  for (const command of commands) {
    try { await runner(...command, { timeout: 10000, secrets: [new URL(url).hash.slice(1)] }); return true; }
    catch { /* Try a WSL-compatible opener before falling back to a copyable URL. */ }
  }
  return false;
}
