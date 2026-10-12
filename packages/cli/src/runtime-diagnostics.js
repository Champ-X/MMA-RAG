import { compose, containers, run, runtimeSecrets } from './docker.js';
import { redact } from './errors.js';
import { plainLine } from './terminal.js';

export const runtimeServices = ['frontend', 'backend', 'worker', 'minio', 'qdrant', 'redis'];
export const serviceReady = row => row.state === 'running' && (!row.health || row.health === 'healthy');

// No application imports or credentials: distinguish container DNS from TCP reachability.
const networkProbe = `import json, socket
from concurrent.futures import ThreadPoolExecutor
def check(target):
    host, port = target
    result = {"target": f"{host}:{port}"}
    try:
        result["addresses"] = sorted({item[4][0] for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})
    except OSError:
        return dict(result, status="dns_failed")
    try:
        with socket.create_connection((host, port), timeout=2):
            return dict(result, status="connected")
    except TimeoutError:
        return dict(result, status="tcp_timeout")
    except OSError:
        return dict(result, status="tcp_failed")
with ThreadPoolExecutor(max_workers=3) as pool:
    print(json.dumps(list(pool.map(check, [("redis", 6379), ("minio", 9000), ("qdrant", 6333)]))))
`;

export async function collectRuntimeDiagnostics(paths, state, { journal, onProgress = () => {} } = {}, deps = {}) {
  const operations = { compose, containers, run, runtimeSecrets, ...deps };
  const secrets = await operations.runtimeSecrets(paths, state);
  const clean = text => redact(String(text || ''), secrets);
  const line = text => plainLine(clean(text)).slice(0, 1200);
  const write = text => journal?.write(clean(text));
  write(`[${new Date().toISOString()}] 启动诊断（仅当前实例）`);
  let list;
  try { list = await operations.containers(paths, state, { timeout: 8000 }); }
  catch (error) {
    const unavailable = line(`${error.message} ${error.hint || ''}`);
    write(`无法读取容器状态：${unavailable}`);
    return { services: [], unavailable };
  }
  const services = await Promise.all(runtimeServices.map(async service => {
    const container = list.find(row => row.Service === service);
    const row = { service, state: container?.State || 'missing', health: container?.Health || '' };
    if (!container) return row;
    // IDs come only from this project's Compose ps; never inspect global containers or Env.
    if (/^[a-f0-9]{12,64}$/.test(container.ID || '')) {
      try {
        const info = JSON.parse(await operations.run('docker', ['inspect', '--format', '{"state":{{json .State}},"restarts":{{.RestartCount}}}', container.ID], { timeout: 8000, secrets }));
        Object.assign(row, {
          state: info.state.Status, health: info.state.Health?.Status || '',
          exitCode: info.state.ExitCode, oomKilled: info.state.OOMKilled, restarts: info.restarts,
          error: line(info.state.Error),
          checks: (info.state.Health?.Log || []).slice(-3).map(check => ({ at: check.End, exitCode: check.ExitCode, output: line(check.Output) })),
        });
      } catch (error) { row.inspectError = line(error.message); }
    }
    if (!serviceReady(row)) {
      onProgress(`采集 ${service} 的健康检查与日志`);
      try {
        row.logs = clean(await operations.compose(paths, state, ['logs', '--no-color', '--no-log-prefix', '--tail', '80', service], { timeout: 8000 })).slice(-12000);
      } catch (error) { row.logsError = line(error.message); }
      if (['worker', 'backend'].includes(service) && row.state === 'running') {
        try {
          row.connections = JSON.parse(await operations.compose(paths, state, ['exec', '-T', service, 'python', '-c', networkProbe], { timeout: 8000 }));
        } catch { row.networkError = '容器网络探测未完成；请查看健康检查与服务日志。'; }
      }
    }
    return row;
  }));
  // Stable, readable order in the receipt, independent of diagnostic completion order.
  for (const { logs, ...row } of services) {
    write(JSON.stringify(row));
    if (logs) {
      write(`--- ${row.service} 最近日志 ---`);
      for (const entry of logs.split(/\r?\n/)) write(line(entry));
    }
  }
  return { services };
}

export function diagnosticSummary(diagnostics) {
  const services = diagnostics?.services || [];
  const failed = services.filter(row => !serviceReady(row));
  const lines = [];
  if (services.length) lines.push(`服务状态 · ${services.filter(serviceReady).length}/${runtimeServices.length} 项就绪`);
  const ready = services.filter(serviceReady).map(row => row.service);
  if (ready.length) lines.push(`✓ 已就绪：${ready.join('、')}`);
  for (const row of failed) {
    lines.push('', `× ${row.service} · ${row.health || row.state}${row.oomKilled ? ' · 内存不足（OOM）' : row.state === 'exited' ? ` · 退出码 ${row.exitCode ?? '未知'}` : ''}`);
    const probe = row.checks?.at(-1)?.output;
    const errorLog = row.logs?.split(/\r?\n/).filter(entry => /error|exception|cannot connect|timed? ?out|permission denied|no space left|killed/i.test(entry)).at(-1);
    if (probe) lines.push(`  探针：${plainLine(probe).slice(0, 220)}`);
    if (errorLog) lines.push(`  日志：${plainLine(errorLog).slice(0, 260)}`);
    if (row.error) lines.push(`  容器：${row.error.slice(0, 220)}`);
    if (row.connections) {
      const status = { connected: '可连接', dns_failed: 'DNS 失败', tcp_timeout: '连接超时', tcp_failed: '连接失败' };
      for (const link of row.connections) lines.push(`  ${link.target} · ${status[link.status] || link.status}`);
    }
    if (row.networkError) lines.push(`  ${row.networkError}`);
    if (row.inspectError || row.logsError) lines.push(`  诊断未完整采集：${row.inspectError || row.logsError}`);
  }
  if (diagnostics?.unavailable) lines.push(`无法采集诊断：${diagnostics.unavailable}`);
  if (failed.some(row => row.oomKilled)) lines.push('', 'Docker 报告进程因内存不足被终止。增加 Docker / WSL 可用内存后重试。');
  if (failed.some(row => row.connections?.some(link => link.status !== 'connected'))) {
    lines.push('', '容器间连接失败。检查 Docker / WSL 网络与 VPN 路由；代理仅用于外部下载，不能修复内部 Redis 连接。');
  } else if (failed.some(row => row.service === 'worker' && /Cannot connect to redis|No nodes replied/i.test(`${row.logs} ${row.checks?.at(-1)?.output}`))) {
    lines.push('', '任务服务尚未响应；Redis 自身健康不代表 worker 能连接到它。网络恢复后可重新运行 setup。');
  }
  if (failed.length) lines.push('', ...failed.map(row => `查看 ${row.service}：tessmora logs --service ${row.service} --tail 80`));
  return { failed: failed.map(row => row.service), lines };
}
