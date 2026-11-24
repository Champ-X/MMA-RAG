import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class WorkspaceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const validId = value => typeof value === 'string' && /^[a-z0-9-]{8,80}$/.test(value);
export function normalizeRemoteUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new WorkspaceError('ADDRESS_INVALID', '请输入完整的 HTTPS 服务地址。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new WorkspaceError('ADDRESS_INVALID', '远程工作区需使用 HTTPS 根地址；本机测试服务可使用 HTTP。请单独填写访问凭证。');
  }
  return url.origin;
}
export function validateName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new WorkspaceError('NAME_INVALID', '请填写 1–80 个字符的工作区名称。');
  return name;
}
export async function atomicJson(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
  await chmod(path, 0o600);
}
export class WorkspaceStore {
  constructor(directory) { this.directory = directory; this.file = join(directory, 'workspaces.json'); this.queue = Promise.resolve(); }
  async read() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.workspaces) || data.workspaces.some(w => !validId(w.id) || !['local', 'remote'].includes(w.mode))) throw new Error();
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, workspaces: [] };
      throw new WorkspaceError('WORKSPACE_STATE_INVALID', '无法读取工作区连接档案。原文件已保留，请恢复备份或选择其他应用配置目录。');
    }
  }
  async mutate(update) {
    const operation = this.queue.then(async () => {
      const data = await this.read();
      const result = await update(data);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await atomicJson(this.file, data);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async add({ mode, name, url, directory }) {
    name = validateName(name);
    if (!['remote', 'local'].includes(mode)) throw new WorkspaceError('MODE_INVALID', '请选择本地或远程工作区。');
    if (mode === 'remote') url = normalizeRemoteUrl(url);
    else {
      if (typeof directory !== 'string' || !directory) throw new WorkspaceError('DIRECTORY_REQUIRED', '请选择工作区资料目录。');
      directory = await realpath(resolve(directory));
    }
    return this.mutate(data => {
      const duplicate = data.workspaces.find(w => w.mode === mode && (mode === 'local' ? w.directory === directory : w.url === url));
      if (duplicate) throw new WorkspaceError('WORKSPACE_EXISTS', '这个工作区已在列表中，请打开已有连接。');
      const workspace = { id: randomUUID(), mode, name, ...(mode === 'remote' ? { url } : { directory }), createdAt: new Date().toISOString() };
      data.workspaces.push(workspace);
      return workspace;
    });
  }
  async get(id) {
    if (!validId(id)) throw new WorkspaceError('WORKSPACE_NOT_FOUND', '工作区不存在。');
    const result = (await this.read()).workspaces.find(w => w.id === id);
    if (!result) throw new WorkspaceError('WORKSPACE_NOT_FOUND', '工作区不存在。');
    return result;
  }
  async bindIdentity(id, serverId) {
    if (!validId(serverId)) throw new WorkspaceError('SERVER_ID_INVALID', '服务未提供有效的工作区身份。');
    return this.mutate(data => {
      const workspace = data.workspaces.find(w => w.id === id);
      if (!workspace) throw new WorkspaceError('WORKSPACE_NOT_FOUND', '工作区不存在。');
      if (workspace.serverId && workspace.serverId !== serverId) throw new WorkspaceError('WORKSPACE_ID_CHANGED', '此地址指向了不同的工作区。请创建新的连接，避免混用历史与附件。');
      workspace.serverId = serverId;
      workspace.lastOpenedAt = new Date().toISOString();
      return workspace;
    });
  }
  async remove(id) {
    await this.mutate(data => { data.workspaces = data.workspaces.filter(w => w.id !== id); });
  }
}
