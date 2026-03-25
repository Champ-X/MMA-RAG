/**
 * 对话附件二进制存 IndexedDB（避免把大文件塞进 localStorage）。
 * 与 Zustand 持久化的元数据（id/kind/name/size/thumbDataUrl）配合，刷新后仍可预览/播放。
 */

const DB_NAME = 'mmaa-chat-attachments'
const STORE = 'blobs'
const DB_VERSION = 1

function openAttachmentDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })
}

export async function putAttachmentBlob(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openAttachmentDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('put failed'))
      tx.onabort = () => reject(tx.error ?? new Error('put aborted'))
    })
  } catch (e) {
    console.warn('putAttachmentBlob failed', id, e)
  }
}

export async function getAttachmentBlob(id: string): Promise<Blob | undefined> {
  try {
    const db = await openAttachmentDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const r = tx.objectStore(STORE).get(id)
      r.onsuccess = () => resolve(r.result as Blob | undefined)
      r.onerror = () => reject(r.error)
    })
  } catch {
    return undefined
  }
}

export async function deleteAttachmentBlob(id: string): Promise<void> {
  try {
    const db = await openAttachmentDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('delete failed'))
    })
  } catch {
    // ignore
  }
}

export async function deleteAttachmentBlobs(ids: string[]): Promise<void> {
  if (!ids.length) return
  try {
    const db = await openAttachmentDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const id of ids) store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('batch delete failed'))
    })
  } catch {
    // ignore
  }
}

/** 收集用户消息里附件 id，用于删除会话或覆盖历史时清理 IndexedDB */
export function collectUserAttachmentIds(
  messages: Array<{ role: string; attachments?: Array<{ id: string }> }> | undefined
): string[] {
  if (!messages?.length) return []
  const out: string[] = []
  for (const m of messages) {
    if (m.role !== 'user' || !m.attachments?.length) continue
    for (const a of m.attachments) {
      if (a.id) out.push(a.id)
    }
  }
  return out
}
