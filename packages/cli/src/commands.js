import { stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { readState, ensureEnvironment } from './config.js';
import { compose, containers, openBrowser } from './docker.js';
import { startRuntimeWithUI } from './runtime.js';
import { prepareDocker, checkDockerWithGuidance } from './docker-guidance.js';
import { readiness, request } from './api.js';
import { setup } from './wizard.js';
import { TessmoraError, publicError } from './errors.js';
import { collectRuntimeDiagnostics, diagnosticSummary, serviceReady, runtimeServices } from './runtime-diagnostics.js';

export async function execute(command, paths, options, ui) {
  const state = await readState(paths);
  if (command === 'setup' || command === 'configure' || (!command && (!state || (state.step ?? 0) < 6))) return setup(paths, state, { ...options, configure: command === 'configure' }, ui);
  command ||= 'start';
  const runtimeConfigured = state?.url && ['local', 'remote'].includes(state.mode) && (state.mode !== 'local' || state.dataDir && state.port && state.storagePort);
  if (command === 'doctor' && !runtimeConfigured) {
    const checks = [{ name: 'node', success: true, result: process.version }];
    try { checks.push({ name: 'docker', success: true, result: await checkDockerWithGuidance() }); }
    catch (error) { checks.push({ name: 'docker', success: false, ...publicError(error) }); }
    ui.info(state ? '安装尚未完成。重新运行原来的 setup 命令继续。' : '尚未创建实例。运行 tessmora setup 开始首次配置。');
    if (!options.json) ui.card('安装前检查', checks.map((row) => `${row.success ? '✓' : '○'} ${row.name}: ${row.success ? '通过' : `${row.message}\n  ${row.hint || ''}`}`));
    return { success: checks.every((row) => row.success), configured: false, checks, next: 'tessmora setup' };
  }
  if (!state) throw new TessmoraError('NOT_CONFIGURED', '还没有配置 Tessmora。', '运行 tessmora setup 开始引导。');
  if (!runtimeConfigured) {
    throw new TessmoraError('SETUP_INCOMPLETE', '实例的运行环境尚未配置完整。', '运行 tessmora setup 从上次进度继续。');
  }
  if (command === 'start') {
    if (state.mode === 'local') {
      await prepareDocker(ui, options);
      await startRuntimeWithUI(paths, state, options, ui);
    }
    const status = await readiness(state.url);
    if (state.mode === 'remote' && status.setup.managed === false) ui.info('已连接源码服务，模型配置由远端环境管理。');
    else if (status.setup.setup_required) ui.warn('服务已启动，首次配置尚未完成。运行 tessmora setup 继续。');
    else if (!status.setup.tested) ui.info('模型配置已变更；现有工作台可以继续使用，configure 可重新验证连接。');
    if (!options['no-open']) await openInstance(paths, state, ui);
    if (!options.json) ui.finish(`${state.url}\n状态：tessmora status · 日志：tessmora logs`);
    return { success: true, url: state.url, ready: status.setup.ready, setup: status.setup };
  }
  if (command === 'open') {
    await readiness(state.url);
    return { success: await openInstance(paths, state, ui), url: state.url };
  }
  if (command === 'stop') {
    if (state.mode === 'remote') throw new TessmoraError('REMOTE_READ_ONLY', '远程连接不会停止服务器。', '请在服务所在机器管理其运行状态。');
    await compose(paths, state, ['stop'], { onLine: (line) => ui.info(line) });
    ui.success('本实例已停止，所有资料与配置已保留。');
    return { success: true, stopped: true, dataDir: state.dataDir };
  }
  if (command === 'status') {
    let status, error;
    try { status = await readiness(state.url); } catch (cause) { error = publicError(cause); }
    const runtime = state.mode === 'local' ? await containers(paths, state).catch(() => []) : [];
    const result = { success: !error, mode: state.mode, url: state.url, stage: state.stage, dataDir: state.dataDir, ...(status ? { setup: status.setup } : { error }), containers: runtime.map(({ Service, State, Health }) => ({ service: Service, state: State, health: Health })) };
    if (!options.json) {
      const check = (value) => value ? '✓' : '○';
      ui.card('运行状态', [
        `运行方式  ${state.mode === 'local' ? '本机 Docker' : '远程连接'}`,
        `工作台    ${state.url}`,
        ...(state.dataDir ? [`资料目录  ${state.dataDir}`] : []),
        '',
        ...(status ? [
          `✓ 应用可访问`,
          `${check(status.setup.configured)} 模型凭证  ${status.setup.configured ? '已配置' : '待配置'}`,
          `${check(status.setup.tested)} 连接测试  ${status.setup.tested ? '已通过' : '待验证'}`,
          `${check(status.setup.prepared)} 本地模型  ${status.setup.prepared ? '已就绪' : status.setup.progress?.state === 'running' ? '准备中' : '待准备'}`,
        ] : [`○ ${error.message}`]),
        ...(result.containers.length ? ['', ...result.containers.map((row) => `${row.state === 'running' && row.health !== 'unhealthy' ? '✓' : '○'} ${row.service.padEnd(10)} ${row.health || row.state}`)] : []),
        '',
        error ? '下一步  tessmora start / tessmora doctor' : status.setup.setup_required ? '下一步  tessmora setup' : '打开网页  tessmora open',
      ]);
    }
    return result;
  }
  if (command === 'logs') {
    if (state.mode === 'remote') throw new TessmoraError('REMOTE_READ_ONLY', '远程连接不读取服务器日志。', '请在服务所在机器运行 tessmora logs。');
    const tail = options.tail || '100';
    if (!/^\d+$/.test(tail) || Number(tail) > 10000) throw new TessmoraError('INVALID_TAIL', '--tail 必须为 0–10000。');
    const service = options.service;
    if (service && !['frontend', 'backend', 'worker', 'minio', 'qdrant', 'redis'].includes(service)) throw new TessmoraError('INVALID_SERVICE', '未知服务名称。');
    const output = await compose(paths, state, ['logs', '--no-color', '--tail', tail, ...(options.follow ? ['--follow'] : []), ...(service ? [service] : [])], { onLine: options.follow ? (line) => ui.info(line) : undefined });
    if (!options.json && !options.follow) ui.info(output);
    return { success: true, ...(options.follow ? {} : { logs: output }) };
  }
  if (command === 'doctor') {
    const checks = [];
    const check = async (name, action) => {
      try { checks.push({ name, success: true, result: await action() }); }
      catch (error) { checks.push({ name, success: false, ...publicError(error) }); }
    };
    if (state.mode === 'local') {
      await check('docker', checkDockerWithGuidance);
      await check('data_directory', async () => { await access(state.dataDir, constants.W_OK); return state.dataDir; });
      await check('private_environment', async () => {
        const mode = (await stat(paths.env)).mode & 0o777;
        if (process.platform !== 'win32' && (mode & 0o077)) throw new TessmoraError('ENV_PERMISSIONS', '运行配置可被其他用户读取。', `请将 ${paths.env} 的权限设为 600。`);
        return '权限正确';
      });
      await check('containers', async () => {
        const list = await containers(paths, state);
        const missing = runtimeServices.filter(name => !list.some(container => container.Service === name && serviceReady({ state: container.State, health: container.Health })));
        if (missing.length) {
          const diagnostics = await collectRuntimeDiagnostics(paths, state);
          const summary = diagnosticSummary(diagnostics);
          if (summary.failed.length || diagnostics.unavailable) throw new TessmoraError('CONTAINERS_NOT_RUNNING', `尚未就绪：${(summary.failed.length ? summary.failed : missing).join(', ')}`, summary.lines.join('\n'));
        }
        return '全部运行中';
      });
    }
    await check('application', async () => {
      const result = await readiness(state.url);
      if (result.setup.setup_required) throw new TessmoraError('SETUP_INCOMPLETE', '应用可访问，但模型配置或准备尚未完成。', '运行 tessmora setup 继续首次配置。');
      return { capabilities: result.setup.capabilities, ready: result.setup.ready, tested: result.setup.tested };
    });
    await check('knowledge_storage', async () => {
      const result = await request(state.url, '/api/knowledge/', { timeout: 15000 });
      if (!Array.isArray(result.knowledge_bases)) throw new TessmoraError('STORAGE_RESPONSE', '知识库服务没有返回预期的数据结构。');
      return { accessible: true, knowledgeBases: result.knowledge_bases.length };
    });
    const names = { docker: 'Docker 与 Compose', data_directory: '资料目录', private_environment: '配置访问权限', containers: '运行中的服务', application: '应用连接与配置状态', knowledge_storage: '知识库存储' };
    for (const row of checks) (row.success ? ui.success : ui.warn).call(ui, `${names[row.name] || row.name}: ${row.success ? '通过' : `${row.message}${row.hint ? `\n${row.hint}` : ''}`}`);
    const docker = checks.find((row) => row.name === 'docker')?.result;
    if (docker?.memoryBytes) ui.info(`Docker 资源：${(docker.memoryBytes / 1024 ** 3).toFixed(1)} GiB · ${docker.cpus} CPU`);
    if (docker?.advisory) ui.warn(docker.advisory);
    if (!options.json) ui.finish(`${checks.filter((row) => row.success).length}/${checks.length} 项检查通过${checks.every((row) => row.success) ? ` · ${state.url}` : '\n按上方提示修复后，重新运行 tessmora doctor。'}`);
    return { success: checks.every((check) => check.success), checks, url: state.url };
  }
  throw new TessmoraError('UNKNOWN_COMMAND', `未知命令 ${command}。`, '运行 tessmora --help 查看命令。');
}

async function openInstance(paths, state, ui) {
  const env = state.mode === 'local' ? await ensureEnvironment(paths, state) : {};
  const url = env.TESSMORA_SETUP_TOKEN ? `${state.url}/#setup_token=${encodeURIComponent(env.TESSMORA_SETUP_TOKEN)}` : state.url;
  const opened = await openBrowser(url);
  if (!opened) ui.warn(`未能自动打开浏览器，请访问 ${state.url}。`);
  return opened;
}
