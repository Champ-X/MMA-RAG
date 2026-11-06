import { translate as tr, getLanguage } from '@/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore, type ChatScopeFile } from '@/store/useChatStore'
import type { ChatMention } from '@/lib/chatReferences'
import { persistMentions } from '@/lib/chatReferences'
import { createPendingChatAttachments } from '@/lib/pendingChatAttachments'
import { applyPiEvent, initialPiTrace } from '@/lib/piTrace'
import { piApi, watchPiRun } from '@/services/piAgent'
import { piTerminal, type PiConfig } from '@/types/pi'
import { restorePiMessages } from '@/lib/piHistory'
import { activePiRun, waitingPiRun } from '@/lib/piSession'
import { submitPiInput } from '@/lib/piInputs'
import { registerSessionWork } from '@/lib/sessionWork'

export function usePiAgent(workspaceConfig?: PiConfig | null) {
  const sessions = useChatStore(state => state.sessions)
  const activeSessionId = useChatStore(state => state.activeSessionId)
  const watchers = useRef(new Map<string, AbortController>())
  const submitting = useRef(new Set<string>())
  const [failure, setFailure] = useState<{ sessionId: string; message: string } | null>(null)
  const [watchRevision, setWatchRevision] = useState(0)
  const active = activePiRun(sessions, activeSessionId)
  const waiting = waitingPiRun(sessions, activeSessionId)

  useEffect(() => {
    if (!activeSessionId) return
    let cancelled = false
    // Load from the durable run ledger even if this browser lost its cached
    // messages. This never replaces or delays a legacy history/stream request.
    const refresh = () => { void piApi.list(activeSessionId).then(({ runs }) => {
        if (cancelled || !runs.length) return
        useChatStore.setState(state => ({ sessions: state.sessions.map(session => session.id === activeSessionId
          ? { ...session, messages: restorePiMessages(session.messages, runs) } : session) }))
      }).catch(() => {}) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; window.removeEventListener('focus', refresh) }
  }, [activeSessionId, workspaceConfig])

  useEffect(() => {
    for (const session of sessions) for (const message of session.messages) {
      const trace = message.pi
      const pendingReplay = trace?.status === 'needs_input' && (trace.replayThrough || 0) > trace.seq
      if (!trace || piTerminal(trace.status) && !pendingReplay || trace.connectionError || watchers.current.has(trace.runId)) continue
      const controller = new AbortController()
      watchers.current.set(trace.runId, controller)
      const current = () => useChatStore.getState().getSessionById(session.id)?.messages.find(m => m.id === message.id)
      void watchPiRun(trace.runId, () => current()?.pi?.seq || 0, event => {
        const old = current()?.pi
        if (!old) { controller.abort(); return }
        const pi = applyPiEvent(old, event)
        useChatStore.getState().updateMessage(session.id, message.id, { pi,
          content: pi.answer || '', citations: pi.citations || [],
          error: pi.status === 'failed' ? pi.message || tr("Agent 运行中断") : undefined })
      }, controller.signal).catch(cause => {
        const pi = current()?.pi
        if (pi && !controller.signal.aborted) useChatStore.getState().updateMessage(session.id, message.id, {
          pi: { ...pi, connectionError: cause instanceof Error ? cause.message : tr("过程连接中断") } })
      }).finally(() => {
        watchers.current.delete(trace.runId)
        if (!controller.signal.aborted) setWatchRevision(value => value + 1)
      })
    }
  }, [sessions, watchRevision])

  useEffect(() => {
    const streams = watchers.current
    return () => { for (const controller of streams.values()) controller.abort(); streams.clear() }
  }, [])

  const sendMessage = useCallback(async (content: string, knowledgeBaseIds?: string[], sessionId?: string,
    files?: File[], selectedFiles?: ChatScopeFile[], mentions?: ChatMention[], attachmentIds?: string[]) => {
    const language = getLanguage() // Freeze this submission before asynchronous file preparation.
    const store = useChatStore.getState()
    const session = sessionId ? store.getSessionById(sessionId) : store.getActiveSession()
    if (!session) throw new Error(tr("没有活跃的会话"))
    if (submitting.current.has(session.id) || activePiRun(store.sessions, session.id)) {
      throw new Error(tr("此会话已有正在提交或运行的任务，请先停止或等待完成。"))
    }
    submitting.current.add(session.id)
    let deleted = false
    const pendingAttachments = createPendingChatAttachments(() => useChatStore.getState().sessions.flatMap(item => item.messages))
    const unregister = registerSessionWork(session.id, () => { deleted = true; void pendingAttachments.discard() })
    try {
      setFailure(null)
      const attachments = await pendingAttachments.prepare(files, attachmentIds)
      if (deleted || !useChatStore.getState().getSessionById(session.id)) return
      const previous = [...session.messages].reverse().find(m => m.pi)?.pi
      const run = await piApi.create({ requestId: crypto.randomUUID(), sessionId: session.id, message: content, language,
        knowledgeBaseIds, model: session.piModel, selectedFiles, mentions, files, attachmentIds: attachments?.map(item => item.id),
        history: session.messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })),
        parentRunId: previous?.runId })
      if (deleted || !useChatStore.getState().getSessionById(session.id)) {
        // The server's session closure handles the create/delete race. Cancel
        // here too if a late create response arrives before closure completes.
        await piApi.cancel(run.id)
        return
      }
      if (useChatStore.getState().getSessionById(session.id)?.messages.some(message => message.pi?.runId === run.id)) return
      store.addMessage(session.id, { role: 'user', content: content || tr("（已上传 {{v0}} 个附件）", { v0: files?.length || 0 }),
        executionEngine: 'pi', mentions: persistMentions(mentions || []), attachments, scopeFiles: selectedFiles, scopeVersion: 2 })
      pendingAttachments.publish()
      store.addMessage(session.id, { role: 'assistant', content: '', citations: [], executionEngine: 'pi', pi: initialPiTrace(run) })
    } finally {
      unregister()
      await pendingAttachments.discard()
      submitting.current.delete(session.id)
    }
  }, [])

  const cancel = useCallback(async () => {
    if (!active) return
    try {
      await piApi.cancel(active.pi.runId)
      const store = useChatStore.getState(), message = store.getSessionById(active.sessionId)?.messages.find(m => m.id === active.messageId)
      if (message?.pi && !piTerminal(message.pi.status)) store.updateMessage(active.sessionId, active.messageId, {
        pi: { ...message.pi, status: 'cancelling', connectionError: undefined } })
    } catch (cause) { setFailure({ sessionId: active.sessionId,
      message: cause instanceof Error ? cause.message : tr("取消请求失败，请重试") }) }
  }, [active])

  const sendInput = useCallback(async (message: string) => {
    if (workspaceConfig?.runtime === 'core') throw new Error(tr('此任务已暂停；恢复持续运行模式后可继续补充。'))
    const state = useChatStore.getState()
    const running = activePiRun(state.sessions, state.activeSessionId)
    const paused = waitingPiRun(state.sessions, state.activeSessionId)
    const target = running?.pi.runtime === 'durable' ? running : paused
    if (!target) throw new Error(tr('此任务不支持持续补充，请新建任务。'))
    setFailure(null)
    await submitPiInput(target.pi.runId, message, paused && !running ? 'reply' : 'steer')
  }, [workspaceConfig?.runtime])

  return { sendMessage, sendInput, cancel, isStreaming: Boolean(active), active, waiting,
    error: failure?.sessionId === activeSessionId ? failure.message : null }
}
