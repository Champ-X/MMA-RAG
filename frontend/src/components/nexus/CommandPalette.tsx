import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Archive,
  Blocks,
  Bot,
  Database,
  FileSearch,
  FolderKanban,
  Home,
  MessageSquare,
  Microscope,
  Network,
  Search,
  Settings2,
  Wrench,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { buildEvidenceDetailPath } from '@/lib/evidenceRoutes'
import {
  focusTrapTargetElement,
  getFocusableElements,
  resolveFocusTrapAction,
} from '@/lib/focusTrap'
import {
  buildCommandPaletteEmptyState,
  buildCommandPaletteSearchStatus,
  clampCommandPaletteIndex,
  commandPaletteOptionId,
  moveCommandPaletteIndex,
} from './CommandPaletteViewModel'
import './CommandPalette.css'

type PaletteItem = {
  id: string
  label: string
  detail: string
  section: string
  to: string
  icon: typeof Home
  keywords?: string
}

const destinations: PaletteItem[] = [
  { id: 'home', label: 'Home', detail: 'Readiness, active work and recent Spaces', section: 'Go to', to: '/', icon: Home, keywords: 'overview dashboard' },
  { id: 'ask', label: 'New conversation', detail: 'Ask a quick question or start deep research', section: 'Go to', to: '/research/new', icon: Microscope, keywords: 'ask research chat' },
  { id: 'history', label: 'Conversations', detail: 'Search and resume durable evidence threads', section: 'Go to', to: '/conversations', icon: MessageSquare, keywords: 'history runs chat' },
  { id: 'spaces', label: 'Spaces', detail: 'Browse bounded knowledge scopes', section: 'Go to', to: '/spaces', icon: FolderKanban, keywords: 'knowledge bases library' },
  { id: 'evidence', label: 'Evidence', detail: 'Search passages, figures, timestamps and cells', section: 'Go to', to: '/evidence', icon: FileSearch, keywords: 'sources search citations' },
  { id: 'studio', label: 'Artifact Studio', detail: 'Review reusable research outputs', section: 'Go to', to: '/studio', icon: Blocks, keywords: 'reports outputs' },
  { id: 'agents', label: 'Agents', detail: 'Inspect governed research profiles', section: 'Advanced', to: '/agents', icon: Bot },
  { id: 'tools', label: 'Tools', detail: 'Inspect bounded tool capabilities', section: 'Advanced', to: '/tools', icon: Wrench },
  { id: 'models', label: 'Models', detail: 'Configure providers, catalog and routing', section: 'Advanced', to: '/models/catalog', icon: Network },
  { id: 'system', label: 'System status', detail: 'Inspect control and retrieval readiness', section: 'Advanced', to: '/system/status', icon: Activity },
  { id: 'backups', label: 'Backups', detail: 'Review recoverability operations', section: 'Advanced', to: '/system/backups', icon: Archive },
  { id: 'settings', label: 'Settings', detail: 'Review safe runtime configuration', section: 'Advanced', to: '/system/settings', icon: Settings2 },
]

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const paletteRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef(true)
  const listboxBaseId = useId()
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: nexusApi.listSpaces, enabled: open })
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const conversations = useQuery({
    queryKey: ['conversations', 'palette', deferredQuery],
    queryFn: () => nexusApi.listConversations({ query: deferredQuery || undefined, limit: 8 }),
    enabled: open,
  })
  const evidence = useQuery({
    queryKey: ['evidence', 'palette', deferredQuery],
    queryFn: () => nexusApi.listEvidence({ query: deferredQuery, limit: 6 }),
    enabled: open && deferredQuery.length >= 2,
  })
  const [activeIndex, setActiveIndex] = useState(0)
  const listboxId = `${listboxBaseId}-listbox`
  const emptyState = buildCommandPaletteEmptyState(query)
  const searchStatus = buildCommandPaletteSearchStatus([
    { enabled: open, error: spaces.error, label: 'Spaces' },
    { enabled: open, error: conversations.error, label: 'Conversations' },
    { enabled: open && deferredQuery.length >= 2, error: evidence.error, label: 'Evidence' },
  ])

  const items = useMemo(() => {
    const dynamicSpaces: PaletteItem[] = (spaces.data?.items ?? []).map((space) => ({
      id: `space-${space.id}`,
      label: space.name,
      detail: `${space.source_count} sources · ${space.knowledge_profile}`,
      section: 'Spaces',
      to: `/spaces/${space.id}`,
      icon: Database,
      keywords: space.description,
    }))
    const recentConversations: PaletteItem[] = (conversations.data?.items ?? []).map((conversation) => ({
      id: `conversation-${conversation.id}`,
      label: conversation.title,
      detail: `${conversation.run_count} turn${conversation.run_count === 1 ? '' : 's'} · ${conversation.citation_count} citations · ${conversation.latest_status}`,
      section: 'Recent conversations',
      to: `/runs/${conversation.latest_run_id}`,
      icon: MessageSquare,
      keywords: conversation.latest_goal,
    }))
    const matchingEvidence: PaletteItem[] = (evidence.data?.items ?? []).map((item) => {
      const excerpt = (item.text_content || item.searchable_text).replace(/\s+/g, ' ').trim()
      return {
        id: `evidence-${item.id}`,
        label: excerpt.slice(0, 96) || `${item.source_name} · ${item.evidence_type.replaceAll('_', ' ')}`,
        detail: `${item.source_name} · ${item.modality} · ${item.evidence_type.replaceAll('_', ' ')}`,
        section: 'Evidence',
        to: buildEvidenceDetailPath(item.id),
        icon: FileSearch,
        keywords: `${item.source_name} ${item.searchable_text}`,
      }
    })
    const staticItems = [...destinations, ...dynamicSpaces]
    const allItems = [...staticItems, ...recentConversations]
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return allItems.slice(0, 18)
    return [
      ...staticItems.filter((item) => `${item.label} ${item.detail} ${item.keywords ?? ''}`.toLocaleLowerCase().includes(normalized)),
      ...recentConversations,
      ...matchingEvidence,
    ].slice(0, 18)
  }, [conversations.data?.items, evidence.data?.items, query, spaces.data?.items])
  const activeOptionId = items.length ? commandPaletteOptionId(listboxBaseId, activeIndex) : undefined

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    restoreFocusRef.current = true
    const previousOverflow = document.body.style.overflow
    setQuery('')
    setActiveIndex(0)
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      if (restoreFocusRef.current && previousFocusRef.current && document.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus({ preventScroll: true })
      }
      previousFocusRef.current = null
    }
  }, [open])

  useEffect(() => setActiveIndex(0), [query])
  useEffect(() => {
    setActiveIndex((current) => clampCommandPaletteIndex(current, items.length))
  }, [items.length])
  useEffect(() => {
    if (!open || !activeOptionId) return
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionId, open])

  if (!open) return null
  const choose = (item: PaletteItem) => {
    restoreFocusRef.current = false
    onClose()
    navigate(item.to)
  }
  return (
    <div className="command-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section
        ref={paletteRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Nexus command palette"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            return
          }
          const focusable = getFocusableElements(paletteRef.current)
          const action = resolveFocusTrapAction({
            activeElement: document.activeElement,
            activeInside: Boolean(paletteRef.current?.contains(document.activeElement)),
            firstElement: focusable[0],
            key: event.key,
            lastElement: focusable[focusable.length - 1],
            shiftKey: event.shiftKey,
          })
          if (!action.preventDefault) return
          event.preventDefault()
          focusTrapTargetElement({ action, container: paletteRef.current, focusable })?.focus()
        }}
      >
        <header>
          <Search size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((current) => moveCommandPaletteIndex(current, items.length, 'next')) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => moveCommandPaletteIndex(current, items.length, 'previous')) }
              if (event.key === 'Home' && !query) { event.preventDefault(); setActiveIndex((current) => moveCommandPaletteIndex(current, items.length, 'first')) }
              if (event.key === 'End' && !query) { event.preventDefault(); setActiveIndex((current) => moveCommandPaletteIndex(current, items.length, 'last')) }
              if (event.key === 'Enter' && items[activeIndex]) { event.preventDefault(); choose(items[activeIndex]) }
            }}
            placeholder="Search Spaces, conversations, Evidence and actions…"
            aria-label="Search Nexus"
            role="combobox"
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-haspopup="listbox"
          />
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close command palette"><X size={16} /></button>
        </header>
        <div className="command-results" id={listboxId} role="listbox" aria-label="Nexus destinations">
          {searchStatus.visible && <div className="command-search-status" role={searchStatus.role} aria-live={searchStatus.liveMode}><strong>{searchStatus.label}</strong><small>{searchStatus.detail}</small></div>}
          {items.map((item, index) => {
            const Icon = item.icon
            return (
              <button
                type="button"
                role="option"
                id={commandPaletteOptionId(listboxBaseId, index)}
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'active' : undefined}
                key={item.id}
                tabIndex={-1}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(item)}
              >
                <span className="command-icon"><Icon size={17} /></span>
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <em>{item.section}</em>
              </button>
            )
          })}
          {!items.length && <div className="command-empty" role={emptyState.role} aria-live={emptyState.liveMode}><strong>{emptyState.label}</strong><small>{emptyState.detail}</small></div>}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></footer>
      </section>
    </div>
  )
}
