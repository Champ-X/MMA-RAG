import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Activity,
  Archive,
  Blocks,
  Bot,
  HelpCircle,
  ChevronLeft,
  Database,
  FileSearch,
  FolderKanban,
  Home,
  Menu,
  MessageSquare,
  Microscope,
  Moon,
  Network,
  PanelLeftOpen,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Workflow,
  Wrench,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  focusTrapTargetElement,
  getFocusableElements,
  resolveFocusTrapAction,
} from '@/lib/focusTrap'
import { isEditableShortcutTarget } from '@/lib/keyboardShortcuts'
import { useUiStore } from './uiStore'
import { useTheme } from './theme'
import {
  appShellAdvancedActive,
  buildAppShellRailViewModel,
  resolveAppShellActiveNavItem,
  resolveAppShellKeyboardAction,
} from './appShellViewModel'

const primaryGroups = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: Home, end: true },
      { to: '/research/new', label: 'Ask / Research', icon: Microscope },
      { to: '/conversations', label: 'Conversations', icon: MessageSquare },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { to: '/spaces', label: 'Spaces', icon: FolderKanban },
      { to: '/evidence', label: 'Evidence', icon: FileSearch },
    ],
  },
  {
    label: 'Outputs',
    items: [
      { to: '/studio', label: 'Artifact Studio', icon: Blocks },
    ],
  },
]

const advancedItems = [
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/tools', label: 'Tools', icon: Wrench },
  { to: '/models/setup', label: 'Models', icon: Network, matchPrefix: '/models' },
  { to: '/system/status', label: 'System', icon: Activity, matchPrefix: '/system' },
  { to: '/system/backups', label: 'Backups', icon: Archive },
  { to: '/system/settings', label: 'Settings', icon: Settings2 },
]

const mainContentId = 'nexus-main-content'
const CommandPalette = lazy(() => import('@/components/nexus/CommandPalette').then((module) => ({
  default: module.CommandPalette,
})))
const ConceptGuide = lazy(() => import('@/components/nexus/ConceptGuide').then((module) => ({
  default: module.ConceptGuide,
})))

export function AppShell() {
  const location = useLocation()
  const collapsed = useUiStore((state) => state.railCollapsed)
  const toggleRail = useUiStore((state) => state.toggleRail)
  const setRailCollapsed = useUiStore((state) => state.setRailCollapsed)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [conceptGuideOpen, setConceptGuideOpen] = useState(false)
  const [mobileViewport, setMobileViewport] = useState(false)
  const mobileToggleRef = useRef<HTMLButtonElement>(null)
  const previousMobileFocus = useRef<HTMLElement | null>(null)
  const railRef = useRef<HTMLElement>(null)
  const { preference, resolvedTheme, setPreference } = useTheme()
  const activeAdvancedItem = resolveAppShellActiveNavItem(location.pathname, advancedItems)
  const advancedActive = appShellAdvancedActive(location.pathname, advancedItems)
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive)
  const rail = buildAppShellRailViewModel({ mobileViewport, railCollapsed: collapsed })

  const closeMobileRail = () => {
    if (mobileViewport) setRailCollapsed(false)
  }

  const closeMobileRailAndRestoreFocus = () => {
    if (mobileViewport) setRailCollapsed(false)
  }

  const focusMainContent = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    const mainElement = document.getElementById(mainContentId)
    if (!mainElement) return
    event.preventDefault()
    mainElement.focus({ preventScroll: true })
    mainElement.scrollIntoView({ block: 'start' })
  }

  const focusableRailElements = () => {
    return getFocusableElements(railRef.current)
  }

  const keepFocusInsideMobileRail = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!rail.mobileToggleExpanded) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMobileRailAndRestoreFocus()
      return
    }
    const focusables = focusableRailElements()
    const action = resolveFocusTrapAction({
      activeElement: document.activeElement,
      activeInside: Boolean(railRef.current?.contains(document.activeElement)),
      emptyTarget: 'container',
      firstElement: focusables[0],
      key: event.key,
      lastElement: focusables[focusables.length - 1],
      shiftKey: event.shiftKey,
    })
    if (!action.preventDefault) return
    event.preventDefault()
    focusTrapTargetElement({ action, container: railRef.current, focusable: focusables })?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 820px)')
    const update = (event?: MediaQueryListEvent) => setMobileViewport(event?.matches ?? media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveAppShellKeyboardAction({
        ctrlKey: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing,
        key: event.key,
        metaKey: event.metaKey,
        mobileViewport,
        repeat: event.repeat,
        targetEditable: isEditableShortcutTarget(event.target),
      })
      if (action === 'togglePalette') {
        event.preventDefault()
        setPaletteOpen((current) => !current)
        return
      }
      if (action === 'closeMobileRail') {
        event.preventDefault()
        closeMobileRailAndRestoreFocus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileViewport])

  useEffect(() => {
    if (!rail.mobileToggleExpanded) return

    previousMobileFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      const focusTarget = focusableRailElements()[0] ?? railRef.current
      focusTarget?.focus({ preventScroll: true })
    }, 80)

    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      const focusTarget = previousMobileFocus.current
      window.requestAnimationFrame(() => {
        if (focusTarget && document.contains(focusTarget)) {
          focusTarget.focus({ preventScroll: true })
        } else {
          mobileToggleRef.current?.focus({ preventScroll: true })
        }
      })
      previousMobileFocus.current = null
    }
  }, [rail.mobileToggleExpanded])

  useEffect(() => {
    if (mobileViewport) setRailCollapsed(false)
  }, [location.pathname, mobileViewport, setRailCollapsed])

  useEffect(() => {
    if (advancedActive) setAdvancedOpen(true)
  }, [advancedActive])

  return (
    <div className={rail.frameClassName}>
      <a className="skip-link" href={`#${mainContentId}`} onClick={focusMainContent}>Skip to main content</a>
      <button type="button" className="rail-backdrop" onClick={closeMobileRailAndRestoreFocus} aria-hidden={rail.backdropAriaHidden} tabIndex={rail.backdropTabIndex} />
      <aside
        className="app-rail"
        id={rail.railId}
        aria-hidden={rail.railAriaHidden}
        aria-label={rail.railAriaLabel}
        onKeyDown={keepFocusInsideMobileRail}
        ref={railRef}
        tabIndex={rail.mobileToggleExpanded ? -1 : undefined}
      >
        <div className="brand-lockup">
          <span className="brand-mark"><Database size={18} /></span>
          <span className="brand-type"><strong>Nexus</strong><small>evidence workspace</small></span>
          <button type="button" className="icon-button rail-toggle" onClick={toggleRail} aria-controls={rail.railId} aria-expanded={rail.railToggleExpanded} aria-label={rail.railToggleLabel} title={rail.railToggleLabel}>
            {collapsed ? <Menu size={17} /> : <ChevronLeft size={17} />}
          </button>
        </div>
        {collapsed && (
          <button
            type="button"
            className="icon-button rail-expand-button"
            onClick={toggleRail}
            aria-controls={rail.railId}
            aria-expanded={false}
            aria-label={rail.desktopToggleLabel}
            title={rail.desktopToggleLabel}
          >
            <PanelLeftOpen size={17} />
          </button>
        )}
        <nav aria-label="Primary navigation">
          {primaryGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} onClick={closeMobileRail} title={collapsed ? label : undefined} aria-label={label} className={({ isActive }) => isActive ? 'active' : undefined}>
                  <Icon size={17} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
          <details className="nav-more" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary>Advanced <span>6</span></summary>
            {advancedItems.map(({ to, label, icon: Icon }) => {
              const isActive = activeAdvancedItem === to
              return (
                <NavLink key={to} to={to} onClick={closeMobileRail} title={collapsed ? label : undefined} aria-current={isActive ? 'page' : undefined} aria-label={label} className={isActive ? 'active' : undefined}>
                  <Icon size={17} />
                  <span>{label}</span>
                </NavLink>
              )
            })}
          </details>
        </nav>
        <div className="rail-foot">
          <div className="rail-shortcuts">
            <Link to="/?guide=1" onClick={closeMobileRail} aria-label="Open getting started guide" title="Getting started"><Workflow size={15} /><span>Start</span></Link>
            <button type="button" onClick={() => setConceptGuideOpen(true)} aria-label="Open bilingual concept guide" title="Concept guide"><HelpCircle size={15} /><span>Terms</span></button>
            <button type="button" onClick={() => setPreference(resolvedTheme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`} title={`${preference} preference`}>{resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}<span>Theme</span></button>
          </div>
          <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Open command palette"><Sparkles size={15} /><span>Find anything</span><kbd>⌘K</kbd></button>
        </div>
      </aside>
      <main className="app-main" id={mainContentId} tabIndex={-1}>
        <div className="mobile-bar">
          <button type="button" className="icon-button" onClick={toggleRail} ref={mobileToggleRef} aria-controls={rail.railId} aria-expanded={rail.mobileToggleExpanded} aria-label={rail.mobileToggleLabel}><Menu size={18} /></button>
          <strong>Nexus</strong>
          <button className="icon-button" type="button" onClick={() => setPaletteOpen(true)} aria-label="Open global search"><Search size={18} /></button>
        </div>
        <Outlet />
      </main>
      {paletteOpen && <Suspense fallback={null}><CommandPalette open onClose={() => setPaletteOpen(false)} /></Suspense>}
      {conceptGuideOpen && <Suspense fallback={null}><ConceptGuide open onClose={() => setConceptGuideOpen(false)} /></Suspense>}
    </div>
  )
}
