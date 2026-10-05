import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore, type ChatMessageAttachment, type ChatScopeFile } from '@/store/useChatStore'
import type { ChatMention } from '@/lib/chatReferences'
import { persistMentions } from '@/lib/chatReferences'
import { putAttachmentBlob } from '@/lib/chatAttachmentBlobStore'
import { chatFileKind } from '@/lib/chatAttachmentFile'
import { applyPiEvent, initialPiTrace } from '@/lib/piTrace'
import { piApi, watchPiRun } from '@/services/piAgent'
import { piTerminal } from '@/types/pi'
import { restorePiMessages } from '@/lib/piHistory'

export function usePiAgent() {
  const sessions = useChatStore(state => state.sessions)
  const activeSessionId = useChatStore(state => state.activeSessionId)
  const watchers = useRef(new Map<string, AbortController>())
  const [error, setError] = useState<string | null>(null)
  const active = sessions.flatMap(session => session.messages.filter(message => message.pi && !piTerminal(message.pi.status))
    .map(message => ({ sessionId: session.id, messageId: message.id, pi: message.pi! })))[0]

  useEffect(() => {
    if (!activeSessionId) return
    let cancelled = false
    // Load from the durable run ledger even if this browser lost its cached
    // messages. This never replaces or delays a legacy history/stream request.
    void piApi.list(activeSessionId).then(({ runs }) => {
      if (cancelled || !runs.length) return
      useChatStore.setState(state => ({ sessions: state.sessions.map(session => session.id === activeSessionId
        ? { ...session, messages: restorePiMessages(session.messages, runs) } : session) }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeSessionId])

  useEffect(() => {
    for (const session of sessions) for (const message of session.messages) {
      const trace = message.pi
      if (!trace || piTerminal(trace.status) || trace.connectionError || watchers.current.has(trace.runId)) continue
      const controller = new AbortController()
      watchers.current.set(trace.runId, controller)
      const current = () => useChatStore.getState().getSessionById(session.id)?.messages.find(m => m.id === message.id)
      void watchPiRun(trace.runId, () => current()?.pi?.seq || 0, event => {
        const old = current()?.pi
        if (!old) { controller.abort(); return }
        const pi = applyPiEvent(old, event)
        useChatStore.getState().updateMessage(session.id, message.id, { pi,
          content: pi.answer || '', citations: pi.citations || [],
          error: pi.status === 'failed' ? pi.message || 'Agent 运行中断' : undefined })
      }, controller.signal).catch(cause => {
        const pi = current()?.pi
        if (pi && !controller.signal.aborted) useChatStore.getState().updateMessage(session.id, message.id, {
          pi: { ...pi, connectionError: cause instanceof Error ? cause.message : '过程连接中断' } })
      }).finally(() => { watchers.current.delete(trace.runId) })
    }
  }, [sessions])

  useEffect(() => {
    const streams = watchers.current
    return () => { for (const controller of streams.values()) controller.abort(); streams.clear() }
  }, [])

  const sendMessage = useCallback(async (content: string, knowledgeBaseIds?: string[], sessionId?: string,
    files?: File[], selectedFiles?: ChatScopeFile[], mentions?: ChatMention[], attachmentIds?: string[]) => {
    const store = useChatStore.getState()
    const session = sessionId ? store.getSessionById(sessionId) : store.getActiveSession()
    if (!session) throw new Error('没有活跃的会话')
    setError(null)
    const ids = files?.map((_, i) => attachmentIds?.[i] || `att_${crypto.randomUUID()}`)
    let attachments: ChatMessageAttachment[] | undefined
    if (files?.length) attachments = await Promise.all(files.map(async (file, i) => {
      const id = ids![i], kind = chatFileKind(file) || 'image'
      await putAttachmentBlob(id, file)
      const thumbDataUrl = kind === 'image' ? await (await import('@/lib/chatAttachmentThumb')).imageFileToPersistedThumb(file) : undefined
      return { id, kind, name: file.name, size: file.size, ...(thumbDataUrl ? { thumbDataUrl } : {}) }
    }))
    const previous = [...session.messages].reverse().find(m => m.pi)?.pi
    const run = await piApi.create({ requestId: crypto.randomUUID(), sessionId: session.id, message: content,
      knowledgeBaseIds, model: session.piModel, selectedFiles, mentions, files, attachmentIds: ids,
      history: session.messages.filter(m => !m.error).slice(-12).map(m => ({ role: m.role, content: m.content })),
      parentRunId: previous?.runId })
    if (useChatStore.getState().getSessionById(session.id)?.messages.some(message => message.pi?.runId === run.id)) return
    store.addMessage(session.id, { role: 'user', content: content || `（已上传 ${files?.length || 0} 个附件）`,
      executionEngine: 'pi', mentions: persistMentions(mentions || []), attachments, scopeFiles: selectedFiles, scopeVersion: 2 })
    store.addMessage(session.id, { role: 'assistant', content: '', citations: [], executionEngine: 'pi', pi: initialPiTrace(run) })
  }, [])

  const cancel = useCallback(async () => {
    if (!active) return
    try {
      await piApi.cancel(active.pi.runId)
      const store = useChatStore.getState(), message = store.getSessionById(active.sessionId)?.messages.find(m => m.id === active.messageId)
      if (message?.pi && !piTerminal(message.pi.status)) store.updateMessage(active.sessionId, active.messageId, {
        pi: { ...message.pi, status: 'cancelling', connectionError: undefined } })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '取消请求失败，请重试') }
  }, [active])

  return { sendMessage, cancel, isStreaming: Boolean(active), active, error }
}
