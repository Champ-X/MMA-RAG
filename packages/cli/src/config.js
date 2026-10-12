import { randomBytes, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join, isAbsolute, parse } from 'node:path';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { TessmoraError } from './errors.js';

export function locations(options = {}) {
  const instance = options.instance || 'default';
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(instance)) throw new TessmoraError('INVALID_INSTANCE', '实例名仅支持小写字母、数字、短横线和下划线（最多 40 字符）。');
  const home = resolve(options.home || process.env.TESSMORA_HOME || join(homedir(), '.tessmora'));
  const dir = join(home, 'instances', instance);
  return { home, dir, instance, manifest: join(dir, 'instance.json'), env: join(dir, 'runtime.env'), data: join(home, 'data', instance) };
}

export async function readState(paths) {
  try {
    const state = JSON.parse(await readFile(paths.manifest, 'utf8'));
    if (state.schema !== 1) throw new TessmoraError('CONFIG_VERSION', '安装状态版本不受当前 CLI 支持。', '请使用创建此实例的 CLI 版本或更新 CLI。');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof TessmoraError) throw error;
    throw new TessmoraError('CONFIG_INVALID', '无法读取实例配置。原文件已保留。', `请检查 ${paths.manifest}。`);
  }
}

export async function privateWrite(file, content) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

export async function saveState(paths, state) {
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  await chmod(paths.dir, 0o700);
  const next = { ...state, schema: 1, updatedAt: new Date().toISOString() };
  await privateWrite(paths.manifest, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function projectName(paths) {
  return `tessmora-${paths.instance}-${createHash('sha256').update(paths.dir).digest('hex').slice(0, 8)}`;
}

export function dotenvValue(value) {
  const text = String(value);
  if (/[\r\n\0]/.test(text)) throw new TessmoraError('INVALID_ENV', '配置值不能包含换行符。');
  // Compose treats backslashes literally in single-quoted values.
  return `'${text.replaceAll("'", "\\'")}'`;
}

export async function readEnvironment(paths) {
  try {
    const env = {};
    const text = await readFile(paths.env, 'utf8');
    for (const line of text.split('\n')) {
      const match = /^([A-Z_]+)='(.*)'$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/\\'/g, "'");
    }
    return env;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function ensureEnvironment(paths, state) {
  const previous = await readEnvironment(paths);
  if (state.mode === 'local' && (state.step >= 3 || state.runtimeCreated) && (!previous.TESSMORA_SETUP_TOKEN || !previous.TESSMORA_MINIO_USER || !previous.TESSMORA_MINIO_PASSWORD)) {
    throw new TessmoraError('RUNTIME_ENV_MISSING', '已有实例的私有运行配置丢失，未重新生成存储凭证。', `请从备份恢复 ${paths.env}；已有数据保持不变。`);
  }
  const env = {
    ...previous,
    TESSMORA_DATA_DIR: process.platform === 'win32' ? state.dataDir.replaceAll('\\', '/') : state.dataDir,
    TESSMORA_PORT: state.port || 3001,
    TESSMORA_STORAGE_PORT: state.storagePort || 9000,
    TESSMORA_SETUP_TOKEN: previous.TESSMORA_SETUP_TOKEN || randomBytes(32).toString('hex'),
    TESSMORA_MINIO_USER: previous.TESSMORA_MINIO_USER || 'tessmora',
    TESSMORA_MINIO_PASSWORD: previous.TESSMORA_MINIO_PASSWORD || randomBytes(24).toString('hex'),
    TESSMORA_BACKEND_IMAGE: state.backendImage || 'tessmora-backend:local',
    TESSMORA_FRONTEND_IMAGE: state.frontendImage || 'tessmora-frontend:local',
    TESSMORA_HF_ENDPOINT: state.modelEndpoint || 'https://huggingface.co',
    TESSMORA_BUILD_PROXY: state.buildProxy || '',
    TESSMORA_PROXY: state.proxy || '',
    TESSMORA_DEBIAN_MIRROR: state.debianMirror || 'https://deb.debian.org',
  };
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  await privateWrite(paths.env, Object.entries(env).map(([key, value]) => `${key}=${dotenvValue(value)}`).join('\n') + '\n');
  return env;
}

export function validateDataDir(value) {
  if (!isAbsolute(value)) return '请填写绝对路径，例如 /Users/you/.tessmora/data/default';
  if (/[\r\n\0]/.test(value)) return '路径不能包含换行符';
  if (resolve(value) === parse(resolve(value)).root) return '请选择专用数据目录';
}

export function normalizeUrl(value, { remote = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new TessmoraError('INVALID_URL', '服务地址需要是完整的 http:// 或 https:// URL。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TessmoraError('INVALID_URL', '请使用不含凭证、查询参数或片段的 HTTP(S) 服务地址。');
  if (remote && url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    // Remote onboarding is read-only; no credentials are sent to the target.
  }
  return url.href.replace(/\/$/, '');
}
