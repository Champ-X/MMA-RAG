import { lazy, Suspense, useState, useRef, useId, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { Send, Zap, Paperclip, Database, Square, AtSign, X, Sparkles, Search, BrainCircuit, Pencil, ChevronDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useChatStore } from '@/store/useChatStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useThinkingChain } from '@/hooks/useThinkingChain'
import { useChatScrollFollow } from '@/hooks/useChatScrollFollow'
import { usePiAgent } from '@/hooks/usePiAgent'
import { piApi } from '@/services/piAgent'
import { piStatusLabel, type PiConfig } from '@/types/pi'
import { piModelDisplayName } from '@/lib/piTraceView'
import { cn } from '@/lib/utils'
import { getModelVendor, VENDOR_LOGOS } from '@/lib/modelVendors'
import type { CitationReference } from '@/types/sse'
import {
  normalizeAgentMode,
  type AgentMode,
  type ChatMessageAttachment,
  type ChatScopeFile,
  type Message,
} from '@/store/useChatStore'
import { fileScopeKey, formatScopedFileSize, useFileScopeOptions } from './useFileScopeOptions'
import { buildFileMentionGroups, type FileMentionState } from './fileMentionGroups'
import type { MentionComposerHandle } from './MentionComposer'
import { removeReferences, trimComposerValue, type ChatReference, type ComposerValue } from '@/lib/chatReferences'
import { chatFileKind } from '@/lib/chatAttachmentFile'
import { prepareQuestionEdit, type ChatComposerDraft, type ComposerAttachment } from '@/lib/chatQuestionEdit'
import { explicitScopeFiles } from '@/lib/chatReferenceScope'
import { FileScopeThumbnail, filePresentation } from './FileScopeThumbnail'
import './fileMentionList.css'
import './composerScopeFiles.css'
import './piAgent.css'
import { ChatWelcome } from './ChatWelcome'

const MAX_CHAT_ATTACHMENTS = 3
const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_CHAT_AUDIO_BYTES = 10 * 1024 * 1024
const MAX_CHAT_VIDEO_BYTES = 30 * 1024 * 1024
// Nested spans form a smooth brightness envelope along the rounded perimeter.
// Animate each color as a group so every layer travels at the same speed.
const PI_COMPOSER_TRAIL_LAYERS = Array.from({ length: 20 }, (_, index) => {
  const brightness = .86 * Math.sin((index + 1) / 20 * Math.PI / 2) ** 2
  const previousBrightness = .86 * Math.sin(index / 20 * Math.PI / 2) ** 2
  const span = 14 * (1 - index / 20)
  const start = (14 - span) / 2
  return {
    dashArray: `0 ${start} ${span} ${100 - start - span}`,
    opacity: (brightness - previousBrightness) / (1 - previousBrightness),
  }
})
interface QuestionEdit {
  messageId: string
  previous: ChatComposerDraft
}

function releaseAttachmentPreviews(files: ComposerAttachment[]) {
  files.forEach(file => { if (file.previewUrl) URL.revokeObjectURL(file.previewUrl) })
}

const MentionComposer = lazy(() => import('./MentionComposer').then(module => ({ default: module.MentionComposer })))
const NEXT_AGENT_MODE: Record<AgentMode, AgentMode> = {
  auto: 'direct',
  direct: 'agent',
  agent: 'auto',
}

const CitationPopover = lazy(() =>
  import('./CitationPopover').then((module) => ({ default: module.CitationPopover }))
)

const InspectorDrawer = lazy(() =>
  import('@/components/debug/InspectorDrawer').then((module) => ({ default: module.InspectorDrawer }))
)

const KnowledgeBaseConfigPanel = lazy(() =>
  import('./KnowledgeBaseConfigPanel').then((module) => ({ default: module.KnowledgeBaseConfigPanel }))
)

const FileScopePicker = lazy(() =>
  import('./FileScopePicker').then((module) => ({ default: module.FileScopePicker }))
)

const ModelConfigPanel = lazy(() =>
  import('./ModelConfigPanel').then((module) => ({ default: module.ModelConfigPanel }))
)

const MessageBubble = lazy(() =>
  import('./MessageBubble').then((module) => ({ default: module.MessageBubble }))
)

const SuggestedQuestions = lazy(() =>
  import('./SuggestedQuestions').then((module) => ({ default: module.SuggestedQuestions }))
)

const OpenRouterModelBrandIcon = lazy(() =>
  import('./OpenRouterModelBrandIcon').then((module) => ({ default: module.OpenRouterModelBrandIcon }))
)

const ComposerAttachmentTile = lazy(() =>
  import('./ComposerAttachmentTile').then((module) => ({ default: module.ComposerAttachmentTile }))
)

function ComposerAttachmentTileFallback() {
  return (
    <span
      className="inline-flex h-14 w-14 shrink-0 animate-pulse rounded-xl border border-slate-200/80 bg-slate-100 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      aria-hidden
    />
  )
}

function MessageBubbleLoading({ role }: { role: Message['role'] }) {
  const isUser = role === 'user'
  return (
    <div
      className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
      role="status"
      aria-live="polite"
      aria-label={isUser ? '正在载入用户消息' : '正在载入助手消息'}
    >
      <div
        className={cn(
          'animate-pulse shadow-sm',
          isUser
            ? 'h-14 w-56 rounded-[18px_18px_6px_18px] bg-indigo-200/70 dark:bg-indigo-500/30'
            : 'h-28 w-full rounded-[6px_18px_18px_18px] border border-slate-200/70 border-l-[4px] border-l-indigo-300 bg-[#fffefa] dark:border-slate-700/70 dark:border-l-indigo-500 dark:bg-slate-900'
        )}
        aria-hidden
      />
    </div>
  )
}

function OpenRouterModelBrandIconFallback({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'h-3.5 w-3.5 shrink-0 rounded-md bg-white/90 ring-1 ring-slate-200/70 dark:bg-slate-800/90 dark:ring-slate-600/80',
        className
      )}
      aria-hidden
    />
  )
}

function SuggestedQuestionsLoading() {
  return (
    <div
      className="mx-auto w-full max-w-3xl"
      role="status"
      aria-live="polite"
      aria-label="正在载入推荐问题"
    >
      <div className="chat-suggestions-loading" aria-hidden>
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-40 animate-pulse rounded-[8px] border border-slate-200/80 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-900/60"
          />
        ))}
      </div>
    </div>
  )
}

function maxBytesForChatFile(f: File): number {
  return chatFileKind(f) === 'video' ? MAX_CHAT_VIDEO_BYTES : chatFileKind(f) === 'image' ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_AUDIO_BYTES
}

export function ChatInterface() {
  const [draft, setDraft] = useState<ComposerValue>({ text: '', mentions: [] })
  const input = draft.text
  const setInput = (text: string) => setDraft({ text, mentions: [] })
  const [attachmentError, setAttachmentError] = useState('')
  const [isPreparing, setIsPreparing] = useState(false)
  const preparingRef = useRef(false)
  const [editorRevision, setEditorRevision] = useState(0)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const [questionEdit, setQuestionEdit] = useState<QuestionEdit | null>(null)
  const questionEditRef = useRef(questionEdit)
  questionEditRef.current = questionEdit
  const composerEpoch = useRef(0)
  const submittedDraftRef = useRef<(ChatComposerDraft & { editing: QuestionEdit | null }) | null>(null)
  const [citePopover, setCitePopover] = useState<{
    open: boolean
    rect: DOMRect | null
    item: CitationReference | null
  }>({ open: false, rect: null, item: null })
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectingItem, setInspectingItem] = useState<CitationReference | null>(null)
  const [kbConfigPanelOpen, setKbConfigPanelOpen] = useState(false)
  const [fileScopePickerOpen, setFileScopePickerOpen] = useState(false)
  const [modelConfigPanelOpen, setModelConfigPanelOpen] = useState(false)
  const [selectedScopeFiles, setSelectedScopeFiles] = useState<ChatScopeFile[]>([])
  const [mentionState, setMentionState] = useState<FileMentionState | null>(null)
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState(0)
  const messageContentRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const chatWorkspaceRef = useRef<HTMLDivElement>(null)
  const composerDockRef = useRef<HTMLDivElement>(null)
  const piComposerGradientId = useId()
  const inputRef = useRef<MentionComposerHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const citePopoverRef = useRef<HTMLDivElement>(null)
  const citationTriggerRef = useRef<HTMLElement | null>(null)
  const mentionStateRef = useRef<FileMentionState | null>(null)
  mentionStateRef.current = mentionState
  const mentionListRef = useRef<HTMLDivElement>(null)
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const requestScopeFiles = selectedScopeFiles

  const {
    sessions,
    activeSessionId,
    streamingSessionId,
    getActiveSession,
    createSession,
    createSessionFromApi,
    setLoading,
    thinking,
    addMessage,
    updateMessage,
    updateSessionAgentMode,
    updateSessionPiMode,
    updateSessionPiModel,
  } = useChatStore()

  const legacyChain = useThinkingChain()
  const pi = usePiAgent()
  const isStreaming = legacyChain.isStreaming || pi.isStreaming
  const error = pi.error || legacyChain.error
  const [piConfig, setPiConfig] = useState<PiConfig | null>(null)
  const [piConfigError, setPiConfigError] = useState('')
  const { config } = useConfigStore()
  const {
    knowledgeBases: scopeKnowledgeBases,
    filesByKb: scopeFilesByKb,
    loadingKbIds: scopeLoadingKbIds,
    failedKbIds: scopeFailedKbIds,
    ensureAllKbFiles,
    loadKbFiles: loadScopeKbFiles,
    hasLoadedFilesForKb,
  } = useFileScopeOptions(Boolean(mentionState) || requestScopeFiles.length > 0)

  const activeSession = getActiveSession()
  const piEnabled = activeSession?.executionEngine === 'pi'
  const sendMessage = piEnabled ? pi.sendMessage : legacyChain.sendMessage
  const piState = pi.active?.sessionId === activeSessionId ? pi.active.pi.status : 'ready'
  const piModelId = activeSession?.piModel || piConfig?.default_model || ''
  const piModelLogo = piModelId ? VENDOR_LOGOS[getModelVendor(piModelId)] : undefined
  useLayoutEffect(() => {
    const workspace = chatWorkspaceRef.current
    const dock = composerDockRef.current
    if (!workspace || !dock) return
    const reserveComposerSpace = () => workspace.style.setProperty('--chat-dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`)
    reserveComposerSpace()
    const observer = new ResizeObserver(reserveComposerSpace)
    observer.observe(dock)
    return () => { observer.disconnect(); workspace.style.removeProperty('--chat-dock-height') }
  }, [])
  useEffect(() => {
    if (!piEnabled || piConfig) return
    let cancelled = false
    void piApi.config().then(value => { if (!cancelled) { setPiConfig(value); setPiConfigError('') } })
      .catch(cause => { if (!cancelled) setPiConfigError(cause instanceof Error ? cause.message : 'Pi 配置暂不可用') })
    return () => { cancelled = true }
  }, [piEnabled, piConfig])
  const agentMode = normalizeAgentMode(activeSession?.agentMode)
  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession?.messages])
  const followLatestMessage = useChatScrollFollow(scrollAreaRef, messageContentRef, activeSessionId)
  const precedingQuestions = useMemo(() => {
    let question: Message | undefined
    return messages.map((message) => {
      const preceding = question
      if (message.role === 'user') question = message
      return preceding
    })
  }, [messages])
  const isLoading = isStreaming || isPreparing

  const cycleAgentMode = () => {
    if (!activeSessionId || isLoading) return
    updateSessionAgentMode(activeSessionId, NEXT_AGENT_MODE[agentMode])
  }

  const agentModeLabel =
    agentMode === 'auto' ? 'Agent 自动' : agentMode === 'agent' ? 'Agent 深研' : '直接检索'
  const agentModeShortLabel =
    agentMode === 'auto' ? '自动' : agentMode === 'agent' ? '深研' : '直搜'
  const agentModeHint =
    agentMode === 'auto'
      ? '自动判断是否需要多轮深研；点击切换为直接检索'
      : agentMode === 'direct'
        ? '固定使用单轮多模态检索；点击切换为 Agent 深研'
        : '固定使用 Agent 多轮补查；点击切换为自动判断'

  // 获取当前选中的模型名称，简化显示
  const chatFullModelId = useMemo(
    () => config.models.find(m => m.id === 'chat')?.model || '',
    [config.models]
  )

  const currentModel = useMemo(() => {
    const chatModel = chatFullModelId
    // 如果模型名称包含斜杠，只显示最后一部分；否则显示完整名称
    if (chatModel.includes('/')) {
      return chatModel.split('/').pop() || chatModel
    }
    return chatModel || '模型'
  }, [chatFullModelId])

  /** 非 OpenRouter：本地 vendor 图；OpenRouter 在按钮内单独用 Lobe 图标 */
  const currentModelLogo = useMemo(() => {
    if (!chatFullModelId || chatFullModelId.startsWith('openrouter:')) return null
    const vendor = getModelVendor(chatFullModelId)
    return VENDOR_LOGOS[vendor] || null
  }, [chatFullModelId])

  const openRouterModelRaw = useMemo(() => {
    if (!chatFullModelId.startsWith('openrouter:')) return ''
    return chatFullModelId.slice('openrouter:'.length).trim()
  }, [chatFullModelId])


  useEffect(() => {
    if (!activeSessionId && sessions.length === 0) {
      createSessionFromApi().catch(() => createSession())
    }
  }, [activeSessionId, sessions.length, createSession, createSessionFromApi])

  useEffect(() => {
    return () => {
      composerEpoch.current += 1
      releaseAttachmentPreviews(attachmentsRef.current)
      if (questionEditRef.current) releaseAttachmentPreviews(questionEditRef.current.previous.files)
    }
  }, [])

  useEffect(() => {
    composerEpoch.current += 1
    if (questionEditRef.current) releaseAttachmentPreviews(questionEditRef.current.previous.files)
    setQuestionEdit(null)
    setSelectedScopeFiles([])
    setMentionState(null)
    setDraft({ text: '', mentions: [] })
    setEditorRevision(prev => prev + 1)
    releaseAttachmentPreviews(attachmentsRef.current)
    setAttachments([])
    setAttachmentError('')
    submittedDraftRef.current = null
  }, [activeSessionId])

  useEffect(() => {
    if (!mentionState) return
    void ensureAllKbFiles()
  }, [mentionState, ensureAllKbFiles])

  // The file picker has its own catalog. Hydrate previews for its selections too,
  // while keeping temporary media URLs out of persisted chat scope metadata.
  useEffect(() => {
    for (const kbId of new Set(requestScopeFiles.map(file => file.kbId))) {
      if (!hasLoadedFilesForKb(kbId) && !scopeFailedKbIds.includes(kbId)) {
        void loadScopeKbFiles(kbId).catch(() => { /* Type icons remain available on failure. */ })
      }
    }
  }, [requestScopeFiles, hasLoadedFilesForKb, loadScopeKbFiles, scopeFailedKbIds])

  const localMentionOptions = useMemo(() => {
    if (!mentionState) return []
    const query = mentionState.query.trim().toLowerCase().replace(/^(本机|附件)\//, '')
    return attachments.filter(a => !query || `${a.file.name} 本机 附件`.toLowerCase().includes(query))
      .map(a => ({ source: 'attachment' as const, attachmentId: a.id, name: a.file.name,
        type: a.file.type, previewUrl: a.previewUrl }))
  }, [mentionState, attachments])

  const mentionGroups = useMemo(() => {
    if (!mentionState) return []
    return buildFileMentionGroups(scopeKnowledgeBases, scopeFilesByKb, new Set(), mentionState.query)
      .map(group => ({
        ...group,
        isLoading: scopeLoadingKbIds.includes(group.kbId),
        hasLoaded: hasLoadedFilesForKb(group.kbId),
        failed: scopeFailedKbIds.includes(group.kbId),
      }))
      .filter(group => group.files.length > 0 || group.isLoading || !group.hasLoaded)
  }, [mentionState, scopeKnowledgeBases, scopeFilesByKb, scopeLoadingKbIds, scopeFailedKbIds, hasLoadedFilesForKb])

  const mentionOptions = useMemo<ChatReference[]>(
    () => [...localMentionOptions, ...mentionGroups.flatMap(group => group.files.map(file => ({
      source: 'knowledge' as const, kbId: group.kbId, kbName: group.kbName,
      fileId: file.id, name: file.name, type: file.type, previewUrl: file.previewUrl, coverUrl: file.coverUrl,
    })))],
    [mentionGroups, localMentionOptions]
  )
  const mentionListboxId = 'chat-file-mention-listbox'
  const mentionActiveOptionId =
    mentionState && mentionOptions.length > 0
      ? `${mentionListboxId}-option-${Math.min(mentionHighlightIndex, mentionOptions.length - 1)}`
      : undefined

  const mentionOptionIndexByKey = useMemo(() => {
    const map = new Map<string, number>()
    mentionOptions.forEach((option, index) => {
      if (option.kbId && option.fileId) map.set(fileScopeKey(option.kbId, option.fileId), index)
    })
    return map
  }, [mentionOptions])

  useEffect(() => {
    setMentionHighlightIndex(0)
  }, [mentionState?.query])

  useEffect(() => {
    if (!mentionOptions.length) return
    if (mentionHighlightIndex < mentionOptions.length) return
    setMentionHighlightIndex(Math.max(mentionOptions.length - 1, 0))
  }, [mentionHighlightIndex, mentionOptions.length])

  useEffect(() => {
    const list = mentionListRef.current
    const target = mentionOptionRefs.current[mentionHighlightIndex]
    if (!list || !target) return
    if (mentionHighlightIndex === 0) { list.scrollTop = 0; return }
    const viewport = list.getBoundingClientRect()
    const option = target.getBoundingClientRect()
    // Scroll only the candidates; never move the conversation or page behind them.
    const headingSpace = 32
    if (option.top < viewport.top + headingSpace) list.scrollTop += option.top - viewport.top - headingSpace
    else if (option.bottom > viewport.bottom) list.scrollTop += option.bottom - viewport.bottom
  }, [mentionHighlightIndex, mentionOptions])

  const insertMentionSelection = useCallback((reference: ChatReference) => {
    inputRef.current?.insertReference(reference, mentionStateRef.current)
    setMentionState(null)
  }, [])

  const submitMessage = useCallback(async (nextInput?: string) => {
    const submission = trimComposerValue(nextInput === undefined ? draft : { text: nextInput, mentions: [] })
    const text = submission.text
    if ((!text && attachments.length === 0) || isLoading || preparingRef.current || !activeSessionId) return
    followLatestMessage()
    preparingRef.current = true
    setIsPreparing(true)
    setAttachmentError('')
    const files = attachments.map((a) => a.file)
    const epoch = composerEpoch.current
    submittedDraftRef.current = { value: submission, files: attachments, scope: selectedScopeFiles, editing: questionEdit }
    setInput('')
    setEditorRevision(prev => prev + 1)
    setAttachments([])
    setMentionState(null)
    setLoading(true)

    try {
      const scopedKbIds = Array.from(new Set(requestScopeFiles.map(file => file.kbId))).filter(Boolean)
      const kbMode = activeSession?.kbMode ?? 'auto'
      const kbIds = activeSession?.knowledgeBaseIds ?? []
      const toSend = scopedKbIds.length > 0
        ? scopedKbIds
        : kbMode === 'auto'
          ? undefined
          : kbIds.length > 0
            ? kbIds
            : undefined
      await sendMessage(
        text,
        toSend,
        activeSessionId,
        files.length ? files : undefined,
        requestScopeFiles.length ? requestScopeFiles : undefined,
        submission.mentions,
        attachments.map(a => a.id)
      )
      releaseAttachmentPreviews(attachments)
      if (epoch !== composerEpoch.current) return
      setQuestionEdit(null)
      setSelectedScopeFiles(questionEdit?.previous.scope ?? [])
      if (questionEdit) {
        setDraft(questionEdit.previous.value)
        setAttachments(questionEdit.previous.files)
        setEditorRevision(prev => prev + 1)
      }
    } catch (e) {
      console.error('发送失败', e)
      if (epoch === composerEpoch.current) {
        setDraft(submission)
        setAttachments(attachments)
        setAttachmentError(`未能发送，请重试。${e instanceof Error ? e.message : ''}`)
      } else releaseAttachmentPreviews(attachments)
    } finally {
      preparingRef.current = false
      setIsPreparing(false)
      setLoading(false)
    }
  }, [draft, attachments, questionEdit, isLoading, activeSessionId, setLoading, requestScopeFiles, selectedScopeFiles, activeSession, sendMessage, followLatestMessage])

  const handleSend = useCallback(() => {
    void submitMessage()
  }, [submitMessage])

  const editQuestion = async (question: Message) => {
    if (!activeSessionId || isLoading || preparingRef.current) return
    if (questionEdit?.messageId === question.id) {
      inputRef.current?.focus()
      return
    }
    preparingRef.current = true
    setIsPreparing(true)
    const sessionId = activeSessionId
    const epoch = composerEpoch.current
    try {
      const recovered = await prepareQuestionEdit(question)
      const kbIds = [...new Set(recovered.value.mentions.flatMap(ref => ref.kbId ? [ref.kbId] : []))]
      const catalogs = await Promise.allSettled(kbIds.map(loadScopeKbFiles))
      if (epoch !== composerEpoch.current || useChatStore.getState().activeSessionId !== sessionId) return
      const restored = recovered.files.map(item => ({ ...item,
        previewUrl: chatFileKind(item.file) === 'image' ? URL.createObjectURL(item.file) : undefined,
      }))
      // Preserve the original draft when moving between older questions, until cancel or submit.
      if (questionEdit) releaseAttachmentPreviews(attachments)
      setQuestionEdit({ messageId: question.id, previous: questionEdit?.previous
        ?? { value: draft, files: attachments, scope: selectedScopeFiles } })
      setAttachments(restored)
      setSelectedScopeFiles(recovered.scope)
      setDraft({ ...recovered.value, mentions: recovered.value.mentions.map(ref => {
        const local = restored.find(item => item.id === ref.attachmentId)
        const catalog = catalogs[kbIds.indexOf(ref.kbId ?? '')]
        const kbFile = catalog?.status === 'fulfilled' ? catalog.value.find(file => file.id === ref.fileId) : undefined
        return { ...ref, previewUrl: local?.previewUrl ?? kbFile?.previewUrl, coverUrl: kbFile?.coverUrl }
      }) })
      setMentionState(null)
      setAttachmentError('')
      setEditorRevision(prev => prev + 1)
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch (error) {
      if (epoch === composerEpoch.current && useChatStore.getState().activeSessionId === sessionId) {
        setAttachmentError(error instanceof Error ? error.message : '恢复问题失败，请重试。')
      }
    } finally {
      preparingRef.current = false
      setIsPreparing(false)
    }
  }

  const cancelQuestionEdit = () => {
    if (!questionEdit || isLoading || preparingRef.current) return
    releaseAttachmentPreviews(attachments)
    setDraft(questionEdit.previous.value)
    setAttachments(questionEdit.previous.files)
    setSelectedScopeFiles(questionEdit.previous.scope)
    setQuestionEdit(null)
    setAttachmentError('')
    setMentionState(null)
    setEditorRevision(prev => prev + 1)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const regenerateAnswer = useCallback(async (originalQuestion: Message) => {
    if (!activeSessionId || isLoading || isStreaming) return
    followLatestMessage()
    setLoading(true)
    try {
      const files = explicitScopeFiles(originalQuestion)
      const kbIds = files.length
        ? [...new Set(files.map((file) => file.kbId))]
        : activeSession?.kbMode === 'manual' ? activeSession.knowledgeBaseIds : undefined
      await sendMessage(originalQuestion.content, kbIds, activeSessionId, undefined, files, originalQuestion.mentions)
    } finally {
      setLoading(false)
    }
  }, [activeSessionId, activeSession, isLoading, isStreaming, sendMessage, setLoading, followLatestMessage])

  const handleStop = () => {
    if (!activeSessionId || !isStreaming) return
    if (pi.isStreaming) { void pi.cancel(); return }

    // 获取用户原始查询
    const userQuery = legacyChain.stopStreaming()

    // 添加终止提示消息
    const lastMessage = activeSession?.messages[activeSession.messages.length - 1]
    if (lastMessage && lastMessage.role === 'assistant') {
      // 标记最后一条消息为已终止
      updateMessage(activeSessionId, lastMessage.id, {
        error: 'stopped', // 使用 error 字段标记终止状态
      })
    }

    // 添加终止提示系统消息
    addMessage(activeSessionId, {
      role: 'assistant',
      content: '',
      error: 'stopped_hint', // 特殊标记，用于显示终止提示
    })

    // 将用户原始查询填充到输入框
    if (userQuery) {
      const saved = submittedDraftRef.current
      if (saved) {
        setQuestionEdit(saved.editing)
        const restored = saved.files.map(item => ({ ...item,
          previewUrl: chatFileKind(item.file) === 'image' ? URL.createObjectURL(item.file) : undefined,
        }))
        setAttachments(restored)
        setSelectedScopeFiles(saved.scope)
        setDraft({ ...saved.value, mentions: saved.value.mentions.map(ref => ref.source === 'attachment'
          ? { ...ref, previewUrl: restored.find(item => item.id === ref.attachmentId)?.previewUrl } : ref) })
      } else setInput(userQuery)
      setEditorRevision(prev => prev + 1)
      // 聚焦输入框
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLoading) { e.target.value = ''; return }
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    const next: Array<{ id: string; file: File; previewUrl?: string }> = []
    const errors: string[] = []
    for (const f of picked) {
      const isImage = chatFileKind(f) === 'image'
      const isAudio = chatFileKind(f) === 'audio'
      const isVideo = chatFileKind(f) === 'video'
      if (!isImage && !isAudio && !isVideo) {
        errors.push(`不支持的格式：${f.name}。请添加图片、音频或 MP4、WebM、MOV 视频。`)
        continue
      }
      const limit = maxBytesForChatFile(f)
      if (!f.size || (!piEnabled && f.size > limit)) {
        const mb = Math.round(limit / (1024 * 1024))
        errors.push(piEnabled ? `无法添加 ${f.name}：文件不能为空。` : `无法添加 ${f.name}：文件需非空且不超过 ${mb}MB。`)
        continue
      }
      if (!piEnabled && attachmentsRef.current.length + next.length >= MAX_CHAT_ATTACHMENTS) {
        errors.push(`每轮最多添加 ${MAX_CHAT_ATTACHMENTS} 个附件。`)
        break
      }
      next.push({
        id: `a-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file: f,
        ...(isImage ? { previewUrl: URL.createObjectURL(f) } : {}),
      })
    }
    setAttachments((prev) => [...prev, ...next])
    setAttachmentError([...new Set(errors)].join(' '))
    if (e.target) e.target.value = ''
  }

  // 处理引用点击：必须从「当前被点击的那条消息」里取引用，避免多条回答共用 [1][2] 时取到上一条的引用
  const handleCitationClick = useCallback((refId: number | string, event: React.MouseEvent, messageId?: string, triggerElement?: HTMLElement) => {
    const activeSession = useChatStore.getState().getActiveSession()
    if (!activeSession) return

    let citation: CitationReference | null = null
    if (messageId) {
      const msg = activeSession.messages.find(m => m.id === messageId)
      if (msg?.citations) {
        const found = msg.citations.find(c => {
          if (typeof c === 'object' && 'id' in c) return String(c.id) === String(refId)
          return false
        })
        if (found && typeof found === 'object' && 'id' in found) citation = found as CitationReference
      }
    }
    // 若已经指定 messageId 但未找到引用，避免错误回退到上一条消息
    if (!citation && !messageId) {
      for (const msg of activeSession.messages) {
        if (msg.citations) {
          const found = msg.citations.find(c => {
            if (typeof c === 'object' && 'id' in c) return String(c.id) === String(refId)
            return false
          })
          if (found && typeof found === 'object' && 'id' in found) {
            citation = found as CitationReference
            break
          }
        }
      }
    }

    if (citation) {
      const rect = event?.currentTarget?.getBoundingClientRect?.()
      if (rect) {
        citationTriggerRef.current = triggerElement ?? (event.currentTarget instanceof HTMLElement ? event.currentTarget : null)
        setCitePopover({ open: true, rect, item: citation })
      }
    }
  }, [])

  // 关闭引用悬浮卡片
  const closeCitePopover = useCallback(() => {
    setCitePopover({ open: false, rect: null, item: null })
    citationTriggerRef.current?.focus({ preventScroll: true })
  }, [])

  // 打开检查器
  const openInspectorFromPopover = useCallback(() => {
    if (citePopover.item) {
      setInspectingItem(citePopover.item)
      setInspectorOpen(true)
      closeCitePopover()
    }
  }, [citePopover.item, closeCitePopover])

  // 点击外部关闭悬浮卡片
  useEffect(() => {
    if (!citePopover.open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (citePopoverRef.current && !citePopoverRef.current.contains(e.target as Node)) {
        closeCitePopover()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCitePopover()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [citePopover.open, closeCitePopover])

  return (
    <div ref={chatWorkspaceRef} className="chat-workspace h-full min-h-0 overflow-hidden bg-transparent">
      {/* 消息区 */}
      <ScrollArea ref={scrollAreaRef} className="chat-messages min-h-0">
        <div ref={messageContentRef} className={cn(
          'chat-message-content px-4 pt-5 sm:px-8 sm:pt-7',
          messages.length === 0 && 'flex min-h-full flex-col justify-center'
        )}>
          <div
            className="mx-auto flex w-[calc(100%_-_3rem)] max-w-4xl flex-col gap-6"
            role={messages.length > 0 ? 'log' : undefined}
            aria-label={messages.length > 0 ? '对话消息' : undefined}
            aria-live={messages.length > 0 ? 'polite' : undefined}
            aria-relevant={messages.length > 0 ? 'additions text' : undefined}
          >
            {messages.length === 0 && (
              <div className="chat-empty-state mx-auto w-full min-w-0 max-w-3xl py-6 text-center sm:py-9">
                <ChatWelcome />
                <div className="mt-8 sm:mt-10">
                  <Suspense fallback={<SuggestedQuestionsLoading />}>
                    <SuggestedQuestions
                      session={activeSession}
                      selectedScopeFiles={selectedScopeFiles}
                      disabled={isLoading || !activeSessionId}
                      onSelect={(question) => {
                        void submitMessage(question)
                      }}
                    />
                  </Suspense>
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const originalQuestion = precedingQuestions[i]
              const isLastMessage = m.role === 'assistant' && i === messages.length - 1
              const isThisTabStreaming = isStreaming && activeSessionId === (pi.active?.sessionId ?? streamingSessionId)
              const isLastAndStreaming = isLastMessage && isThisTabStreaming
              return (
                <Suspense key={m.id ?? i} fallback={<MessageBubbleLoading role={m.role} />}>
                  <MessageBubble
                    message={{
                      id: m.id,
                      type: m.role === 'user' ? 'user' : 'assistant',
                      content: m.content,
                      timestamp: new Date(m.timestamp).toISOString(),
                      attachments: m.attachments as ChatMessageAttachment[] | undefined,
                      mentions: m.mentions,
                      scopeFiles: m.scopeFiles,
                      citations: m.citations,
                      metadata: m.metadata,
                      diagnostics: m.diagnostics,
                      thinking: m.thinking,
                      pi: m.pi,
                      error: m.error,
                    }}
                    isStreaming={isLastAndStreaming}
                    liveThinking={
                      isLastAndStreaming && !m.pi
                        ? {
                          thoughtData: thinking.thoughtData,
                          stages: thinking.stages,
                          currentStage: thinking.currentStage,
                        }
                        : undefined
                    }
                    onCiteClick={handleCitationClick}
                    onRegenerate={originalQuestion && !originalQuestion.attachments?.length
                      ? () => { void regenerateAnswer(originalQuestion) }
                      : undefined}
                    regenerationDisabled={isLoading || isStreaming}
                    onEdit={m.role === 'user' ? () => { void editQuestion(m) } : undefined}
                    onEditRetry={originalQuestion && m.role === 'assistant' && m.error
                      ? () => { void editQuestion(originalQuestion) } : undefined}
                  />
                </Suspense>
              )
            })}

            {error && !messages.some(message => message.role === 'assistant' && message.error === error) && (
              <Card className="border-destructive/50 bg-destructive/5" role="alert">
                <CardContent className="py-3 text-sm text-destructive">
                  {error}
                </CardContent>
              </Card>
            )}

            <div aria-hidden />
          </div>
        </div>
      </ScrollArea>

      {/* 输入区 - Gemini 风格悬浮框 */}
      <div ref={composerDockRef} className="chat-composer-dock relative px-4 pb-4 sm:px-6">
        <div data-pi-state={piEnabled ? piState : undefined} className={cn('chat-composer-frame mx-auto max-w-[62rem] relative', piEnabled && 'pi-composer-frame')}>
          {piEnabled && <svg className="pi-composer-trails" width="100%" height="100%" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id={piComposerGradientId} x1="0%" y1="0%" x2="100%" y2="25%">
                <stop offset="0%" stopColor="var(--pi-cyan)" />
                <stop offset="25%" stopColor="var(--pi-blue)" />
                <stop offset="60%" stopColor="var(--pi-violet)" />
                <stop offset="100%" stopColor="var(--pi-pink)" />
              </linearGradient>
            </defs>
            <rect className="pi-composer-edge" x="1" y="1" width="100%" height="100%" rx="27" stroke={`url(#${piComposerGradientId})`} />
            {['cyan', 'pink'].map(color => <g key={color} className={`pi-composer-trail pi-composer-trail--${color}`}>
              {PI_COMPOSER_TRAIL_LAYERS.map((layer, index) => <rect key={index} x="1" y="1" width="100%" height="100%" rx="27" pathLength="100" strokeDasharray={layer.dashArray} opacity={layer.opacity} />)}
            </g>)}
          </svg>}
          {/* 一体化输入框：flex 布局，textarea 与按钮区分离；focus 时极细 indigo/fuchsia 环与品牌一致 */}
          <div data-pi-state={piEnabled ? piState : undefined} className={cn("chat-composer flex flex-col overflow-hidden rounded-[1.75rem] border border-slate-200/75 bg-white/90 shadow-[0_22px_52px_-36px_rgba(15,23,42,0.72),0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-white/70 backdrop-blur-xl transition-[box-shadow,border-color] duration-200 focus-within:border-indigo-300/80 focus-within:ring-indigo-200/80 dark:border-slate-700/70 dark:bg-slate-900/80 dark:shadow-[0_24px_62px_-42px_rgba(0,0,0,0.95)] dark:ring-white/[0.05] dark:focus-within:border-indigo-400/40 dark:focus-within:ring-indigo-400/20", piEnabled && 'pi-composer')}>
            {questionEdit && (
              <div className="flex items-center gap-2 border-b border-indigo-100/80 bg-indigo-50/60 px-5 py-2 text-xs dark:border-indigo-500/20 dark:bg-indigo-950/30">
                <Pencil size={13} className="text-indigo-500 dark:text-indigo-300" aria-hidden />
                <span className="font-medium text-indigo-700 dark:text-indigo-200">编辑问题</span>
                <span className="text-slate-500 dark:text-slate-400">发送后重新检索，原对话保留</span>
                <button type="button" onClick={cancelQuestionEdit} disabled={isLoading}
                  className="ml-auto rounded-md px-2 py-1 text-slate-600 transition-colors hover:bg-indigo-100/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-indigo-900/50">
                  取消编辑
                </button>
              </div>
            )}
            {(selectedScopeFiles.length > 0 || attachments.length > 0) && (
              <div className="flex flex-col gap-3 border-b border-slate-100/90 bg-gradient-to-b from-slate-50/95 via-stone-50/70 to-white/40 px-4 py-3 dark:border-slate-700/60 dark:from-slate-950/40 dark:via-slate-900/40 dark:to-slate-900/10">
                {selectedScopeFiles.length > 0 && (
                  <div className="composer-scope-files" role="list" aria-label="已引用的文件">
                    {selectedScopeFiles.map((file) => {
                      const source = scopeFilesByKb[file.kbId]?.find(item => item.id === file.fileId)
                        ?? { name: file.name, type: file.type || '' }
                      return (
                        <div key={`${file.kbId}::${file.fileId}`} className="composer-scope-card" role="listitem">
                          <FileScopeThumbnail file={source} />
                          <div className="composer-scope-copy">
                            <span className="composer-scope-name" title={file.name}>{file.name}</span>
                            <span className="composer-scope-origin" title={file.kbName}>
                              <AtSign size={11} aria-hidden />
                              <span>{file.kbName || '素材空间'}</span>
                              <span aria-hidden>·</span>{filePresentation(source).label}
                            </span>
                          </div>
                          <button
                            type="button"
                            title={`移除检索文件：${file.name}`}
                            disabled={isLoading}
                            aria-label={`移除检索文件：${file.kbName ? `${file.kbName} / ${file.name}` : file.name}`}
                            onClick={() => setSelectedScopeFiles(prev => prev.filter(item => !(item.kbId === file.kbId && item.fileId === file.fileId)))}
                            className="composer-scope-remove"
                          ><X size={14} aria-hidden /></button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="space-y-2">
                    <div className="local-attachment-heading"><span>本机附件 · {attachments.length}{!piEnabled && ` / ${MAX_CHAT_ATTACHMENTS}`}</span><span>输入 @ 引用 · 本轮使用</span></div>
                    <div className="flex flex-wrap items-center gap-2">
                    {attachments.map((a) => {
                      const item: ChatMessageAttachment = {
                        id: a.id,
                        kind: chatFileKind(a.file) ?? 'image',
                        name: a.file.name,
                        size: a.file.size,
                        previewUrl: a.previewUrl,
                      }
                      return (
                        <Suspense key={a.id} fallback={<ComposerAttachmentTileFallback />}>
                          <ComposerAttachmentTile
                            item={item}
                            disabled={isLoading}
                            onReference={() => { inputRef.current?.insertReference({ source: 'attachment', attachmentId: a.id, name: a.file.name, type: a.file.type, previewUrl: a.previewUrl }) }}
                            onRemove={() => {
                              if (isLoading) return
                              if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
                              setDraft(prev => removeReferences(prev, ref => ref.attachmentId === a.id))
                              setEditorRevision(prev => prev + 1)
                              setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                            }}
                          />
                        </Suspense>
                      )
                    })}
                    </div>
                  </div>
                )}
              </div>
            )}
            <Suspense fallback={<div className="min-h-[72px] px-6 py-5 text-sm text-slate-400" role="status">正在准备输入框…</div>}>
            <MentionComposer
              key={`${activeSessionId}-${editorRevision}`}
              ref={inputRef}
              value={draft}
              onChange={setDraft}
              onMentionChange={setMentionState}
              disabled={isLoading || !activeSessionId}
              listboxId={mentionState ? mentionListboxId : undefined}
              activeOptionId={mentionActiveOptionId}
              onKeyDown={(e) => {
                if (mentionState) {
                  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && mentionOptions.length) {
                    setMentionHighlightIndex(prev => (prev + (e.key === 'ArrowDown' ? 1 : -1) + mentionOptions.length) % mentionOptions.length)
                    return true
                  }
                  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                    const target = mentionOptions[Math.min(mentionHighlightIndex, mentionOptions.length - 1)]
                    if (target) insertMentionSelection(target)
                    return e.key === 'Enter' || Boolean(target)
                  }
                  if (e.key === 'Escape') { setMentionState(null); return true }
                }
                if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) { handleSend(); return true }
                return false
              }}
            />
            </Suspense>
            {attachmentError && <p className="composer-attachment-error" role="alert">{attachmentError}</p>}
            {piEnabled && piConfigError && <p className="pi-composer-config-error" role="alert">{piConfigError}</p>}

            {mentionState && (
              <section className="file-mention-panel" aria-label="引用素材文件">
                <header className="file-mention-heading">
                  <span className="file-mention-title"><AtSign size={15} aria-hidden />引用文件</span>
                  <span className="file-mention-count" role="status">
                    {mentionOptions.length} 个{mentionState.query ? '匹配文件' : '可选文件'}
                    {scopeLoadingKbIds.length > 0 && ' · 加载中…'}
                  </span>
                </header>
                {scopeFailedKbIds.length > 0 && (
                  <div className="file-mention-error" role="status">
                    <span>{scopeFailedKbIds.length} 个空间加载失败，结果暂不完整。</span>
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { void ensureAllKbFiles(true) }}>重试</button>
                  </div>
                )}
                <div
                  id={mentionListboxId}
                  ref={mentionListRef}
                  role="listbox"
                  aria-label="可添加的检索文件"
                  aria-busy={scopeLoadingKbIds.length > 0}
                  className="file-mention-list"
                >
                  {localMentionOptions.length > 0 && (
                    <div role="group" aria-label="本机附件，仅用于当前对话" className="file-mention-group" data-source="attachment">
                      <div className="file-mention-group-title"><span>本机附件</span><span>本轮使用 · 未入库</span></div>
                      {localMentionOptions.map((option, index) => (
                        <button key={option.attachmentId} id={`${mentionListboxId}-option-${index}`}
                          ref={node => { mentionOptionRefs.current[index] = node }} type="button" role="option"
                          aria-selected={index === mentionHighlightIndex} tabIndex={-1}
                          onMouseDown={e => e.preventDefault()} onClick={() => insertMentionSelection(option)}
                          className="file-mention-option">
                          <FileScopeThumbnail file={option} />
                          <span className="file-mention-copy"><span className="file-mention-name">{option.name}</span>
                            <span className="file-mention-meta">本机附件<span aria-hidden>·</span>{filePresentation(option).label}</span></span>
                          {index === mentionHighlightIndex && <span className="file-mention-enter" aria-hidden>↵</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {mentionGroups.map(group => (
                    <div key={group.kbId} role="group" aria-label={`${group.kbName}，${group.totalMatches} 个匹配`} className="file-mention-group">
                      <div className="file-mention-group-title">
                        <span>{group.kbName}</span>
                        <span>{group.failed ? '加载失败' : !group.hasLoaded ? '加载中…' : `${group.totalMatches} 个文件`}</span>
                      </div>
                      {group.files.map(file => {
                        const optionIndex = mentionOptionIndexByKey.get(fileScopeKey(group.kbId, file.id)) ?? 0
                        const isActive = optionIndex === mentionHighlightIndex
                        return (
                          <button
                            key={`${group.kbId}::${file.id}`}
                            id={`${mentionListboxId}-option-${optionIndex}`}
                            ref={node => { mentionOptionRefs.current[optionIndex] = node }}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            tabIndex={-1}
                            title={`${group.kbName} / ${file.name}`}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => insertMentionSelection(mentionOptions[optionIndex])}
                            className="file-mention-option"
                          >
                            <FileScopeThumbnail file={file} />
                            <span className="file-mention-copy">
                              <span className="file-mention-name">{file.name}</span>
                              <span className="file-mention-meta">{filePresentation(file).label}<span aria-hidden>·</span>{formatScopedFileSize(file.size)}</span>
                            </span>
                            {isActive && <span className="file-mention-enter" aria-hidden>↵</span>}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                  {mentionOptions.length === 0 && scopeLoadingKbIds.length === 0 && scopeFailedKbIds.length === 0 && (
                    <p className="file-mention-empty" role="status">{mentionState.query ? '没有匹配文件，请检查知识库名称或文件关键词。' : '暂无可引用的文件，可先添加本机图片或音频。'}</p>
                  )}
                </div>
                <footer className="file-mention-footer">
                  <span>@知识库/文件 · @本机/附件</span>
                  <span className="file-mention-keys">↑↓ 选择 · Enter 添加 · Esc 关闭</span>
                </footer>
              </section>
            )}

            {/* 底部功能栏 - 独立区域，与文字区物理分离 */}
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-transparent to-slate-50/60 px-4 py-2.5 dark:to-slate-950/25">
              <div className={cn('flex shrink-0 items-center gap-2', piEnabled && 'pi-composer-controls')}>
                <button type="button" className="pi-toggle" aria-pressed={piEnabled}
                  aria-label={piEnabled ? '关闭纯 Agent 模式，恢复原回答方式' : '开启 Pi 纯 Agent 模式'}
                  title={piEnabled ? '关闭后恢复原回答方式，草稿与材料保持不变' : 'Pi 自主决定检索、阅读与回答步骤'}
                  disabled={isLoading || !activeSessionId} onMouseDown={event => event.preventDefault()}
                  onClick={() => { if (activeSessionId) updateSessionPiMode(activeSessionId, !piEnabled) }}>
                  <span className="pi-toggle-symbol" aria-hidden>π</span>
                </button>

                {!piEnabled && <button
                  type="button"
                  onClick={() => setKbConfigPanelOpen(true)}
                  title="知识库范围配置"
                  aria-label="打开知识库范围配置"
                  className="group flex h-8 items-center gap-1.5 rounded-full border border-blue-200/60 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 backdrop-blur-sm px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm shadow-blue-500/10 ring-1 ring-blue-200/30 transition-all duration-200 hover:border-blue-300/80 hover:from-blue-100/90 hover:to-indigo-100/90 hover:shadow-md hover:shadow-blue-500/20 hover:ring-blue-300/50 active:scale-95 dark:border-blue-500/40 dark:from-blue-900/30 dark:to-indigo-900/30 dark:text-blue-200 dark:ring-blue-500/20 dark:hover:border-blue-400/60 dark:hover:from-blue-800/40 dark:hover:to-indigo-800/40"
                >
                  <Database className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300 transition-transform duration-200 group-hover:scale-110" aria-hidden />
                  <span>
                    {activeSession?.kbMode === 'all'
                      ? '全部'
                      : activeSession?.kbMode === 'manual'
                        ? `指定 ${activeSession?.knowledgeBaseIds?.length ?? 0} 个`
                        : '智能路由'}
                  </span>
                </button>}

                {!piEnabled && <button
                  type="button"
                  onClick={cycleAgentMode}
                  disabled={isLoading || !activeSessionId}
                  title={agentModeHint}
                  aria-label={`回答方式：${agentModeLabel}。${agentModeHint}`}
                  className={cn(
                    'group inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold shadow-sm ring-1 transition-all duration-200 hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
                    agentMode === 'auto'
                      ? 'border-indigo-300/70 bg-indigo-50/90 text-indigo-700 shadow-indigo-500/10 ring-indigo-200/50 hover:bg-indigo-100/90 dark:border-indigo-500/40 dark:bg-indigo-950/45 dark:text-indigo-200 dark:ring-indigo-500/20'
                      : agentMode === 'agent'
                        ? 'border-violet-300/70 bg-violet-50/90 text-violet-700 shadow-violet-500/10 ring-violet-200/50 hover:bg-violet-100/90 dark:border-violet-500/40 dark:bg-violet-950/45 dark:text-violet-200 dark:ring-violet-500/20'
                        : 'border-slate-300/70 bg-white/80 text-slate-600 shadow-slate-500/10 ring-slate-200/60 hover:bg-slate-50 dark:border-slate-600/70 dark:bg-slate-900/70 dark:text-slate-300 dark:ring-slate-700/50'
                  )}
                >
                  {agentMode === 'auto' ? (
                    <Sparkles className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-12" aria-hidden />
                  ) : agentMode === 'agent' ? (
                    <BrainCircuit className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" aria-hidden />
                  ) : (
                    <Search className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" aria-hidden />
                  )}
                  <span className="hidden sm:inline">{agentModeShortLabel}</span>
                </button>}

                {piEnabled && <label className="pi-model-picker" title={piModelId ? `Pi 模型：${piModelId}` : '读取 Pi 模型配置'}>
                  {piModelLogo ? <img src={piModelLogo} alt="" width={16} height={16} /> : <Zap size={15} aria-hidden />}
                  <select aria-label="纯 Agent 独立模型" disabled={isLoading || !piConfig} value={piModelId}
                    onChange={event => activeSessionId && updateSessionPiModel(activeSessionId, event.target.value)}>
                    {!piConfig ? <option value="">读取模型…</option> : piConfig.models.map(model => <option key={model} value={model}>{piModelDisplayName(model)}</option>)}
                  </select>
                  <ChevronDown size={13} aria-hidden />
                </label>}
                {piEnabled && <span className={cn('pi-composer-status', piState === 'ready' && 'sr-only')} role="status">
                  {piState !== 'ready' && <span className="pi-status-dot" aria-hidden />}
                  {piState === 'ready' ? '纯 Agent 模式已开启' : piStatusLabel[piState]}
                </span>}

                {!piEnabled && <button
                  type="button"
                  onClick={() => setModelConfigPanelOpen(true)}
                  title="对话模型选择"
                  aria-label={`打开对话模型选择，当前模型：${currentModel}`}
                  className="group flex h-8 items-center gap-1.5 rounded-full border border-purple-200/60 bg-gradient-to-r from-purple-50/80 to-pink-50/80 backdrop-blur-sm px-3 py-1.5 text-xs font-semibold text-purple-700 shadow-sm shadow-purple-500/10 ring-1 ring-purple-200/30 transition-all duration-200 hover:border-purple-300/80 hover:from-purple-100/90 hover:to-pink-100/90 hover:shadow-md hover:shadow-purple-500/20 hover:ring-purple-300/50 active:scale-95 dark:border-purple-500/40 dark:from-purple-900/30 dark:to-pink-900/30 dark:text-purple-200 dark:ring-purple-500/20 dark:hover:border-purple-400/60 dark:hover:from-purple-800/40 dark:hover:to-pink-800/40"
                >
                  {openRouterModelRaw ? (
                    <Suspense
                      fallback={
                        <OpenRouterModelBrandIconFallback className="transition-transform duration-200 group-hover:scale-110" />
                      }
                    >
                      <OpenRouterModelBrandIcon
                        modelId={openRouterModelRaw}
                        size={14}
                        className="h-3.5 w-3.5 flex-shrink-0 p-0 ring-0 transition-transform duration-200 group-hover:scale-110 dark:bg-transparent"
                      />
                    </Suspense>
                  ) : currentModelLogo ? (
                    <img
                      src={currentModelLogo}
                      alt=""
                      className="h-3.5 w-3.5 flex-shrink-0 rounded object-contain transition-transform duration-200 group-hover:scale-110"
                      width={14}
                      height={14}
                    />
                  ) : (
                    <Zap className="h-3.5 w-3.5 flex-shrink-0 text-purple-600 dark:text-purple-300 transition-transform duration-200 group-hover:scale-110 group-hover:rotate-12" aria-hidden />
                  )}
                  <span className="hidden max-w-[120px] truncate sm:inline">{currentModel}</span>
                </button>}
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-2">
                {piEnabled && <button type="button" className="pi-scope-trigger"
                  onClick={() => setKbConfigPanelOpen(true)} disabled={isLoading || !activeSessionId}
                  title={activeSession?.kbMode === 'manual' ? `检索范围：指定 ${activeSession.knowledgeBaseIds.length} 个知识库` : '检索范围：全部可访问的知识库'}
                  aria-label="打开知识库范围配置" aria-haspopup="dialog" aria-expanded={kbConfigPanelOpen}>
                  <Database size={15} strokeWidth={1.7} aria-hidden />
                  {activeSession?.kbMode === 'manual' && <span>{activeSession.knowledgeBaseIds.length}</span>}
                </button>}
                <button
                  type="button"
                  onClick={() => setFileScopePickerOpen(true)}
                  disabled={isLoading || !activeSessionId}
                  title="指定检索文件"
                  aria-label={`打开指定检索文件选择器，当前已选 ${requestScopeFiles.length} 个文件`}
                  aria-haspopup="dialog"
                  aria-expanded={fileScopePickerOpen}
                  data-selected={requestScopeFiles.length > 0}
                  className="composer-file-trigger"
                >
                  <span className="composer-file-trigger__symbol" aria-hidden="true">
                    <AtSign size={15} strokeWidth={1.8} />
                  </span>
                  <span>文件</span>
                  {requestScopeFiles.length > 0 && (
                    <span className="composer-file-trigger__count" aria-hidden="true">
                      {requestScopeFiles.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || !activeSessionId}
                  title={piEnabled ? '添加图片、音频或视频附件' : '添加附件：图片/音频 10MB，视频 30MB 且 60 秒以内'}
                  aria-label="添加图片、音频或视频附件"
                  className="flex h-8 w-8 items-center justify-center text-slate-700 transition-all duration-200 hover:text-slate-900 hover:scale-110 active:scale-95 dark:text-slate-300 dark:hover:text-slate-100"
                >
                  <Paperclip className="h-5 w-5" strokeWidth={2} aria-hidden />
                </button>

                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    title="停止生成"
                    aria-label="停止生成"
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/30 transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/40 hover:scale-105 active:scale-95"
                    )}
                  >
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSend}
                    title={questionEdit ? '重新检索生成' : '发送'}
                    aria-label={questionEdit ? '重新检索生成' : '发送消息'}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/30 transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/40 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                    )}
                    disabled={(!input.trim() && attachments.length === 0) || isLoading || !activeSessionId}
                  >
                    <Send className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,audio/*,video/mp4,video/webm,video/quicktime"
          className="hidden"
          aria-label="选择图片或音频附件"
          onChange={handleFileSelect}
        />
      </div>

      {/* 引用悬浮卡片 */}
      {citePopover.open ? (
        <div ref={citePopoverRef}>
          <Suspense fallback={null}>
            <CitationPopover
              open={citePopover.open}
              rect={citePopover.rect}
              item={citePopover.item}
              onClose={closeCitePopover}
              onOpenInspector={openInspectorFromPopover}
            />
          </Suspense>
        </div>
      ) : null}

      {/* 配置面板 */}
      {kbConfigPanelOpen ? (
        <Suspense fallback={null}>
          <KnowledgeBaseConfigPanel open={kbConfigPanelOpen} onOpenChange={setKbConfigPanelOpen} />
        </Suspense>
      ) : null}
      {fileScopePickerOpen ? (
        <Suspense fallback={null}>
          <FileScopePicker
            open={fileScopePickerOpen}
            onOpenChange={setFileScopePickerOpen}
            value={requestScopeFiles}
            onChange={setSelectedScopeFiles}
          />
        </Suspense>
      ) : null}
      {modelConfigPanelOpen ? (
        <Suspense fallback={null}>
          <ModelConfigPanel open={modelConfigPanelOpen} onOpenChange={setModelConfigPanelOpen} />
        </Suspense>
      ) : null}

      {/* 检查器侧边栏 */}
      {inspectorOpen ? (
        <Suspense fallback={null}>
          <InspectorDrawer
            isOpen={inspectorOpen}
            onClose={() => {
              setInspectorOpen(false)
              setInspectingItem(null)
            }}
            citations={inspectingItem ? [inspectingItem] : []}
            returnFocusTarget={citationTriggerRef.current}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

export default ChatInterface
