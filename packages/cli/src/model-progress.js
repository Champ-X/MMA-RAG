import { BACK, backOption } from './ui.js';
import { normalizeUrl } from './config.js';
import { duration } from './terminal.js';

export const modelNames = { bge_m3: 'BGE-M3', clip: 'CLIP', clap: 'CLAP' };
export const modelPhases = { cache: '检查缓存', metadata: '连接下载源', download: '下载文件', verify: '校验文件', load: '载入模型', load_download: '下载与载入', inference: '推理验证', artifacts: '保存验证结果' };
const networkCodes = new Set(['MODEL_NETWORK', 'MODEL_PROXY', 'MODEL_DOWNLOAD_TIMEOUT', 'MODEL_DOWNLOAD_HTTP', 'MODEL_TLS', 'MODEL_NOT_FOUND', 'MODEL_ACCESS_DENIED']);
export const canRepairModelNetwork = error => networkCodes.has(error.details?.model?.error_code);

export function formatBytes(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GiB`;
  return `${Math.round(size / 1024 ** 2)} MiB`;
}

export function modelActivity(name, row) {
  const label = modelNames[name] || name;
  let activity = row.message || modelPhases[row.phase] || '准备中';
  if (row.phase === 'download') {
    if (Number.isFinite(row.total_bytes) && row.total_bytes > 0 && Number.isFinite(row.downloaded_bytes)) {
      const done = Math.min(row.downloaded_bytes, row.total_bytes);
      activity = `下载 ${formatBytes(done)} / ${formatBytes(row.total_bytes)} · ${Math.floor(done / row.total_bytes * 100)}%`;
    } else if (Number.isFinite(row.files_total)) activity = `下载文件 ${row.files_completed || 0}/${row.files_total}`;
    if (row.state === 'running' && row.idle_seconds >= 20) activity += ' · 等待新数据';
  }
  return `${label} · ${activity}`;
}

export function modelReporter(ui, journal) {
  let spinner, active, lastLog = 0, signature, closed = false;
  const completed = new Set();
  return {
    event(value) {
      const current = Object.entries(value.models || {}).find(([, row]) => ['running', 'error', 'interrupted'].includes(row.state));
      const key = value.stage === 'storage' ? 'storage' : current?.[0];
      if (active && active !== key && spinner) {
        spinner.stop(active === 'storage' ? '存储与检索集合已就绪' : `${modelNames[active] || active} 已通过推理验证`);
        completed.add(active); spinner = undefined;
      }
      for (const [name, row] of Object.entries(value.models || {})) {
        if (row.state === 'ready' && !completed.has(name)) { ui.success(`${modelNames[name] || name} · 缓存已验证`); completed.add(name); }
      }
      active = key;
      const message = value.stage === 'storage' ? value.message || '检查存储并准备检索集合' : current ? modelActivity(...current) : '所选模型已就绪';
      if (key && !spinner) spinner = ui.spinner(message);
      else spinner?.message(message);
      const next = `${value.state}:${value.stage}:${current?.[0]}:${current?.[1].phase}:${current?.[1].state}`;
      if (next !== signature || Date.now() - lastLog >= 15000) {
        journal.write(`[${new Date().toISOString()}] ${message}${value.elapsed_seconds ? ` · 已用时 ${duration(value.elapsed_seconds * 1000)}` : ''}`);
        signature = next; lastLog = Date.now();
      }
    },
    close(error) {
      if (closed) return;
      closed = true;
      if (spinner) (error ? spinner.error : spinner.stop)(error ? '此项尚未完成 · 进度已保存' : '模型已通过真实推理验证');
      spinner = undefined;
      if (error) journal.write(`[${new Date().toISOString()}] ${error.code}: ${error.message}\n${error.hint || ''}`);
    },
  };
}

// Changing a download source is always an explicit user choice. Reapplying
// Compose is owned by the caller so this menu is testable without Docker.
export async function chooseModelNetwork(ui, state) {
  const choice = await ui.select('调整模型下载网络', [
    { value: 'official', label: '使用 Hugging Face 官方源', hint: 'https://huggingface.co' },
    { value: 'mirror', label: '使用 HF-Mirror 镜像', hint: '第三方下载源 · https://hf-mirror.com' },
    { value: 'custom', label: '输入其他可信下载源' },
    { value: 'proxy', label: '设置 / 关闭运行代理', hint: '需填写容器可达的代理地址' },
    backOption,
  ]);
  if (choice === BACK) return null;
  if (choice === 'official' || choice === 'mirror') return { modelEndpoint: choice === 'official' ? 'https://huggingface.co' : 'https://hf-mirror.com' };
  const validate = value => { try { normalizeUrl(value); } catch (error) { return error.message; } };
  if (choice === 'custom') return { modelEndpoint: normalizeUrl(await ui.text('可信模型下载地址', state.modelEndpoint || 'https://huggingface.co', validate)) };
  ui.info('请填写 Docker / WSL 容器可访问的代理地址；容器内的 127.0.0.1 不指向宿主机。输入 off 关闭运行代理。');
  const proxy = await ui.text('运行代理（同时用于模型下载与 API 调用）', state.proxy || 'off', value => value === 'off' ? undefined : validate(value));
  return { proxy: proxy === 'off' ? '' : normalizeUrl(proxy) };
}
