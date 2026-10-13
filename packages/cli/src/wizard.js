import { readFile, mkdir, access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { saveState, projectName, validateDataDir, normalizeUrl, ensureEnvironment } from './config.js';
import { availablePort, detectSource, containers } from './docker.js';
import { openWorkspace } from './browser-entry.js';
import { startRuntimeWithUI } from './runtime.js';
import { prepareDocker } from './docker-guidance.js';
import { readiness, request, prepareModels, storageReadiness } from './api.js';
import { TessmoraError, redact } from './errors.js';
import { BACK, backOption, labels, providerLabels } from './ui.js';
import { runtimeJournal } from './runtime-progress.js';
import { modelReporter, chooseModelNetwork, canRepairModelNetwork } from './model-progress.js';
import { modelResultLine, modelTestHint } from './model-results.js';

export function parseCapabilities(value = 'text') {
  const selected = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (!selected.length || selected.some((item) => !Object.hasOwn(labels, item))) throw new TessmoraError('INVALID_CAPABILITY', '能力选项支持 text,image,audio,video，以逗号分隔。');
  return [...new Set(['text', ...selected])];
}

export function parsePort(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TessmoraError('INVALID_PORT', '端口必须是 1024–65535 之间的整数。');
  return port;
}

export async function loadCredentials(options) {
  let credentials = {};
  if (options['credential-file']) {
    try { credentials = JSON.parse(await readFile(resolve(options['credential-file']), 'utf8')); } catch { throw new TessmoraError('CREDENTIAL_FILE', '凭证文件无法读取或不是有效 JSON。', '使用 {"deepseek":"...","siliconflow":"..."} 格式，并限制文件读取权限。'); }
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || Object.entries(credentials).some(([key, value]) => !Object.hasOwn(providerLabels, key) || typeof value !== 'string')) throw new TessmoraError('CREDENTIAL_FILE', '凭证文件仅支持服务商名称到字符串的映射。');
  }
  for (const provider of Object.keys(providerLabels)) {
    const value = process.env[`TESSMORA_${provider.toUpperCase()}_API_KEY`];
    if (value) credentials[provider] = value;
  }
  return credentials;
}

export function requiredProviders(capabilities, status = {}) {
  if (status.capability_checks) {
    const checks = capabilities.flatMap((capability) => status.capability_checks[capability] || []);
    if (checks.length) return [...new Set(checks.map((check) => check.provider))];
  }
  const checks = status.checks || [];
  const base = checks.filter((check) => !['image_captioning', 'audio_transcription', 'video_parsing'].includes(check.task)).map((check) => check.provider);
  const mediaTasks = { image: ['image_captioning'], audio: ['audio_transcription'], video: ['image_captioning', 'audio_transcription', 'video_parsing'] };
  const media = capabilities.flatMap((capability) => mediaTasks[capability] || []).map((task) => {
    const model = status.task_models?.[task];
    return status.models?.find((row) => row.id === model)?.provider || (model?.includes(':') ? model.split(':')[0] : 'siliconflow');
  });
  return [...new Set([...(base.length ? base : ['deepseek', 'siliconflow']), ...media])];
}

async function retryable(ui, action, { back = false, repairNetwork } = {}) {
  while (true) {
    try { return await action(); } catch (error) {
      if (!ui.interactive || error.code === 'CANCELLED') throw error;
      ui.failure(error);
      const next = await ui.select('下一步', [
        { value: 'retry', label: '重新检测 / 重试', hint: '保留已经完成的步骤' },
        ...(repairNetwork && canRepairModelNetwork(error) ? [{ value: 'network', label: '调整模型下载网络', hint: '修改下载源或代理，接着准备' }] : []),
        ...(back ? [backOption] : []),
        { value: 'exit', label: '保存进度，稍后继续' },
      ]);
      if (next === BACK) return BACK;
      if (next === 'exit') throw new TessmoraError('CANCELLED', '已保存进度，随时运行 tessmora setup 继续。');
      if (next === 'network') await repairNetwork();
    }
  }
}

export async function setup(paths, initial, options, ui) {
  if (!ui.interactive && !options.yes) throw new TessmoraError('INTERACTIVE_REQUIRED', '首次配置需要交互式终端。', '在终端运行 tessmora setup；自动化可用 setup --yes --credential-file /安全路径/credentials.json --json。');
  const journal = runtimeJournal(paths);
  try { return await runSetup(paths, initial, { ...options, journal }, ui); }
  catch (error) {
    journal.write(`[${new Date().toISOString()}] ${error.code || 'ERROR'}: ${error.message}\n${error.hint || ''}`);
    if (error.code !== 'CANCELLED' && !error.hint?.includes(journal.path)) error.hint = `${error.hint || ''}\n本次安装日志：${journal.path}`;
    throw error;
  } finally { journal.close(); }
}

async function runSetup(paths, initial, options, ui) {
  ui.intro();
  let state = initial || { schema: 1, project: projectName(paths), capabilities: ['text'], step: 0, stage: 'preferences' };
  if (initial?.mode === 'local' && initial.dataDir && !state.runtimeCreated) {
    const files = await readdir(initial.dataDir).catch(() => []);
    if (files.includes('.tessmora-instance.json') && files.length > 1) state = { ...state, runtimeCreated: true };
  }
  if (initial?.mode === 'local' && initial.url) {
    try {
      const current = await request(initial.url, '/api/setup/status', { timeout: 1500 });
      if (current.capabilities?.length) state = { ...state, capabilities: current.capabilities };
    } catch { /* A stopped instance is brought up below before protected calls. */ }
  }
  if (options['model-endpoint']) state = await saveState(paths, { ...state, modelEndpoint: normalizeUrl(options['model-endpoint']) });
  if (options['build-proxy']) state = await saveState(paths, { ...state, buildProxy: normalizeUrl(options['build-proxy']) });
  if (options.proxy !== undefined) state = await saveState(paths, { ...state, proxy: options.proxy === 'off' ? '' : normalizeUrl(options.proxy) });
  if (options['debian-mirror']) state = await saveState(paths, { ...state, debianMirror: normalizeUrl(options['debian-mirror']) });
  if (options['minio-image']) state = await saveState(paths, { ...state, minioImage: options['minio-image'] });
  let step = options.configure ? 0 : Math.min(state.step ?? 0, 5);
  if (ui.interactive && initial && !options.configure) {
    const choice = await ui.select(initial.stage === 'ready' ? '检测到已有安装' : '上次的配置进度已保留', [
      { value: 'resume', label: initial.stage === 'ready' ? '启动已有实例' : '从上次进度继续', hint: state.url || state.dataDir },
      { value: 'configure', label: '修改配置', hint: '知识库资料与已下载模型保持不变' },
    ]);
    if (choice === 'configure') step = 0;
  }
  if (options.configure || options.mode || options.url || options.capabilities || options['data-dir'] || options.port || options['storage-port'] || (options.source && resolve(options.source) !== state.source)) step = 0;
  const persist = async (nextStep, stage) => { state = await saveState(paths, { ...state, step: nextStep, stage }); step = nextStep; };
  if (state.mode === 'local' && step >= 3) {
    const resumed = await retryable(ui, async () => {
      if (await prepareDocker(ui, { ...options, back: true }) === BACK) return BACK;
      return startRuntimeWithUI(paths, state, options, ui);
    }, { back: true });
    if (resumed === BACK) step = 2;
    else if (step >= 5 && !resumed.setup.ready) {
      ui.info('服务尚未就绪，将继续验证配置与模型缓存。');
      await persist(resumed.setup.tested ? 4 : 3, resumed.setup.tested ? 'preparing' : 'models');
    }
  }
  while (step < 6) {
    if (step === 0) {
      ui.step(1, '选择运行方式', '在本机创建工作台，或连接已经部署的服务。');
      const mode = options.mode || (ui.interactive ? await ui.select('在哪里运行 Tessmora？', [
        { value: 'local', label: '在这台电脑运行', badge: '推荐', hint: 'Docker 为你准备服务，资料保存在本机。' },
        { value: 'remote', label: '连接已有服务', hint: '填写服务地址，使用已经部署好的工作台。' },
      ], state.mode || 'local') : state.mode || 'local');
      if (!['local', 'remote'].includes(mode)) throw new TessmoraError('INVALID_MODE', '--mode 仅支持 local 或 remote。');
      if (state.mode && state.mode !== mode && (initial?.step >= 3 || state.runtimeCreated)) throw new TessmoraError('INSTANCE_MODE', '已有实例不能直接切换本机与远程模式。', '请使用 --instance 新名称创建另一个实例；原实例的管理入口与数据会保留。');
      state = { ...state, mode };
      if (mode === 'remote') {
        const raw = options.url || (ui.interactive ? await ui.text('Tessmora 服务地址', state.mode === 'remote' ? state.url || 'http://localhost:3001' : 'http://localhost:3001', (value) => { try { normalizeUrl(value); } catch (error) { return error.message; } }) : state.url);
        if (!raw) throw new TessmoraError('URL_REQUIRED', '远程模式需要 --url https://your-tessmora.example。');
        state.url = normalizeUrl(raw, { remote: true });
        await persist(1, 'remote-check');
      } else await persist(1, 'capabilities');
    }
    if (state.mode === 'remote' && step === 1) {
      ui.step(2, '检查已有服务', '远程连接只读取健康状态和能力信息。');
      const result = await retryable(ui, () => readiness(state.url), { back: true });
      if (result === BACK) { step = 0; continue; }
      state.capabilities = result.setup.capabilities;
      state.remoteReady = result.setup.ready;
      state.remoteManaged = result.setup.managed !== false;
      await persist(5, result.setup.ready ? 'ready' : state.remoteManaged ? 'remote-pending' : 'connected');
      ui.success('已连接 Tessmora');
      if (!state.remoteManaged) ui.info('这是源码服务，模型由远端环境配置管理。连接检查通过；保留服务报告的模型就绪状态。');
      else if (!result.setup.ready) ui.warn('远程服务尚未完成配置；请在该服务所在机器或其网页配置中完成。');
    }
    if (step === 1) {
      ui.step(2, '选择你的第一种体验', '先准备需要的能力，之后可以随时添加。');
      if (options.capabilities) state.capabilities = parseCapabilities(options.capabilities);
      else if (ui.interactive) {
        const choice = await ui.select('准备使用什么？', [
          { value: 'text', label: '文档问答', badge: '推荐', hint: '从 Markdown、TXT 开始；准备 BGE-M3 检索模型。' },
          { value: 'all', label: '完整多模态', hint: '文档、图片、音频、视频；下载体积更大' },
          { value: 'custom', label: '自定义能力', hint: state.capabilities.map((cap) => labels[cap]).join('、') },
          backOption,
        ], state.capabilities.length === 1 ? 'text' : 'custom');
        if (choice === BACK) { step = 0; continue; }
        state.capabilities = choice === 'all' ? Object.keys(labels) : choice === 'text' ? ['text'] : [...new Set(['text', ...await ui.multiselect('需要哪些能力？', Object.entries(labels).map(([value, label]) => ({ value, label })), state.capabilities)])];
      }
      await persist(2, 'runtime');
    }
    if (step === 2) {
      ui.step(3, '准备运行环境', '程序更新与用户资料分开存放。现有资料不会被清理。');
      const docker = await prepareDocker(ui, { ...options, back: true });
      if (docker === BACK) { step = 1; continue; }
      ui.success(`Docker ${docker.version} · Compose ${docker.compose}${docker.memoryBytes ? ` · ${(docker.memoryBytes / 1024 ** 3).toFixed(1)} GiB / ${docker.cpus} CPU` : ''}`);
      if (docker.advisory) ui.warn(docker.advisory);
      let dataDir = options['data-dir'] ? resolve(options['data-dir']) : state.dataDir || paths.data;
      if (ui.interactive) {
        const action = await ui.select('运行环境设置', [
          { value: 'continue', label: '继续准备', hint: dataDir },
          { value: 'custom', label: '调整目录和端口' },
          backOption,
        ]);
        if (action === BACK) { step = 1; continue; }
        if (action === 'custom') {
          dataDir = await ui.text('数据保存位置', dataDir, validateDataDir);
          options.port = await ui.text('网页端口', String(state.port || 3001), (value) => { try { parsePort(value); } catch (error) { return error.message; } });
          options['storage-port'] = await ui.text('文件存储端口', String(state.storagePort || 9000), (value) => { try { parsePort(value); } catch (error) { return error.message; } });
          state.modelEndpoint = normalizeUrl(await ui.text('本地模型下载地址（仅在需要时改为可信镜像）', state.modelEndpoint || 'https://huggingface.co', (value) => { try { normalizeUrl(value); } catch (error) { return error.message; } }));
        }
      }
      if (state.dataDir && state.dataDir !== dataDir) {
        const previousFiles = await readdir(state.dataDir).catch(() => []);
        const ownedData = previousFiles.includes('.tessmora-instance.json') && previousFiles.length > 1;
        if (initial?.step >= 3 || state.runtimeCreated || ownedData) throw new TessmoraError('DATA_MOVE_REQUIRED', '已有实例的数据目录不能直接更换。', '请先备份并迁移整个数据目录，或使用 --instance 新名称创建独立实例。');
      }
      const invalid = validateDataDir(dataDir);
      if (invalid) throw new TessmoraError('INVALID_DATA_DIR', invalid);
      await mkdir(dataDir, { recursive: true });
      await access(dataDir, constants.W_OK);
      state.dataDir = dataDir;
      state.backendImage = options['backend-image'] || state.backendImage || process.env.TESSMORA_BACKEND_IMAGE;
      state.frontendImage = options['frontend-image'] || state.frontendImage || process.env.TESSMORA_FRONTEND_IMAGE;
      state.source = options.source || state.source ? await detectSource(options.source || state.source) : !state.backendImage && !state.frontendImage ? await detectSource() : undefined;
      const own = await containers(paths, { ...state, port: state.port || 3001, storagePort: state.storagePort || 9000 }).catch(() => []);
      const hasOwn = (service) => own.some((container) => container.Service === service && container.State === 'running');
      const preferredPort = parsePort(options.port, state.port || 3001);
      const port = hasOwn('frontend') && state.port === preferredPort ? preferredPort : await availablePort(preferredPort);
      const preferredStorage = parsePort(options['storage-port'], state.storagePort || 9000);
      const storagePort = hasOwn('minio') && state.storagePort === preferredStorage && port !== preferredStorage ? preferredStorage : await availablePort(preferredStorage, [port]);
      if (port !== preferredPort || storagePort !== preferredStorage) {
        if (!ui.interactive && (options.port || options['storage-port'])) throw new TessmoraError('PORT_CONFLICT', '指定端口已被占用。', `可用端口：网页 ${port}，存储 ${storagePort}。请修改参数重试。`);
        ui.warn(`检测到端口冲突，建议网页 ${port} · 文件存储 ${storagePort}。`);
        if (ui.interactive && !await ui.confirm('使用上述空闲端口？')) { step = 2; continue; }
      }
      state = { ...state, port, storagePort, url: `http://localhost:${port}` };
      await persist(2, 'runtime');
      await ensureEnvironment(paths, state);
      ui.card('本次安装', [
        `工作台  ${state.url}`, `资料    ${state.dataDir}`,
        `能力    ${state.capabilities.map(cap => labels[cap]).join(' · ')}`,
        '', '只管理当前实例。资料与下载缓存会持续保留。',
      ]);
      const started = await retryable(ui, async () => {
        await startRuntimeWithUI(paths, state, options, ui);
        return true;
      }, { back: true });
      if (started === BACK) { step = 2; continue; }
      state.runtimeBuilt = Boolean(state.source);
      state.runtimeCreated = true;
      await persist(3, 'models');
    }
    if (step === 3) {
      const storage = await retryable(ui, async () => {
        const spin = ui.spinner('检查向量与文件存储');
        try {
          const result = await storageReadiness(state.url);
          spin.stop('Qdrant 与 MinIO 连接正常');
          return result;
        } catch (error) { spin.error('存储连接尚未就绪'); throw error; }
      }, { back: true });
      if (storage === BACK) { step = 2; continue; }
      ui.step(4, '连接模型服务', '密钥遮罩输入，保存前进行真实调用。测试会产生少量服务商用量。');
      const env = await ensureEnvironment(paths, state);
      const current = await request(state.url, '/api/setup/config', { token: env.TESSMORA_SETUP_TOKEN });
      const credentials = await loadCredentials(options);
      const selectedProviders = requiredProviders(state.capabilities, current);
      if (ui.interactive) {
        const action = await ui.select('模型配置', [
          { value: 'recommended', label: '使用当前模型组合', hint: `${selectedProviders.map((provider) => providerLabels[provider]).join(' · ')}（包含已启用的 Pi 能力）` },
          { value: 'all', label: '配置服务商凭证', hint: '可保留已有设置，并补充 OpenRouter' },
          backOption,
        ]);
        if (action === BACK) { step = 2; continue; }
        for (const provider of action === 'all' ? Object.keys(providerLabels) : selectedProviders) {
          const existing = current.providers?.[provider]?.configured || Boolean(credentials[provider]);
          if (existing && await ui.confirm(`${providerLabels[provider]} 已配置，继续使用？`)) continue;
          const key = (await ui.password(`${providerLabels[provider]} API Key${selectedProviders.includes(provider) ? '' : '（当前能力未使用，可留空跳过）'}`)).trim();
          if (key) credentials[provider] = key;
        }
      }
      const tested = await retryable(ui, async () => {
        const spin = ui.spinner('实际测试所选能力的模型连接');
        let result;
        try { result = await request(state.url, '/api/setup/test', { token: env.TESSMORA_SETUP_TOKEN, body: { capabilities: state.capabilities, credentials }, timeout: 600000 }); }
        catch (error) { spin.error('模型连接测试未完成'); throw error; }
        if (result.success) spin.stop('模型连接测试通过');
        else spin.error('模型连接测试完成 · 有项目需要修复');
        for (const row of result.results || []) (row.success ? ui.success : ui.warn).call(ui, redact(modelResultLine(row), Object.values(credentials)));
        if (!result.success || !result.test_receipt) throw new TessmoraError('MODEL_TEST_FAILED', '部分模型连接测试未通过，尚未保存本次凭证。', modelTestHint(result.results, state));
        return result;
      }, { back: true });
      if (tested === BACK) { step = 3; continue; }
      await request(state.url, '/api/setup/config', { token: env.TESSMORA_SETUP_TOKEN, body: { capabilities: state.capabilities, credentials, test_receipt: tested.test_receipt }, timeout: 60000 });
      await persist(4, 'preparing');
      ui.success('已保存经过测试的模型配置');
    }
    if (step === 4) {
      const current = await request(state.url, '/api/setup/status');
      if (current.tested === false) {
        ui.info('模型设置或运行版本已变化，需要重新验证连接后继续。');
        await persist(3, 'models');
        continue;
      }
      ui.step(5, '准备所选能力', '只下载本次所需模型。缓存与任务进度会保留。');
      ui.card('本地模型 · 准备路线', [
        '缓存 → 连接下载源 → 下载文件 → 载入 → 推理验证',
        `下载源  ${state.modelEndpoint || 'https://huggingface.co'}`,
        '下载完成后还需载入并验证；首次 CPU 推理可能需要几分钟。',
        '', `本次安装日志：${options.journal.path}`,
      ]);
      const env = await ensureEnvironment(paths, state);
      const prepared = await retryable(ui, async () => {
        const reporter = modelReporter(ui, options.journal);
        try {
          const progress = await prepareModels(state.url, env.TESSMORA_SETUP_TOKEN, {
            onProgress: value => reporter.event(value),
          });
          reporter.close();
          return progress;
        } catch (error) {
          reporter.close(error);
          error.hint = `${error.hint || ''}\n本次安装日志：${options.journal.path}`;
          throw error;
        }
      }, { back: true, repairNetwork: async () => {
        const changes = await chooseModelNetwork(ui, state);
        if (!changes) return;
        state = await saveState(paths, { ...state, ...changes });
        ui.info(`下载源：${state.modelEndpoint || 'https://huggingface.co'} · 正在应用网络设置，复用已有镜像与缓存。`);
        options.journal.write(`[${new Date().toISOString()}] 应用模型下载网络设置 · 下载源 ${state.modelEndpoint || 'https://huggingface.co'}`);
        await retryable(ui, () => startRuntimeWithUI(paths, state, { ...options, rebuild: false }, ui));
      } });
      if (prepared === BACK) { step = 3; continue; }
      const verified = await readiness(state.url);
      if (!verified.setup.ready) throw new TessmoraError('NOT_READY', '模型准备结束，但服务尚未报告完整就绪。', '运行 tessmora doctor 检查，再执行 setup 继续。');
      await persist(5, 'ready');
    }
    if (step === 5) {
      if (state.mode === 'remote') {
        const current = await readiness(state.url);
        state.remoteReady = current.setup.ready;
        state.remoteManaged = current.setup.managed !== false;
        state.capabilities = current.setup.capabilities;
      }
      ui.step(6, '开始使用', '导入一份资料，提问，并打开答案中的引用原文。');
      let shouldOpen = !options['no-open'];
      if (ui.interactive && shouldOpen) shouldOpen = await ui.confirm('现在打开 Tessmora？');
      if (shouldOpen) await openWorkspace(paths, state, ui, { setup: true });
      else ui.info('连接网页：tessmora open；无法自动打开时用 tessmora open --print-url 获取带凭证的连接链接。');
      await persist(6, state.mode === 'remote' && !state.remoteReady ? state.remoteManaged ? 'remote-pending' : 'connected' : 'ready');
      ui.card(state.mode === 'remote' ? '服务已连接' : '你的知识工作台已就绪', [
        state.url, '', '下一步：导入一份资料 → 提问 → 查看引用原文', '',
        '下次启动：tessmora start', '停止服务：tessmora stop', '修改配置：tessmora configure', '排查问题：tessmora doctor',
        ...(state.source ? ['注册终端快捷命令：在源码目录执行 npm --prefix packages/cli run register-command'] : []),
      ]);
      ui.finish('Every fragment finds its place.');
    }
  }
  return { success: true, mode: state.mode, url: state.url, capabilities: state.capabilities, dataDir: state.dataDir, stage: state.stage, reachable: true, ready: state.mode === 'remote' ? state.remoteReady : true };
}
