import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A renderer can only stream into a main-process-created, window-bound backup request. */
export function createHistoryExportManager({ ipcMain, isAuthorized }) {
  const pending = new Map();
  function recordFor(event, value) {
    const record = pending.get(value?.requestId);
    if (!record || record.window.isDestroyed() || event.sender !== record.window.webContents || !isAuthorized(event, record.workspaceId)) throw new Error('归档请求来源无效。');
    return record;
  }
  async function fail(record, error) {
    if (!pending.has(record.requestId)) return;
    pending.delete(record.requestId); clearTimeout(record.timer);
    record.window.webContents.removeListener('destroyed', record.destroyed);
    await record.file.close().catch(() => {}); await unlink(record.temporary).catch(() => {});
    record.reject(error);
  }
  ipcMain.handle('desktop:history-chunk', async (event, value) => {
    const record = recordFor(event, value);
    if (record.writing || value.sequence !== record.sequence || !(value.bytes instanceof Uint8Array) || !value.bytes.length || value.bytes.length > 4 * 1024 * 1024 || record.size + value.bytes.length > 8 * 1024 ** 3 + 32 * 1024 ** 2) {
      await fail(record, new Error('归档分段无效或超出限制。')); throw new Error('归档分段无效。');
    }
    record.writing = true;
    try {
      let offset = 0;
      while (offset < value.bytes.length) {
        const result = await record.file.write(value.bytes, offset, value.bytes.length - offset, record.size + offset);
        if (!result.bytesWritten) throw new Error('归档写入失败。');
        offset += result.bytesWritten;
      }
      record.size += value.bytes.length; record.sequence++;
    } catch { await fail(record, new Error('归档写入失败，请检查可用空间。')); throw new Error('归档写入失败。'); }
    finally { record.writing = false; }
  });
  ipcMain.handle('desktop:history-finish', async (event, value) => {
    const record = recordFor(event, value);
    if (value.error || record.writing || record.size < 18) { await fail(record, new Error('无法完整导出会话与附件，请检查浏览器存储和磁盘空间。')); return; }
    try {
      const header = Buffer.alloc(18); await record.file.read(header, 0, header.length, 0);
      if (header.subarray(0, 14).toString() !== 'TESSMORA-CHAT\n' || header.readUInt32BE(14) > 32 * 1024 ** 2 || header.readUInt32BE(14) + 18 > record.size) throw new Error('归档格式无效。');
      await record.file.sync(); await record.file.close(); await rename(record.temporary, record.destination);
      clearTimeout(record.timer); pending.delete(record.requestId);
      record.window.webContents.removeListener('destroyed', record.destroyed);
      record.resolve(record.destination);
    } catch { await fail(record, new Error('归档未能安全保存。')); }
  });
  return {
    async request(window, workspaceId, destination) {
      if ([...pending.values()].some(record => record.workspaceId === workspaceId)) throw new Error('此工作区正在导出，请稍后重试。');
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const requestId = randomUUID(), temporary = `${destination}.${requestId}.partial`;
      const file = await open(temporary, 'wx+', 0o600);
      return new Promise((resolve, reject) => {
        const record = { requestId, workspaceId, window, destination, temporary, file, resolve, reject, sequence: 0, size: 0, writing: false };
        record.destroyed = () => void fail(record, new Error('工作区窗口已关闭，归档尚未完成。'));
        record.timer = setTimeout(() => void fail(record, new Error('会话归档等待超时，请重新打开工作区后重试。')), 10 * 60 * 1000);
        pending.set(requestId, record);
        window.webContents.once('destroyed', record.destroyed);
        window.webContents.send('desktop:export-history', requestId);
      });
    },
  };
}
