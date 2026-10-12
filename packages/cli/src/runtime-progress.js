import { mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { redact, TessmoraError } from './errors.js';
import { plainLine, duration } from './terminal.js';

export const runtimePhases = [
  ['check', '检查本机环境'], ['storage', '准备存储组件'],
  ['build', '准备应用镜像'], ['start', '启动独立服务'], ['ready', '验证工作台连接'],
];

export function runtimeJournal(paths) {
  const dir = join(paths.dir, 'logs');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `setup-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.log`);
  const file = openSync(path, 'wx', 0o600);
  return { path, write: text => writeSync(file, `${redact(plainLine(text))}\n`), close: () => closeSync(file) };
}

// Summarize real activities. A build graph is dynamic, so never invent a total percentage.
export function activitySummary(line) {
  const text = plainLine(line);
  if (!text) return undefined;
  const size = text.match(/\b\d+(?:\.\d+)?\s*[kMGT]?B\s*\/\s*\d+(?:\.\d+)?\s*[kMGT]?B\b/i)?.[0];
  if (/exporting layers/.test(text)) return '正在写入镜像层 · 大镜像可能需要几分钟';
  if (/exporting|naming to|unpacking to/.test(text)) return '正在保存应用镜像';
  if (/CACHED/.test(text)) return '复用已完成的构建缓存';
  if (/go: downloading/.test(text)) return `下载存储编译依赖 · ${text.match(/go: downloading\s+(\S+)/)?.[1] || ''}`;
  if (/# get https?:/.test(text)) return '下载存储编译依赖 · Go 模块校验中';
  if (/go build/.test(text)) return '编译固定版本 MinIO · 编译期间可能暂时没有新输出';
  const goPackage = text.match(/^#\d+\s+[\d.]+\s+((?:github\.com|golang\.org|google\.golang\.org)\/[^\s]+)$/);
  if (goPackage) return `编译存储组件 · ${goPackage[1].split('/').at(-1)}`;
  const pkg = text.match(/(?:Collecting|Downloading|Using cached)\s+(?:https?:\/\/\S*\/)?([\w][\w.+-]*)/);
  if (pkg) return `准备 Python 依赖 · ${pkg[1]}${size ? ` · ${size}` : ''}`;
  if (/Get:\d+|Unpacking|Setting up|apt-get/.test(text)) return '安装文档与多媒体系统依赖';
  if (/npm (?:ci|run)|vite|tsc/.test(text)) return '准备前端与 Pi 运行时';
  if (/load metadata|resolve.*image|Pulling|Downloading|Extracting/.test(text)) return `下载 / 解压镜像${size ? ` · ${size}` : ''}`;
  if (/Healthy|Started|Running|Created|Waiting|Starting/.test(text)) return text.replace(/^Container\s+/, '服务 ');
  const step = text.match(/^#\d+\s+\[([^\]]+)\]/);
  if (step) return `构建 ${step[1]}`;
  if (/DONE/.test(text)) return '构建步骤完成，继续下一项';
  return undefined;
}

export function runtimeFailure(error, { phase, target, logPath } = {}) {
  if (error.code === 'CANCELLED') return error;
  const raw = `${error.message}\n${error.hint || ''}`;
  let code = error.code || 'RUNTIME_FAILED', message = error.message, hint = error.hint;
  if (/buildx.*(?:required|missing|not|install)|BuildKit.*(?:required|disabled)|requires BuildKit/i.test(raw)) {
    code = 'BUILDER_MISSING'; message = '源码构建需要 Docker Buildx / BuildKit';
    hint = 'Docker Desktop 用户请更新 Desktop；Linux 用户按 Docker 官方安装说明补齐 docker-buildx-plugin。\n完成后执行 docker buildx version 检查，再继续配置。';
  } else if (/401|403|unauthorized|denied:|pull access denied/i.test(raw)) {
    code = 'IMAGE_ACCESS_DENIED';
    message = `镜像仓库拒绝访问${target ? `：${target}` : ''}`;
    hint = '镜像地址可能已撤下、不可公开访问，或仓库凭证已失效。\n检查该镜像来源；私有镜像需要对应仓库的访问权限。';
    if (/quay\.io\/minio\/minio/.test(raw)) hint = '旧 MinIO 官方镜像已无法公开获取。\n使用当前默认的固定源码构建，或用 --minio-image 指定可信的同版本镜像。';
  } else if (/no space left|disk quota exceeded/i.test(raw)) {
    code = 'DOCKER_DISK_FULL'; message = 'Docker 磁盘空间不足';
    hint = '在 Docker 设置中增加磁盘空间，或自行清理确认不用的内容后重试。已有资料不会被自动清理。';
  } else if (/429|toomanyrequests|rate limit/i.test(raw)) {
    code = 'IMAGE_RATE_LIMIT'; message = '镜像仓库暂时限制了下载频率';
    hint = '稍后重试，或登录对应仓库提高可用额度。已下载的镜像层会复用。';
  } else if (/timeout|timed out|TLS handshake|no such host|connection reset|network is unreachable|proxyconnect|failed to fetch/i.test(raw)) {
    code = 'RUNTIME_NETWORK'; message = `下载或连接暂时失败${target ? `：${target}` : ''}`;
    hint = '检查网络与 Docker 的代理 / DNS 后重试。镜像拉取使用 Docker 引擎的网络设置；--build-proxy 只用于构建内的依赖下载。';
  } else if (/unhealthy|dependency failed|didn't complete successfully/i.test(raw)) {
    code = 'SERVICE_START_FAILED'; message = '部分服务未通过启动检查';
    hint = '检查服务状态：\ntessmora doctor\n查看服务日志：\ntessmora logs';
  } else if (code === 'COMMAND_FAILED') {
    message = `${runtimePhases.find(([id]) => id === phase)?.[1] || '运行环境准备'}未完成${target ? `：${target}` : ''}`;
    hint = '查看下方日志中的具体错误，修复后重试。已完成的镜像与构建缓存会保留。';
  }
  return new TessmoraError(code, message, `${hint || '修复后重试。'}${logPath ? `\n\n详细日志：${logPath}` : ''}`, { phase, target, logPath });
}

export function runtimeReporter(ui, { logPath, source }) {
  ui.card('运行环境 · 准备路线', [
    '检查环境 → 存储组件 → 应用镜像 → 启动服务 → 工作台',
    source ? '首次构建需要下载并编译依赖，耗时取决于网络和电脑性能。' : '优先复用本机镜像；缺失的镜像会按需准备。',
    '每项完成后保留结果；完整日志持续写入下方文件。', '', logPath,
  ]);
  let spinner, started, phase, prefix = '', base = '', lastActivity = Date.now();
  const refresh = () => {
    const idle = Date.now() - lastActivity;
    spinner?.message(`${prefix} · ${idle >= 15000 ? `${duration(idle)} 无新输出，仍在等待` : base}`);
  };
  const timer = setInterval(refresh, 1000);
  timer.unref();
  return {
    event(event) {
      if (event.state === 'running') {
        phase = event.phase; started = Date.now(); base = event.detail || event.title;
        prefix = `${runtimePhases.findIndex(([id]) => id === phase) + 1}/5 ${event.title}`;
        lastActivity = Date.now();
        spinner = ui.spinner(prefix);
      } else if (event.state === 'done') {
        spinner?.stop(`${event.title}${ui.interactive ? '' : ` · ${duration(Date.now() - started)}`}`);
        spinner = undefined;
      } else {
        if (event.activity) lastActivity = Date.now();
        if (event.detail) base = event.detail;
        refresh();
      }
    },
    close(error) {
      clearInterval(timer);
      if (spinner) (error ? spinner.error : spinner.stop)(error ? '此步骤暂停 · 已保留进度与缓存' : '运行环境已就绪');
      spinner = undefined;
    },
  };
}
