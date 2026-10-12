import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { TessmoraError, redact } from './errors.js';
import { ensureEnvironment, projectName } from './config.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let composeCommand;
const activeChildren = new Set();
process.once('exit', () => { for (const child of activeChildren) child.kill('SIGTERM'); });

export async function resolveCompose() {
  if (composeCommand) return composeCommand;
  try {
    await run('docker', ['compose', 'version', '--short'], { timeout: 10000 });
    composeCommand = ['docker', ['compose']];
  } catch {
    await run('docker-compose', ['version', '--short'], { timeout: 10000 });
    composeCommand = ['docker-compose', []];
  }
  return composeCommand;
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

export async function dockerCheck() {
  try {
    const version = await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 15000 });
    const [command, prefix] = await resolveCompose();
    const compose = await run(command, [...prefix, 'version', '--short'], { timeout: 10000 });
    let resources = {};
    try { resources = JSON.parse(await run('docker', ['info', '--format', '{"memoryBytes":{{.MemTotal}},"cpus":{{.NCPU}}}'], { timeout: 10000 })); } catch { /* Resource advisory must not block usable engines. */ }
    return { version, compose, ...resources, ...(resources.memoryBytes && resources.memoryBytes < 8 * 1024 ** 3 ? { advisory: 'Docker 可用内存不足 8 GiB。文本模型准备与问答可能较慢；完整多模态建议分配更多内存。可在 Docker 设置中调整，此向导不会修改或重启现有引擎。' } : {}) };
  } catch (error) {
    if (error.code === 'COMMAND_MISSING') throw error;
    throw new TessmoraError('DOCKER_UNAVAILABLE', 'Docker 尚未就绪。', '启动 Docker Desktop，等待引擎就绪后重新检测。Linux 请检查 Docker 服务和当前用户权限。');
  }
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

export async function composeArgs(paths, state, { build = false } = {}) {
  let asset = join(packageRoot, 'assets', 'compose.yaml');
  if (build && state.source) asset = join(state.source, 'deploy', 'compose.yaml');
  try { await access(asset); } catch {
    const source = state.source || await detectSource();
    if (!source) throw new TessmoraError('ASSET_MISSING', '安装包缺少 Compose 运行文件。', '请重新安装完整 npm 包，或在源码目录运行 npm run prepare-assets --prefix packages/cli。');
    asset = join(source, 'deploy', 'compose.yaml');
  }
  const args = ['--env-file', paths.env, '--project-name', state.project || projectName(paths), '-f', asset];
  if (build) args.push('-f', join(state.source, 'deploy', 'compose.build.yaml'));
  return args;
}

export async function compose(paths, state, args, options = {}) {
  const env = await ensureEnvironment(paths, state);
  const prefix = await composeArgs(paths, state, options);
  const [command, commandPrefix] = await resolveCompose();
  let credentials = [];
  try { credentials = Object.values(JSON.parse(await readFile(join(state.dataDir, 'state', 'setup.json'), 'utf8')).credentials || {}); } catch { /* API may not have saved a configuration yet. */ }
  return run(command, [...commandPrefix, ...prefix, ...args], { ...options, env: { ...process.env, ...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])) }, secrets: [env.TESSMORA_SETUP_TOKEN, env.TESSMORA_MINIO_PASSWORD, ...credentials] });
}

export async function containers(paths, state) {
  const output = await compose(paths, state, ['ps', '--all', '--format', 'json']);
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

export async function startRuntime(paths, state, { onLine, rebuild = false } = {}) {
  await dockerCheck();
  await claimDataDir(paths, state);
  await validatePorts(paths, state);
  if (state.source && (!state.runtimeBuilt || rebuild)) {
    await compose(paths, state, ['build', 'backend', 'frontend'], { build: true, onLine });
  } else if (!state.source && (!state.backendImage || !state.frontendImage)) {
    try {
      await run('docker', ['image', 'inspect', state.backendImage || 'tessmora-backend:local', state.frontendImage || 'tessmora-frontend:local'], { timeout: 10000 });
    } catch {
      throw new TessmoraError('SOURCE_REQUIRED', '此开发版本尚未提供公共应用镜像。', '在 Tessmora 源码根目录运行 tessmora setup，或传入 --source /绝对路径；也可设置 --backend-image 和 --frontend-image 使用已发布镜像。');
    }
  }
  await compose(paths, state, ['up', '-d', '--wait', '--wait-timeout', '240'], { onLine });
}

export async function openBrowser(url) {
  const commands = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  try { await run(...commands, { timeout: 10000, secrets: [new URL(url).hash.slice(1)] }); return true; } catch { return false; }
}
