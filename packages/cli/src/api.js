import { TessmoraError, redact } from './errors.js';

export async function request(baseUrl, path, { token, body, timeout = 30000, method = body ? 'POST' : 'GET', fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Tessmora-Setup-Token': token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
  } catch (error) {
    throw new TessmoraError('SERVICE_UNREACHABLE', `无法连接 ${baseUrl}。`, '确认服务已启动并检查地址；运行 tessmora doctor 查看诊断。');
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof json?.detail === 'string' ? json.detail : json?.detail?.message;
    throw new TessmoraError(response.status === 401 || response.status === 403 ? 'SETUP_AUTH' : 'API_ERROR', redact(detail || `服务返回 HTTP ${response.status}。`, [token, ...Object.values(body?.credentials || {})]), response.status === 401 || response.status === 403 ? '请使用创建此本机实例的配置目录。安装令牌不会通过公开接口返回。' : '运行 tessmora logs 检查服务日志，然后重试。');
  }
  if (!json || typeof json !== 'object') throw new TessmoraError('INVALID_RESPONSE', '服务没有返回有效的 JSON 响应。', '确认地址指向 Tessmora 服务。');
  return json;
}

export async function readiness(baseUrl) {
  const health = await request(baseUrl, '/health', { timeout: 8000 });
  if (!['ok', 'healthy'].includes(health.status)) throw new TessmoraError('UNHEALTHY', '服务健康检查尚未通过。');
  const setup = await request(baseUrl, '/api/setup/status', { timeout: 8000 });
  if (typeof setup.ready !== 'boolean') throw new TessmoraError('INCOMPATIBLE_SERVICE', '服务未提供兼容的首次配置接口。', '请更新 Tessmora 服务至支持此 CLI 的版本。');
  return { health, setup };
}

export async function storageReadiness(baseUrl) {
  const result = await request(baseUrl, '/api/setup/storage', { timeout: 20000 });
  if (typeof result.success !== 'boolean' || !Array.isArray(result.checks) ||
      !['qdrant', 'minio'].every(name => result.checks.some(row => row.name === name && typeof row.success === 'boolean'))) {
    throw new TessmoraError('STORAGE_RESPONSE', '服务未提供完整的存储检查结果。', '请更新 Tessmora 后端，再运行 tessmora doctor。');
  }
  const failed = result.checks.filter(row => !row.success);
  if (!result.success || failed.length) {
    throw new TessmoraError('STORAGE_UNAVAILABLE', failed.map(row => row.message || `${row.name} 尚未就绪`).join('\n') || '存储尚未就绪。',
      [...new Set(failed.map(row => row.hint).filter(Boolean))].join('\n') || '运行 tessmora doctor 检查存储服务。', { checks: result.checks });
  }
  return result;
}

export async function waitForService(baseUrl, { timeout = 180000, interval = 1500, onWait } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { return await readiness(baseUrl); } catch (error) { last = error; }
    onWait?.();
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw last || new TessmoraError('START_TIMEOUT', '等待服务启动超时。', '运行 tessmora logs 查看日志，重新运行 setup 可继续。');
}

export async function prepareModels(baseUrl, token, { onProgress, pollInterval = 1500, timeout = 60 * 60 * 1000 } = {}) {
  let progress = await request(baseUrl, '/api/setup/prepare', { token, body: {} });
  const deadline = Date.now() + timeout;
  while (true) {
    onProgress?.(progress);
    if (progress.state === 'ready') return progress;
    if (['error', 'interrupted'].includes(progress.state)) {
      if (progress.error_code === 'STORAGE_UNAVAILABLE') {
        throw new TessmoraError('STORAGE_UNAVAILABLE', progress.message || '存储初始化失败。',
          progress.hint || '运行 tessmora doctor 检查；配置与下载缓存已保留，修复后重新运行 tessmora setup。',
          { stage: 'storage', errorType: progress.error_type, storage: progress.storage });
      }
      const failed = Object.entries(progress.models || {}).filter(([, model]) => ['error', 'interrupted'].includes(model.state)).map(([name, model]) => `${name}: ${model.message || model.error || model.state}`).join('; ');
      throw new TessmoraError('MODEL_PREPARE_FAILED', failed || progress.message || '模型准备中断。', '已完成的下载将保留；重新运行 tessmora setup 可继续。');
    }
    if (Date.now() >= deadline) throw new TessmoraError('MODEL_PREPARE_TIMEOUT', '模型仍在准备中，已结束本次等待。', '后台任务和下载缓存已保留。运行 tessmora status 查看状态，setup 可继续。');
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    progress = await request(baseUrl, '/api/setup/progress', { timeout: 10000 });
  }
}
