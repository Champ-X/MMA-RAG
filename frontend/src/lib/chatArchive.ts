import { translate as tr } from '@/i18n'
import type { ChatSession } from '@/store/useChatStore'

const MAGIC = new TextEncoder().encode('TESSMORA-CHAT\n')
const CHUNK_SIZE = 4 * 1024 * 1024
const MAX_MANIFEST = 32 * 1024 * 1024
const MAX_ARCHIVE = 8 * 1024 * 1024 * 1024
export interface ChatArchiveState { sessions: ChatSession[]; activeSessionId: string | null }
export interface ArchiveSource { origin: string; workspaceId?: string }
interface ArchivedAttachment { id: string; size: number; type: string; chunkSize: number; sha256: string[] }
export interface ChatArchiveManifest {
  kind: 'tessmora-chat'; version: 1; createdAt: string; source: ArchiveSource; state: ChatArchiveState
  attachments: ArchivedAttachment[]; missingAttachmentIds: string[]; includesServerData: false
}
export interface ReadChatArchive { manifest: ChatArchiveManifest; attachments: Map<string, Blob> }
export type ArchiveProgress = (progress: { phase: 'reading' | 'verifying' | 'saving'; completed: number; total: number }) => void
const fail = (message: string): never => { throw new Error(tr(message)) }
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 1024 && !/[\x00-\x1f]/.test(value)
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

function cleanSnapshot(value: unknown, key = '', depth = 0): unknown {
  if (depth > 60) fail('会话内容嵌套过深，无法导出。')
  if (['previewUrl', 'auth_token', 'setup_token', 'api_key', 'apiKey', 'credentials', '__proto__', 'constructor', 'prototype'].includes(key)) return undefined
  if (typeof value === 'string' && /(?:^|_)(?:img|audio|video|image|download|preview|cover)?_?url$/i.test(key)) {
    if (value.startsWith('blob:')) return undefined
    try {
      const url = new URL(value, 'https://archive.invalid')
      if ([...url.searchParams.keys()].some(name => /^(?:x-amz-|signature$|token$|setup_token$)/i.test(name))) return ''
    } catch { /* Text is preserved when it is not a URL. */ }
  }
  if (Array.isArray(value)) return value.map(item => cleanSnapshot(item, '', depth + 1))
  if (plain(value)) return Object.fromEntries(Object.entries(value).flatMap(([name, item]) => { const safe = cleanSnapshot(item, name, depth + 1); return safe === undefined ? [] : [[name, safe]] }))
  return value
}
function validateState(value: unknown): ChatArchiveState {
  if (!plain(value) || !Array.isArray(value.sessions) || value.sessions.length > 100000 || !(value.activeSessionId === null || validId(value.activeSessionId))) fail('会话归档格式无效。')
  const state = value as unknown as ChatArchiveState
  const sessions = new Set<string>()
  for (const session of state.sessions) {
    if (!plain(session) || !validId(session.id) || sessions.has(session.id) || typeof session.title !== 'string' || !Array.isArray(session.messages) || !Array.isArray(session.knowledgeBaseIds) || !session.knowledgeBaseIds.every(validId) || !Number.isFinite(session.createdAt) || !Number.isFinite(session.updatedAt)) fail('会话归档包含无效或重复的会话。')
    sessions.add(session.id)
    const messages = new Set<string>()
    for (const message of session.messages) {
      if (!plain(message) || !validId(message.id) || messages.has(message.id) || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !Number.isFinite(message.timestamp)) fail('会话归档包含无效消息。')
      messages.add(message.id)
      if (message.attachments !== undefined && (!Array.isArray(message.attachments) || message.attachments.some(attachment => !plain(attachment) || !validId(attachment.id) || typeof attachment.name !== 'string' || !['image', 'audio', 'video'].includes(attachment.kind) || !Number.isSafeInteger(attachment.size) || attachment.size < 0))) fail('会话归档包含无效附件。')
      if (message.citations !== undefined && (!Array.isArray(message.citations) || message.citations.some(item => !plain(item)))) fail('会话归档包含无效引用。')
    }
  }
  if (state.activeSessionId && !sessions.has(state.activeSessionId)) fail('归档的当前会话不存在。')
  return state
}
function attachmentIds(state: ChatArchiveState): string[] {
  return [...new Set(state.sessions.flatMap(session => session.messages.flatMap(message => message.attachments?.map(attachment => attachment.id) || [])))]
}
async function hashChunks(blob: Blob): Promise<string[]> {
  const hashes: string[] = []
  for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
    const data = await blob.slice(offset, offset + CHUNK_SIZE).arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', data)
    hashes.push([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''))
  }
  return hashes
}
export async function createChatArchive(state: ChatArchiveState, options: { source: ArchiveSource; readBlob: (id: string) => Promise<Blob | undefined>; onProgress?: ArchiveProgress }): Promise<{ blob: Blob; manifest: ChatArchiveManifest }> {
  const snapshot = validateState(cleanSnapshot(state))
  const attachments: ArchivedAttachment[] = [], blobs: Blob[] = [], missingAttachmentIds: string[] = []
  const ids = attachmentIds(snapshot)
  let size = 0
  for (const [index, id] of ids.entries()) {
    options.onProgress?.({ phase: 'reading', completed: index, total: ids.length })
    const blob = await options.readBlob(id)
    if (!blob) { missingAttachmentIds.push(id); continue }
    size += blob.size
    if (size > MAX_ARCHIVE) fail('附件总大小超过 8 GiB，请分批迁移会话。')
    attachments.push({ id, size: blob.size, type: blob.type, chunkSize: CHUNK_SIZE, sha256: await hashChunks(blob) })
    blobs.push(blob)
  }
  const source = { origin: String(options.source.origin).slice(0, 2048), ...(options.source.workspaceId ? { workspaceId: options.source.workspaceId } : {}) }
  const manifest: ChatArchiveManifest = { kind: 'tessmora-chat', version: 1, createdAt: new Date().toISOString(), source, state: snapshot, attachments, missingAttachmentIds, includesServerData: false }
  const encoded = new TextEncoder().encode(JSON.stringify(manifest))
  if (encoded.length > MAX_MANIFEST) fail('会话文本超过 32 MiB，请分批迁移。')
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, encoded.length)
  options.onProgress?.({ phase: 'reading', completed: ids.length, total: ids.length })
  return { blob: new Blob([MAGIC, length, encoded, ...blobs], { type: 'application/vnd.tessmora.chat' }), manifest }
}
export async function readChatArchive(blob: Blob, onProgress?: ArchiveProgress): Promise<ReadChatArchive> {
  if (blob.size > MAX_ARCHIVE + MAX_MANIFEST || blob.size < MAGIC.length + 4) fail('归档文件大小无效。')
  const header = new Uint8Array(await blob.slice(0, MAGIC.length + 4).arrayBuffer())
  if (MAGIC.some((byte, index) => header[index] !== byte)) fail('请选择 Tessmora 会话归档（.tessmora-chat）。')
  const length = new DataView(header.buffer).getUint32(MAGIC.length)
  if (length > MAX_MANIFEST || length + header.length > blob.size) fail('归档清单长度无效。')
  let manifest: ChatArchiveManifest
  try { manifest = JSON.parse(await blob.slice(header.length, header.length + length).text()) } catch { return fail('归档清单已损坏。') }
  if (manifest.kind !== 'tessmora-chat' || manifest.version !== 1 || manifest.includesServerData !== false || !plain(manifest.source) || typeof manifest.source.origin !== 'string' || !Array.isArray(manifest.attachments) || !Array.isArray(manifest.missingAttachmentIds) || !manifest.missingAttachmentIds.every(validId)) fail('归档版本或清单格式不兼容。')
  manifest.state = validateState(cleanSnapshot(manifest.state))
  const ids = new Set(attachmentIds(manifest.state)), seen = new Set<string>(), attachments = new Map<string, Blob>()
  let offset = header.length + length
  for (const [index, item] of manifest.attachments.entries()) {
    if (!plain(item) || !validId(item.id) || !ids.has(item.id) || seen.has(item.id) || !Number.isSafeInteger(item.size) || item.size < 0 || item.chunkSize !== CHUNK_SIZE || typeof item.type !== 'string' || item.type.length > 200 || !Array.isArray(item.sha256) || item.sha256.length !== Math.ceil(item.size / CHUNK_SIZE) || !item.sha256.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) || offset + item.size > blob.size) fail('归档附件清单无效或数据不完整。')
    onProgress?.({ phase: 'verifying', completed: index, total: manifest.attachments.length })
    seen.add(item.id)
    const attachment = blob.slice(offset, offset + item.size, item.type)
    if (JSON.stringify(await hashChunks(attachment)) !== JSON.stringify(item.sha256)) fail(tr("附件校验失败：{{id}}。未导入任何会话。", { id: item.id }))
    attachments.set(item.id, attachment); offset += item.size
  }
  if (offset !== blob.size || manifest.missingAttachmentIds.some(id => !ids.has(id) || seen.has(id)) || new Set(manifest.missingAttachmentIds).size !== manifest.missingAttachmentIds.length || ids.size !== seen.size + manifest.missingAttachmentIds.length) fail('归档包含未登记的数据或附件。')
  onProgress?.({ phase: 'verifying', completed: manifest.attachments.length, total: manifest.attachments.length })
  return { manifest, attachments }
}
function canonicalSession(session: ChatSession): string {
  // Active selection is a per-window preference and can differ without a history conflict.
  return JSON.stringify(cleanSnapshot({ ...session, isActive: false }))
}
export async function importChatArchive(archive: ReadChatArchive, existing: ChatArchiveState, options: {
  readBlob: (id: string) => Promise<Blob | undefined>
  writeBlobs: (items: Array<{ id: string; blob: Blob }>) => Promise<void>
  deleteBlobs: (ids: string[]) => Promise<void>
  saveState: (state: ChatArchiveState) => void | Promise<void>
  getCurrentState?: () => ChatArchiveState
  onProgress?: ArchiveProgress
}) {
  function merge(current: ChatArchiveState) {
    validateState(current)
    const sessions = new Map(current.sessions.map(session => [session.id, session]))
    let imported = 0, skipped = 0
    for (const session of archive.manifest.state.sessions) {
      const previous = sessions.get(session.id)
      if (previous && canonicalSession(previous) !== canonicalSession(session)) fail(tr("会话“{{title}}”与已有记录冲突。已有记录未被覆盖。", { title: session.title }))
      if (previous) skipped++
      else { sessions.set(session.id, session); imported++ }
    }
    const activeSessionId = current.activeSessionId || archive.manifest.state.activeSessionId
    return { imported, skipped, state: { sessions: [...sessions.values()].map(session => ({ ...session, isActive: session.id === activeSessionId })), activeSessionId } }
  }
  merge(existing)
  const fresh: Array<{ id: string; blob: Blob }> = []
  for (const [id, blob] of archive.attachments) {
    const current = await options.readBlob(id)
    if (current) {
      if (current.size !== blob.size || JSON.stringify(await hashChunks(current)) !== JSON.stringify(await hashChunks(blob))) fail(tr("附件 {{id}} 与已有文件内容不同，未导入。", { id }))
    } else fresh.push({ id, blob })
  }
  options.onProgress?.({ phase: 'saving', completed: 0, total: fresh.length })
  await options.writeBlobs(fresh)
  let result
  try {
    // Background conversations may advance while attachment verification is running.
    result = merge(options.getCurrentState?.() || existing)
    await options.saveState(result.state)
  } catch (error) { await options.deleteBlobs(fresh.map(item => item.id)); throw error }
  options.onProgress?.({ phase: 'saving', completed: fresh.length, total: fresh.length })
  return { imported: result.imported, skipped: result.skipped, attachments: fresh.length, missing: archive.manifest.missingAttachmentIds.length }
}
