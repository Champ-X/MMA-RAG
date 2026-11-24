import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, validId, WorkspaceError } from './workspaces.mjs';

// Electron safeStorage delegates to the OS credential service. Never fall back to plaintext.
export class CredentialStore {
  constructor(directory, safeStorage) { this.directory = directory; this.safeStorage = safeStorage; this.memory = new Map(); }
  async available() {
    return await this.safeStorage.isAsyncEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  }
  path(id) {
    if (!validId(id)) throw new WorkspaceError('WORKSPACE_NOT_FOUND', '工作区不存在。');
    return join(this.directory, `${id}.json`);
  }
  async set(id, value, { persist = true } = {}) {
    this.path(id);
    const token = String(value || '').trim();
    if (!token || token.length > 8192 || /[\s\x00-\x1f\x7f]/.test(token)) throw new WorkspaceError('CREDENTIAL_INVALID', '访问凭证不能为空或包含空白。');
    if (persist) {
      let encrypted;
      try {
        if (!await this.available()) throw new Error();
        encrypted = (await this.safeStorage.encryptStringAsync(token)).toString('base64');
      } catch {
        throw new WorkspaceError('KEYCHAIN_LOCKED', '系统凭证库不可用。请解锁凭证库，或取消“记住凭证”仅连接本次会话。');
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await atomicJson(this.path(id), { version: 1, encrypted });
    } else await unlink(this.path(id)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    this.memory.set(id, token);
  }
  async get(id) {
    if (this.memory.has(id)) return this.memory.get(id);
    let data;
    try { data = JSON.parse(await readFile(this.path(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new WorkspaceError('CREDENTIAL_UNREADABLE', '访问凭证无法读取，请重新连接。'); }
    if (!await this.available().catch(() => false)) throw new WorkspaceError('KEYCHAIN_LOCKED', '系统凭证库已锁定，请解锁后重试。');
    try {
      if (data.version !== 1 || typeof data.encrypted !== 'string') throw new Error();
      const { result: token } = await this.safeStorage.decryptStringAsync(Buffer.from(data.encrypted, 'base64'));
      this.memory.set(id, token);
      return token;
    } catch { throw new WorkspaceError('CREDENTIAL_UNREADABLE', '无法解密访问凭证，请重新连接。'); }
  }
  async remove(id) {
    this.memory.delete(id);
    await unlink(this.path(id)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
