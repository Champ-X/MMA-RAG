import { dockerCheck, claimDataDir, validatePorts, compose, run, containers } from './docker.js';
import { ensureEnvironment, saveState } from './config.js';
import { waitForService } from './api.js';
import { TessmoraError } from './errors.js';
import { MINIO_IMAGE, LEGACY_MINIO_IMAGE } from './runtime-images.js';
import { runtimeJournal, runtimeReporter, runtimePhases, activitySummary, runtimeFailure } from './runtime-progress.js';
import { collectRuntimeDiagnostics } from './runtime-diagnostics.js';

export async function startRuntime(paths, state, { rebuild = false, onProgress = () => {}, journal } = {}, deps = {}) {
  const operations = { dockerCheck, claimDataDir, validatePorts, compose, run, containers, collectRuntimeDiagnostics, ensureEnvironment, saveState, waitForService, ...deps };
  let phase, target;
  const log = journal || runtimeJournal(paths);
  const detail = (text) => onProgress({ phase, detail: text, activity: true });
  const onLine = (line) => {
    log.write(line);
    const summary = activitySummary(line);
    onProgress({ phase, activity: true, ...(summary ? { detail: `${target ? `${target} · ` : ''}${summary}` } : {}) });
  };
  const stage = async (id, action) => {
    phase = id; target = undefined;
    const title = runtimePhases.find(([key]) => key === id)[1];
    log.write(`\n[${new Date().toISOString()}] ${title}`);
    onProgress({ phase, title, state: 'running' });
    const result = await action();
    onProgress({ phase, title, state: 'done' });
    return result;
  };
  const hasImage = async image => {
    try { await operations.run('docker', ['image', 'inspect', image], { timeout: 10000 }); return true; }
    catch { return false; }
  };
  try {
    let env, serviceImages;
    await stage('check', async () => {
      await operations.dockerCheck();
      await operations.claimDataDir(paths, state);
      await operations.validatePorts(paths, state);
      env = await operations.ensureEnvironment(paths, state);
      // Read effective images without logging the resolved config (it contains secrets).
      const config = JSON.parse(await operations.compose(paths, state, ['config', '--format', 'json']));
      serviceImages = Object.fromEntries(Object.entries(config.services).map(([name, service]) => [name, service.image]));
      if (!state.source) {
        for (const [explicit, image] of [[state.backendImage, env.TESSMORA_BACKEND_IMAGE], [state.frontendImage, env.TESSMORA_FRONTEND_IMAGE]]) {
          if (!explicit && !await hasImage(image)) throw new TessmoraError('SOURCE_REQUIRED', '此开发版本尚未提供公共应用镜像。', '在源码目录运行 tessmora setup --source .；也可指定已发布的 --backend-image 和 --frontend-image。');
        }
      }
    });
    await stage('storage', async () => {
      target = 'MinIO'; detail('1/3 · MinIO 文件存储');
      if (!await hasImage(env.TESSMORA_MINIO_IMAGE)) {
        if (env.TESSMORA_MINIO_IMAGE === MINIO_IMAGE) {
          if (await hasImage(LEGACY_MINIO_IMAGE)) {
            detail('1/3 · 复用本机同版本 MinIO 镜像');
            await operations.run('docker', ['tag', LEGACY_MINIO_IMAGE, MINIO_IMAGE]);
          } else {
            detail('1/3 · 从固定官方源码构建 MinIO，首次可能需要数分钟');
            await operations.compose(paths, state, ['--progress', 'plain', 'build', 'minio'], { minioBuild: true, onLine });
          }
        } else await operations.compose(paths, state, ['--progress', 'plain', 'pull', 'minio'], { onLine });
      }
      for (const [index, service, label] of [[2, 'qdrant', 'Qdrant 向量存储'], [3, 'redis', 'Redis 任务队列']]) {
        target = label; detail(`${index}/3 · ${label}`);
        if (!await hasImage(serviceImages[service])) await operations.compose(paths, state, ['--progress', 'plain', 'pull', service], { onLine });
        else detail(`${index}/3 · ${label}已缓存`);
      }
    });
    await stage('build', async () => {
      if (state.source) {
        const cached = state.runtimeBuilt && await hasImage(env.TESSMORA_BACKEND_IMAGE) && await hasImage(env.TESSMORA_FRONTEND_IMAGE);
        if (!cached || rebuild) {
          target = 'Tessmora'; detail('构建网页、后端与 Pi · 复用已经完成的镜像层');
          await operations.compose(paths, state, ['--progress', 'plain', 'build', 'backend', 'frontend'], { build: true, onLine });
          // Persist immediately: a later startup failure must not lose this checkpoint.
          state.runtimeBuilt = true;
          await operations.saveState(paths, state);
        } else detail('应用镜像已存在，跳过重复构建');
      } else {
        for (const service of ['backend', 'frontend']) {
          target = service; detail(`准备 ${service} 镜像`);
          if (!await hasImage(serviceImages[service])) await operations.compose(paths, state, ['--progress', 'plain', 'pull', service], { onLine });
          else detail(`${service} 镜像已缓存`);
        }
      }
    });
    await stage('start', async () => {
      const previous = await operations.containers(paths, state, { timeout: 8000 });
      const retry = [...new Set(previous.filter(row => ['frontend', 'backend', 'worker'].includes(row.Service) && row.State === 'running' && row.Health === 'unhealthy').map(row => row.Service))];
      if (retry.length) {
        const message = `重新检查异常应用服务：${retry.join('、')} · 健康服务与存储保持运行`;
        detail(message); log.write(message);
        await operations.compose(paths, state, ['restart', '--no-deps', ...retry], { onLine, timeout: 60000 });
      }
      detail('启动 6 个服务并等待健康检查 · 最多 4 分钟');
      await operations.compose(paths, state, ['--progress', 'plain', 'up', '-d', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '240'], { onLine });
    });
    return await stage('ready', async () => {
      detail('检查网页、API 与首次配置接口');
      return operations.waitForService(state.url);
    });
  } catch (error) {
    log.write(`${error.message}\n${error.hint || ''}`);
    let diagnostics;
    if (['start', 'ready'].includes(phase) && error.code !== 'CANCELLED') {
      detail('正在定位未就绪的服务 · 采集探针、内网连接和日志');
      try { diagnostics = await operations.collectRuntimeDiagnostics(paths, state, { journal: log, onProgress: detail }); }
      catch { log.write('诊断采集未完成，保留原始启动错误。'); }
    }
    throw runtimeFailure(error, { phase, target, logPath: log.path, diagnostics });
  } finally { if (!journal) log.close(); }
}

export async function startRuntimeWithUI(paths, state, options, ui) {
  const journal = options.journal || runtimeJournal(paths);
  const reporter = runtimeReporter(ui, { logPath: journal.path, source: state.source });
  let failure;
  try { return await startRuntime(paths, state, { ...options, journal, onProgress: event => reporter.event(event) }); }
  catch (error) { failure = error; throw error; }
  finally { if (!options.journal) journal.close(); reporter.close(failure); }
}
