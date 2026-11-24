import { useRef, useState } from 'react'
import { Archive, Download, Upload, AlertCircle, Check } from 'lucide-react'
import { getLanguage, useTranslation } from '@/i18n'
import { useChatStore, flushChatPersistence } from '@/store/useChatStore'
import { desktopWorkspace } from '@/lib/desktopWorkspace'
import { createChatArchive, readChatArchive, importChatArchive, type ReadChatArchive, type ArchiveProgress, type ChatArchiveState } from '@/lib/chatArchive'
import { getAttachmentBlobStrict, writeAttachmentBlobsStrict, deleteAttachmentBlobsStrict } from '@/lib/chatAttachmentBlobStore'
import './chatHistoryTransfer.css'

export function currentArchiveSource() {
  const desktop = desktopWorkspace()
  return { origin: desktop?.apiOrigin || window.location.origin, ...(desktop?.serverId ? { workspaceId: desktop.serverId } : {}) }
}
export function currentChatSnapshot(): ChatArchiveState {
  flushChatPersistence()
  const { sessions, activeSessionId } = useChatStore.getState()
  return { sessions, activeSessionId }
}
export default function ChatHistoryTransfer() {
  useTranslation()
  const en = getLanguage() === 'en-US'
  const t = (zh: string, english: string) => en ? english : zh
  const chooser = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [archive, setArchive] = useState<ReadChatArchive | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const streaming = useChatStore(state => state.streamingSessionId !== null)
  const progress: ArchiveProgress = value => setStatus(`${t(value.phase === 'reading' ? '正在读取附件' : value.phase === 'verifying' ? '正在校验附件' : '正在保存附件', value.phase === 'reading' ? 'Reading attachments' : value.phase === 'verifying' ? 'Verifying attachments' : 'Saving attachments')} ${value.completed}/${value.total}`)
  async function exportHistory() {
    if (streaming || busy) return
    setBusy(true); setError(''); setStatus('')
    try {
      const result = await createChatArchive(currentChatSnapshot(), { source: currentArchiveSource(), readBlob: getAttachmentBlobStrict, onProgress: progress })
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a'); link.href = url; link.download = `tessmora-history-${new Date().toISOString().slice(0, 10)}.tessmora-chat`
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
      setStatus(result.manifest.missingAttachmentIds.length
        ? t(`归档已生成；${result.manifest.missingAttachmentIds.length} 个附件在当前浏览器中缺失，缺项已记入清单。`, `Archive created; ${result.manifest.missingAttachmentIds.length} missing attachments are listed in its manifest.`)
        : t('会话归档已生成，请保存下载的文件。', 'Archive created. Save the downloaded file.'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('导出失败，请重试。', 'Export failed. Please try again.')); setStatus('') }
    finally { setBusy(false) }
  }
  async function choose(file?: File) {
    if (!file) return
    setBusy(true); setError(''); setArchive(null); setConfirmed(false)
    try { setArchive(await readChatArchive(file, progress)); setStatus('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('文件无法读取。', 'The file could not be read.')); setStatus('') }
    finally { setBusy(false); if (chooser.current) chooser.current.value = '' }
  }
  async function restore() {
    if (!archive || !confirmed || busy || streaming) return
    setBusy(true); setError('')
    try {
      const result = await importChatArchive(archive, currentChatSnapshot(), {
        readBlob: getAttachmentBlobStrict, writeBlobs: writeAttachmentBlobsStrict, deleteBlobs: deleteAttachmentBlobsStrict, onProgress: progress, getCurrentState: currentChatSnapshot,
        saveState: state => {
          // Fail before publishing state when browser quota is exhausted.
          localStorage.setItem('chat-store', JSON.stringify({ state, version: 0 }))
          useChatStore.setState(state)
          flushChatPersistence()
        },
      })
      setArchive(null); setConfirmed(false)
      setStatus(t(`已导入 ${result.imported} 个会话和 ${result.attachments} 个附件；跳过 ${result.skipped} 个相同会话。${result.missing ? `归档中有 ${result.missing} 个缺失附件。` : ''}`, `Imported ${result.imported} conversations and ${result.attachments} attachments; skipped ${result.skipped} identical conversations.${result.missing ? ` ${result.missing} attachments are missing from the archive.` : ''}`))
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('导入失败，已有会话已保留。', 'Import failed. Existing conversations are preserved.')); setStatus('') }
    finally { setBusy(false) }
  }
  return <section className="settings-panel chat-history-transfer" aria-labelledby="history-transfer-title">
    <header className="settings-panel-header"><span className="settings-section-icon" aria-hidden><Archive size={21} /></span><div><h2 id="history-transfer-title">{t('会话与附件', 'Conversations and attachments')}</h2></div></header>
    <div className="chat-history-body">
      <p>{t('将此工作区的会话、引用位置与浏览器中的附件保存为一个文件，也可以从旧浏览器迁入。', 'Save this workspace’s conversations, citation locations and browser attachments in one file, or bring them from an older browser.')}</p>
      <p className="chat-history-note">{t('归档包含客户端历史，不包含知识库原件、向量索引、Pi 后台任务账本或模型密钥。引用需要连接原服务，或先恢复配套的工作区备份。', 'The archive contains client history. It excludes knowledge base originals, vector indexes, Pi server task records and model credentials. Citations require the original server or its restored workspace backup.')}</p>
      <div className="chat-history-actions"><button type="button" onClick={() => void exportHistory()} disabled={busy || streaming}><Download size={16} />{t('导出会话与附件', 'Export conversations and attachments')}</button><button type="button" onClick={() => chooser.current?.click()} disabled={busy || streaming}><Upload size={16} />{t('选择归档文件', 'Choose an archive')}</button></div>
      <input ref={chooser} type="file" accept=".tessmora-chat" aria-label={t('选择会话归档', 'Choose conversation archive')} className="sr-only" onChange={event => void choose(event.target.files?.[0])} />
      {streaming && <p className="chat-history-note">{t('请等待当前回答结束后再迁移会话。', 'Wait for the current answer to finish before transferring conversations.')}</p>}
      {archive && <div className="chat-history-preview"><h3>{t('确认导入', 'Confirm import')}</h3><dl><dt>{t('来源', 'Source')}</dt><dd>{archive.manifest.source.origin}</dd><dt>{t('会话', 'Conversations')}</dt><dd>{archive.manifest.state.sessions.length}</dd><dt>{t('附件', 'Attachments')}</dt><dd>{archive.attachments.size}</dd><dt>{t('缺失附件', 'Missing attachments')}</dt><dd>{archive.manifest.missingAttachmentIds.length}</dd></dl><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('我已确认这是目标工作区对应的历史。保留现有会话，遇到不同内容的同 ID 记录时停止导入。', 'I have confirmed this history belongs to the target workspace. Keep existing conversations and stop on conflicting IDs.')}</label><div className="chat-history-actions"><button type="button" disabled={!confirmed || busy || streaming} onClick={() => void restore()}>{t('导入到当前工作区', 'Import into this workspace')}</button><button type="button" disabled={busy} onClick={() => setArchive(null)}>{t('取消', 'Cancel')}</button></div></div>}
      {status && <p className="chat-history-status" role="status"><Check size={15} />{status}</p>}
      {error && <p className="chat-history-error" role="alert"><AlertCircle size={16} />{error}</p>}
    </div>
  </section>
}
