import { useEffect, useState } from 'react'
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
import { CommandPalette } from '@/components/nexus/CommandPalette'
import { ConceptGuide } from '@/components/nexus/ConceptGuide'
import { useUiStore } from './uiStore'
import { useTheme } from './theme'

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
  { to: '/models/setup', label: 'Models', icon: Network },
  { to: '/system/status', label: 'System', icon: Activity },
  { to: '/system/backups', label: 'Backups', icon: Archive },
  { to: '/system/settings', label: 'Settings', icon: Settings2 },
]

export function AppShell() {
  const location = useLocation()
  const collapsed = useUiStore((state) => state.railCollapsed)
  const toggleRail = useUiStore((state) => state.toggleRail)
  const setRailCollapsed = useUiStore((state) => state.setRailCollapsed)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [conceptGuideOpen, setConceptGuideOpen] = useState(false)
  const { preference, resolvedTheme, setPreference } = useTheme()
  const advancedActive = advancedItems.some((item) => location.pathname.startsWith(item.to.split('/').slice(0, 2).join('/')))
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive)

  const closeMobileRail = () => {
    if (window.matchMedia('(max-width: 820px)').matches) setRailCollapsed(false)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((current) => !current)
      }
      if (event.key === 'Escape' && window.matchMedia('(max-width: 820px)').matches) {
        setRailCollapsed(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setRailCollapsed])

  useEffect(() => {
    if (window.matchMedia('(max-width: 820px)').matches) setRailCollapsed(false)
  }, [location.pathname, setRailCollapsed])

  useEffect(() => {
    if (advancedActive) setAdvancedOpen(true)
  }, [advancedActive])

  return (
    <div className={`app-frame ${collapsed ? 'rail-collapsed' : ''}`}>
      <button className="rail-backdrop" onClick={() => setRailCollapsed(false)} aria-label="Close navigation" tabIndex={collapsed ? 0 : -1} />
      <aside className="app-rail">
        <div className="brand-lockup">
          <span className="brand-mark"><Database size={18} /></span>
          <span className="brand-type"><strong>Nexus</strong><small>evidence workspace</small></span>
          <button className="icon-button rail-toggle" onClick={toggleRail} aria-label="Toggle navigation">
            {collapsed ? <Menu size={17} /> : <ChevronLeft size={17} />}
          </button>
        </div>
        {collapsed && (
          <button
            className="icon-button rail-expand-button"
            onClick={toggleRail}
            aria-label="Expand navigation"
            title="Expand navigation"
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
            {advancedItems.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={closeMobileRail} title={collapsed ? label : undefined} aria-label={label} className={({ isActive }) => isActive ? 'active' : undefined}>
                <Icon size={17} />
                <span>{label}</span>
              </NavLink>
            ))}
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
      <main className="app-main">
        <div className="mobile-bar">
          <button className="icon-button" onClick={toggleRail} aria-label="Open navigation"><Menu size={18} /></button>
          <strong>Nexus</strong>
          <button className="icon-button" type="button" onClick={() => setPaletteOpen(true)} aria-label="Open global search"><Search size={18} /></button>
        </div>
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ConceptGuide open={conceptGuideOpen} onClose={() => setConceptGuideOpen(false)} />
    </div>
  )
}
