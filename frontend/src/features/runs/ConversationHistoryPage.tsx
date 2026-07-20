import { FormEvent, useDeferredValue, useEffect, useRef, useState } from 'react'
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
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'
import { markLegacyPinsMigrated, readLegacyPinnedConversationIds } from './conversationHistory'

type ConversationPatch = {
  conversation: Conversation
  title?: string
  pinned?: boolean
  archived?: boolean
}

export default function ConversationHistoryPage() {
  const queryClient = useQueryClient()
  const searchRef = useRef<HTMLInputElement>(null)
  const migrationStarted = useRef(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

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

  const updateConversation = useMutation({
    mutationFn: ({ conversation, ...changes }: ConversationPatch) =>
      nexusApi.updateConversation(conversation.id, {
        expected_revision: conversation.revision,
        ...changes,
    }),
    onSuccess: () => {
      setEditingId(null)
      void queryClient.resetQueries({ queryKey: ['conversations'] })
    },
    onError: () => {
      void queryClient.resetQueries({ queryKey: ['conversations'] })
    },
  })

  useEffect(() => {
    const focusHistorySearch = (event: KeyboardEvent) => {
      const target = event.target
      const isEditing = target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (event.key === '/' && !isEditing && !event.metaKey && !event.ctrlKey && !event.altKey) {
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
    const legacyIds = readLegacyPinnedConversationIds(window.localStorage)
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
        markLegacyPinsMigrated(window.localStorage)
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
    setEditingId(conversation.id)
    setDraftTitle(conversation.title)
  }

  const submitRename = (event: FormEvent, conversation: Conversation) => {
    event.preventDefault()
    const title = draftTitle.trim()
    if (!title || title === conversation.title) {
      setEditingId(null)
      return
    }
    updateConversation.mutate({ conversation, title })
  }

  if (history.isLoading) return <LoadingState label="Recovering conversation history" />
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
        <div className="history-view-switch" aria-label="Conversation status">
          <button className={!showArchived ? 'selected' : undefined} onClick={() => setShowArchived(false)}>Active</button>
          <button className={showArchived ? 'selected' : undefined} onClick={() => setShowArchived(true)}>Archived</button>
        </div>
        <span>
          {history.isFetching && !history.isFetchingNextPage && <Loader2 className="spin" size={12} />}
          {conversations.length}{history.hasNextPage ? '+' : ''} conversation{conversations.length === 1 ? '' : 's'}
        </span>
      </div>

      {history.error && <div className="notice negative">Conversation history could not be loaded. {history.error.message}</div>}
      {updateConversation.error && (
        <div className="notice negative" role="status">
          That change could not be saved. The conversation may have changed elsewhere; the latest version has been reloaded.
        </div>
      )}
      {conversations.length ? (
        <>
          <div className="conversation-ledger">
            {conversations.map((conversation) => {
              const isSaving = updateConversation.isPending
                && updateConversation.variables?.conversation.id === conversation.id
              const isEditing = editingId === conversation.id
              return (
                <article className={`${conversation.pinned ? 'is-pinned ' : ''}${isEditing ? 'is-renaming' : ''}`.trim() || undefined} key={conversation.id}>
                  <button
                    className="history-pin"
                    disabled={isSaving}
                    onClick={() => updateConversation.mutate({ conversation, pinned: !conversation.pinned })}
                    aria-label={`${conversation.pinned ? 'Unpin' : 'Pin'} ${conversation.title}`}
                    title={conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
                  >
                    {isSaving && updateConversation.variables?.pinned !== undefined
                      ? <Loader2 className="spin" size={15} />
                      : conversation.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>
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
                      <input
                        autoFocus
                        maxLength={160}
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setEditingId(null)
                        }}
                        aria-label="Conversation title"
                      />
                      <button type="submit" disabled={!draftTitle.trim() || isSaving} aria-label="Save title"><Check size={14} /></button>
                      <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel rename"><X size={14} /></button>
                    </form>
                  )}
                  {!isEditing && (
                    <div className="conversation-actions">
                      <button onClick={() => beginRename(conversation)} disabled={isSaving} title="Rename conversation"><Pencil size={14} /><span>Rename</span></button>
                      <button
                        onClick={() => updateConversation.mutate({ conversation, archived: !conversation.archived })}
                        disabled={isSaving}
                        title={conversation.archived ? 'Restore conversation' : 'Archive conversation'}
                      >
                        {conversation.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                        <span>{conversation.archived ? 'Restore' : 'Archive'}</span>
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          {history.hasNextPage && (
            <div className="history-load-more">
              <button className="button" onClick={() => history.fetchNextPage()} disabled={history.isFetchingNextPage}>
                {history.isFetchingNextPage ? <><Loader2 className="spin" size={15} />Loading history</> : 'Load older conversations'}
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title={deferredQuery ? 'No conversation matches' : showArchived ? 'No archived conversations' : 'Start your first conversation'}
          body={deferredQuery ? 'Try a title, question, topic or decision keyword from any turn.' : showArchived ? 'Archived threads stay recoverable here without cluttering active work.' : 'Quick answers and deep research both stay recoverable here.'}
          action={deferredQuery ? <button className="button" onClick={() => setQuery('')}>Clear search</button> : showArchived ? <button className="button" onClick={() => setShowArchived(false)}>View active</button> : <Link className="button primary" to="/research/new">Ask your evidence</Link>}
        />
      )}
    </div>
  )
}
