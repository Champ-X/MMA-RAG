import { FormEvent, useDeferredValue, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowRight,
  Check,
  Clock3,
  Loader2,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { nexusApi, NexusApiError, type Conversation } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { InlineNotice } from '@/components/nexus/InlineNotice'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { StatusMark } from '@/components/nexus/StatusMark'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { getBrowserStorage } from '@/lib/browserStorage'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import {
  markLegacyPinsMigrated,
  readLegacyPinnedConversationIds,
  shouldFocusConversationSearch,
} from './conversationHistory'
import {
  buildConversationArchiveViewModel,
  type ConversationArchiveAction,
} from './conversationArchiveViewModel'
import {
  buildConversationPinViewModel,
  type ConversationPinAction,
} from './conversationPinViewModel'
import { buildConversationRenameViewModel } from './conversationRenameViewModel'
import './ConversationHistoryPage.css'

type ConversationPatch = {
  conversation: Conversation
  title?: string
  pinned?: boolean
  archived?: boolean
}
type ConversationArchiveReceipt = {
  action: ConversationArchiveAction
  title: string
}
type ConversationPinReceipt = {
  action: ConversationPinAction
  title: string
}
const conversationArchiveFeedbackId = 'conversation-archive-feedback'
const conversationPinFeedbackId = 'conversation-pin-feedback'
const conversationRenameFeedbackId = 'conversation-rename-feedback'
const conversationRenameTitleHelpId = 'conversation-rename-title-help'
const conversationRowGateId = (conversationId: string, action: string) => `conversation-${conversationId}-${action}-gate`
const conversationStatusFilters = ['active', 'archived'] as const
type ConversationStatusFilter = (typeof conversationStatusFilters)[number]

export default function ConversationHistoryPage() {
  const queryClient = useQueryClient()
  const searchRef = useRef<HTMLInputElement>(null)
  const statusFilterRefs = useRef<Partial<Record<ConversationStatusFilter, HTMLButtonElement | null>>>({})
  const migrationStarted = useRef(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [archiveReceipt, setArchiveReceipt] = useState<ConversationArchiveReceipt | null>(null)
  const [pinReceipt, setPinReceipt] = useState<ConversationPinReceipt | null>(null)
  const selectedStatusFilter: ConversationStatusFilter = showArchived ? 'archived' : 'active'

  const history = useInfiniteQuery({
    queryKey: ['conversations', deferredQuery, showArchived],
    queryFn: ({ pageParam }) => nexusApi.listConversations({
      query: deferredQuery || undefined,
      archived: showArchived,
      cursor: pageParam,
      limit: 50,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.next_cursor ?? undefined,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === showArchived ? previousData : undefined,
    refetchInterval: 10000,
  })
  const conversations = history.data?.pages.flatMap((page) => page.items) ?? []
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: history.error, hasData: Boolean(history.data), label: 'Conversation history', required: true },
  ])
  const retryConversationHistory = () => {
    void history.refetch()
  }
  const selectStatusFilter = (nextFilter: ConversationStatusFilter) => {
    setShowArchived(nextFilter === 'archived')
  }
  const handleStatusFilterKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextFilter = moveRadioGroupValue(conversationStatusFilters, selectedStatusFilter, direction)
    selectStatusFilter(nextFilter)
    window.requestAnimationFrame(() => statusFilterRefs.current[nextFilter]?.focus({ preventScroll: true }))
  }

  const updateConversation = useMutation({
    mutationFn: ({ conversation, ...changes }: ConversationPatch) =>
      nexusApi.updateConversation(conversation.id, {
        expected_revision: conversation.revision,
        ...changes,
    }),
    onMutate: (patch) => {
      if (patch.archived !== undefined) setArchiveReceipt(null)
      if (patch.pinned !== undefined) setPinReceipt(null)
    },
    onSuccess: (_conversation, patch) => {
      if (patch.archived !== undefined) {
        setArchiveReceipt({
          action: patch.archived ? 'archive' : 'restore',
          title: patch.conversation.title,
        })
      }
      if (patch.pinned !== undefined) {
        setPinReceipt({
          action: patch.pinned ? 'pin' : 'unpin',
          title: patch.conversation.title,
        })
      }
      setEditingId(null)
      void queryClient.resetQueries({ queryKey: ['conversations'] })
    },
    onError: () => {
      void queryClient.resetQueries({ queryKey: ['conversations'] })
    },
  })

  useEffect(() => {
    const focusHistorySearch = (event: KeyboardEvent) => {
      if (shouldFocusConversationSearch({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        key: event.key,
        metaKey: event.metaKey,
        target: event.target,
      })) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusHistorySearch)
    return () => window.removeEventListener('keydown', focusHistorySearch)
  }, [])

  useEffect(() => {
    if (!history.isSuccess || migrationStarted.current) return
    migrationStarted.current = true
    const legacyStorage = getBrowserStorage('local')
    const legacyIds = readLegacyPinnedConversationIds(legacyStorage)
    const migrate = async () => {
      try {
        for (const id of legacyIds) {
          try {
            const conversation = await nexusApi.getConversation(id)
            if (!conversation.pinned) {
              await nexusApi.updateConversation(id, {
                expected_revision: conversation.revision,
                pinned: true,
              })
            }
          } catch (error) {
            if (!(error instanceof NexusApiError) || error.status !== 404) throw error
          }
        }
        markLegacyPinsMigrated(legacyStorage)
        if (legacyIds.length) {
          await queryClient.resetQueries({ queryKey: ['conversations'] })
        }
      } catch {
        migrationStarted.current = false
      }
    }
    void migrate()
  }, [history.isSuccess, queryClient])

  const beginRename = (conversation: Conversation) => {
    updateConversation.reset()
    setEditingId(conversation.id)
    setDraftTitle(conversation.title)
  }

  const submitRename = (event: FormEvent, conversation: Conversation) => {
    event.preventDefault()
    const title = draftTitle.trim()
    const isSaving = updateConversation.isPending
      && updateConversation.variables?.conversation.id === conversation.id
    const errorMessage = updateConversation.error && updateConversation.variables?.conversation.id === conversation.id
      ? 'The title was not saved. The conversation may have changed elsewhere; review the latest version and try again.'
      : undefined
    const rename = buildConversationRenameViewModel({
      draftTitle,
      errorMessage,
      originalTitle: conversation.title,
      pending: isSaving,
    })
    if (!rename.canSubmit) return
    updateConversation.mutate({ conversation, title })
  }

  if (history.isLoading) return <LoadingState label="Recovering conversation history" />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell conversation-history-page"><PageHeader eyebrow="Durable work history" title="Conversations could not be loaded" description="Nexus could not read the durable conversation ledger." actions={<Link className="button primary" to="/research/new"><Plus size={16} />New conversation</Link>} /><QueryErrorNotice model={queryErrorNotice} onRetry={retryConversationHistory} /><EmptyState title="Conversation history is temporarily unavailable" body="Retry before treating this workspace as having no conversations. Existing evidence-bound work may still be present in the durable ledger." /></div>
  const activePatch = updateConversation.variables
  const archivePatchAction: ConversationArchiveAction | undefined = activePatch?.archived === undefined
    ? undefined
    : activePatch.archived ? 'archive' : 'restore'
  const pinPatchAction: ConversationPinAction | undefined = activePatch?.pinned === undefined
    ? undefined
    : activePatch.pinned ? 'pin' : 'unpin'
  const archiveAction = archivePatchAction ?? archiveReceipt?.action ?? (showArchived ? 'restore' : 'archive')
  const archiveFeedback = buildConversationArchiveViewModel({
    action: archiveAction,
    completedTitle: archiveReceipt?.title,
    errorMessage: updateConversation.error && archivePatchAction
      ? 'That history change could not be saved. The latest conversation revision has been reloaded.'
      : undefined,
    pending: updateConversation.isPending && Boolean(archivePatchAction),
    targetTitle: activePatch?.conversation.title,
  })
  const pinAction = pinPatchAction ?? pinReceipt?.action ?? 'pin'
  const pinFeedback = buildConversationPinViewModel({
    action: pinAction,
    completedTitle: pinReceipt?.title,
    errorMessage: updateConversation.error && pinPatchAction
      ? 'That priority change could not be saved. The latest conversation revision has been reloaded.'
      : undefined,
    pending: updateConversation.isPending && Boolean(pinPatchAction),
    targetTitle: activePatch?.conversation.title,
  })
  const showUnscopedUpdateError = updateConversation.error
    && activePatch?.archived === undefined
    && activePatch?.pinned === undefined
    && activePatch?.title === undefined
  return (
    <div className="page-shell conversation-history-page">
      <PageHeader
        eyebrow="Durable work history"
        title="Conversations"
        description="Search every turn, name important threads, and keep your evidence-bound work organized across sessions and devices."
        actions={<Link className="button primary" to="/research/new"><Plus size={16} />New conversation</Link>}
      />

      <div className="history-toolbar">
        <label className="history-search">
          <Search size={16} />
          <span className="sr-only">Search conversations</span>
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and every question…" />
          <kbd>/</kbd>
        </label>
        <div className="history-view-switch" role="radiogroup" aria-label="Conversation status">
          <button type="button" ref={(node) => { statusFilterRefs.current.active = node }} role="radio" aria-checked={!showArchived} tabIndex={!showArchived ? 0 : -1} className={!showArchived ? 'selected' : undefined} onKeyDown={handleStatusFilterKeyDown} onClick={() => selectStatusFilter('active')}>Active</button>
          <button type="button" ref={(node) => { statusFilterRefs.current.archived = node }} role="radio" aria-checked={showArchived} tabIndex={showArchived ? 0 : -1} className={showArchived ? 'selected' : undefined} onKeyDown={handleStatusFilterKeyDown} onClick={() => selectStatusFilter('archived')}>Archived</button>
        </div>
        <span>
          {history.isFetching && !history.isFetchingNextPage && <Loader2 className="spin" size={12} />}
          {conversations.length}{history.hasNextPage ? '+' : ''} conversation{conversations.length === 1 ? '' : 's'}
        </span>
      </div>
      <SubmitReadinessCard className="conversation-archive-feedback" detail={archiveFeedback.feedbackDetail} id={conversationArchiveFeedbackId} label={archiveFeedback.feedbackLabel} liveMode={archiveFeedback.liveMode} pending={archiveFeedback.feedbackTone === 'pending'} role={archiveFeedback.role} tone={archiveFeedback.feedbackTone} visible={archiveFeedback.visible} />
      <SubmitReadinessCard className="conversation-pin-feedback" detail={pinFeedback.feedbackDetail} id={conversationPinFeedbackId} label={pinFeedback.feedbackLabel} liveMode={pinFeedback.liveMode} pending={pinFeedback.feedbackTone === 'pending'} role={pinFeedback.role} tone={pinFeedback.feedbackTone} visible={pinFeedback.visible} />

      <QueryErrorNotice model={queryErrorNotice} onRetry={retryConversationHistory} />
      {showUnscopedUpdateError && (
        <InlineNotice tone="negative" role="status">
          That change could not be saved. The conversation may have changed elsewhere; the latest version has been reloaded.
        </InlineNotice>
      )}
      {conversations.length ? (
        <>
          <div className="conversation-ledger">
            {conversations.map((conversation) => {
              const isSaving = updateConversation.isPending
                && updateConversation.variables?.conversation.id === conversation.id
              const isEditing = editingId === conversation.id
              const renameErrorMessage = isEditing && updateConversation.error && updateConversation.variables?.conversation.id === conversation.id
                ? 'The title was not saved. The conversation may have changed elsewhere; review the latest version and try again.'
                : undefined
              const rename = buildConversationRenameViewModel({
                draftTitle,
                errorMessage: renameErrorMessage,
                originalTitle: conversation.title,
                pending: isSaving,
              })
              const rowArchiveAction: ConversationArchiveAction = conversation.archived ? 'restore' : 'archive'
              const archiveErrorMessage = updateConversation.error
                && updateConversation.variables?.conversation.id === conversation.id
                && updateConversation.variables?.archived !== undefined
                ? 'That history change could not be saved. The latest conversation revision has been reloaded.'
                : undefined
              const rowArchive = buildConversationArchiveViewModel({
                action: rowArchiveAction,
                errorMessage: archiveErrorMessage,
                pending: isSaving && updateConversation.variables?.archived !== undefined,
                targetTitle: conversation.title,
              })
              const rowPinAction: ConversationPinAction = conversation.pinned ? 'unpin' : 'pin'
              const pinErrorMessage = updateConversation.error
                && updateConversation.variables?.conversation.id === conversation.id
                && updateConversation.variables?.pinned !== undefined
                ? 'That priority change could not be saved. The latest conversation revision has been reloaded.'
                : undefined
              const rowPin = buildConversationPinViewModel({
                action: rowPinAction,
                errorMessage: pinErrorMessage,
                pending: isSaving && updateConversation.variables?.pinned !== undefined,
                targetTitle: conversation.title,
              })
              return (
                <article className={`${conversation.pinned ? 'is-pinned ' : ''}${isEditing ? 'is-renaming' : ''}`.trim() || undefined} key={conversation.id}>
                  <button
                    type="button"
                    className="history-pin"
                    aria-describedby={`${conversationPinFeedbackId}${rowPin.disabledDetail ? ` ${conversationRowGateId(conversation.id, 'pin')}` : ''}`}
                    aria-disabled={rowPin.ariaDisabled || undefined}
                    onClick={() => { if (rowPin.canSubmit) updateConversation.mutate({ conversation, pinned: !conversation.pinned }) }}
                    aria-label={rowPin.ariaLabel}
                    title={rowPin.actionLabel}
                  >
                    {isSaving && updateConversation.variables?.pinned !== undefined
                      ? <Loader2 className="spin" size={15} />
                      : conversation.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>
                  {rowPin.disabledDetail && <span className="sr-only" id={conversationRowGateId(conversation.id, 'pin')}>{rowPin.disabledDetail}</span>}
                  <Link className="conversation-open" to={`/runs/${conversation.latest_run_id}`}>
                    <span className="conversation-glyph"><MessageSquare size={18} /><small>{conversation.run_count}</small></span>
                    <span className="conversation-copy">
                      <span className="conversation-kicker">{conversation.kinds.join(' + ')} · {conversation.space_ids.length || 'auto'} Space{conversation.space_ids.length === 1 ? '' : 's'}</span>
                      <strong>{conversation.title}</strong>
                      {conversation.run_count > 1 && <small>Latest: {conversation.latest_goal}</small>}
                    </span>
                    <span className="conversation-proof"><ShieldCheck size={14} />{conversation.citation_count} citation{conversation.citation_count === 1 ? '' : 's'}</span>
                    <StatusMark status={conversation.latest_status} />
                    <time><Clock3 size={13} />{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(conversation.last_activity_at))}</time>
                    <ArrowRight size={17} />
                  </Link>
                  {isEditing && (
                    <form className="conversation-rename" onSubmit={(event) => submitRename(event, conversation)}>
                      <p className="sr-only" id={conversationRenameTitleHelpId}>Conversation title is required before saving a rename.</p>
                      <input
                        autoFocus
                        maxLength={160}
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setEditingId(null)
                        }}
                        aria-label="Conversation title"
                        aria-describedby={`${conversationRenameTitleHelpId} ${conversationRenameFeedbackId}`}
                        aria-invalid={rename.titleInvalid}
                      />
                      <button type="submit" aria-disabled={rename.ariaDisabled || undefined} aria-describedby={`${conversationRenameFeedbackId}${rename.disabledDetail ? ` ${conversationRowGateId(conversation.id, 'rename')}` : ''}`} aria-label={rename.submitLabel}>{isSaving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}</button>
                      <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel rename"><X size={14} /></button>
                      {rename.disabledDetail && <span className="sr-only" id={conversationRowGateId(conversation.id, 'rename')}>{rename.disabledDetail}</span>}
                      <SubmitReadinessCard className="conversation-rename-feedback" detail={rename.feedbackDetail} id={conversationRenameFeedbackId} label={rename.feedbackLabel} liveMode={rename.feedbackTone === 'error' ? 'assertive' : 'polite'} pending={rename.feedbackTone === 'pending'} role={rename.feedbackTone === 'error' ? 'alert' : 'status'} tone={rename.feedbackTone} />
                    </form>
                  )}
                  {!isEditing && (
                    <div className="conversation-actions">
                      <button type="button" onClick={() => { if (!isSaving) beginRename(conversation) }} aria-disabled={isSaving || undefined} aria-describedby={isSaving ? conversationRowGateId(conversation.id, 'row-busy') : undefined} title="Rename conversation"><Pencil size={14} /><span>Rename</span></button>
                      <button
                        type="button"
                        onClick={() => { if (rowArchive.canSubmit) updateConversation.mutate({ conversation, archived: !conversation.archived }) }}
                        aria-describedby={`${conversationArchiveFeedbackId}${rowArchive.disabledDetail ? ` ${conversationRowGateId(conversation.id, 'archive')}` : ''}`}
                        aria-disabled={rowArchive.ariaDisabled || undefined}
                        title={conversation.archived ? 'Restore conversation' : 'Archive conversation'}
                      >
                        {conversation.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                        <span>{rowArchive.actionLabel}</span>
                      </button>
                      {isSaving && <span className="sr-only" id={conversationRowGateId(conversation.id, 'row-busy')}>Conversation actions are locked while the latest history change is being saved.</span>}
                      {rowArchive.disabledDetail && <span className="sr-only" id={conversationRowGateId(conversation.id, 'archive')}>{rowArchive.disabledDetail}</span>}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          {history.hasNextPage && (
            <div className="history-load-more">
              <button type="button" className="button" aria-disabled={history.isFetchingNextPage || undefined} onClick={() => { if (!history.isFetchingNextPage) history.fetchNextPage() }}>
                {history.isFetchingNextPage ? <><Loader2 className="spin" size={15} />Loading history</> : 'Load older conversations'}
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title={deferredQuery ? 'No conversation matches' : showArchived ? 'No archived conversations' : 'Start your first conversation'}
          body={deferredQuery ? 'Try a title, question, topic or decision keyword from any turn.' : showArchived ? 'Archived threads stay recoverable here without cluttering active work.' : 'Quick answers and deep research both stay recoverable here.'}
          action={deferredQuery ? <button type="button" className="button" onClick={() => setQuery('')}>Clear search</button> : showArchived ? <button type="button" className="button" onClick={() => selectStatusFilter('active')}>View active</button> : <Link className="button primary" to="/research/new">Ask your evidence</Link>}
        />
      )}
    </div>
  )
}
