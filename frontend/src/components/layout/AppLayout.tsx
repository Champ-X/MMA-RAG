import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useChatStore } from '@/store/useChatStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import ChatInterface from '@/components/chat/ChatInterface'
import { ConversationSidebar, type SidebarView } from './ConversationSidebar'

const KnowledgeList = lazy(() => import('@/components/knowledge/KnowledgeList'))

const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
)

const ArchitecturePage = lazy(() =>
  import('@/pages/ArchitecturePage').then((module) => ({ default: module.ArchitecturePage }))
)

const InspectorDrawer = lazy(() =>
  import('@/components/debug/InspectorDrawer').then((module) => ({ default: module.InspectorDrawer }))
)

function RoutePanelLoading({ label }: { label: string }) {
  return (
    <div
      className="flex h-full min-h-0 items-center justify-center"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 text-sm font-medium text-slate-500 shadow-sm ring-1 ring-white/70 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-400 dark:ring-white/[0.04]">
        {label}
      </div>
    </div>
  )
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    sessions,
    activeSessionId,
    getActiveSession,
    createSession,
    createSessionFromApi,
    switchSession,
    deleteSession,
  } = useChatStore()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [hasVisitedKnowledge, setHasVisitedKnowledge] = useState(
    () => location.pathname === '/knowledge'
  )
  const [hasVisitedSettings, setHasVisitedSettings] = useState(
    () => location.pathname === '/settings'
  )
  const [hasVisitedArchitecture, setHasVisitedArchitecture] = useState(
    () => location.pathname === '/architecture'
  )
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { config, updateSystemConfig, markAsSaved, loadConfig } = useConfigStore()
  const fetchKnowledgeBases = useKnowledgeStore((state) => state.fetchKnowledgeBases)

  const session = getActiveSession()
  const lastAssistant = session?.messages
    .filter((m) => m.role === 'assistant')
    .pop()
  const citations = lastAssistant?.citations ?? []
  const pathname = location.pathname

  const toggleTheme = () => {
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    updateSystemConfig({ theme: nextTheme })
    markAsSaved()
  }

  const getActiveView = (): SidebarView => {
    if (pathname === '/') return 'chat'
    if (pathname === '/knowledge') return 'knowledge'
    if (pathname === '/settings') return 'settings'
    if (pathname === '/architecture') return 'architecture'
    return 'chat'
  }

  const activeView = getActiveView()
  const isChatActive = pathname === '/'
  const isKnowledgeActive = pathname === '/knowledge'
  const isSettingsActive = pathname === '/settings'
  const isArchitectureActive = pathname === '/architecture'

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (config.theme && theme !== config.theme) {
      setTheme(config.theme)
    }
  }, [config.theme, setTheme, theme])

  useEffect(() => {
    void fetchKnowledgeBases()
  }, [fetchKnowledgeBases])

  useEffect(() => {
    if (isKnowledgeActive) {
      setHasVisitedKnowledge(true)
    }
  }, [isKnowledgeActive])

  useEffect(() => {
    if (isSettingsActive) {
      setHasVisitedSettings(true)
    }
  }, [isSettingsActive])

  useEffect(() => {
    if (isArchitectureActive) {
      setHasVisitedArchitecture(true)
    }
  }, [isArchitectureActive])

  const handleNewConversation = () => {
    navigate('/')
    void createSessionFromApi().catch(() => createSession())
  }

  const handleSelectConversation = (sessionId: string) => {
    switchSession(sessionId)
    navigate('/')
  }

  const handleNavigate = (view: Exclude<SidebarView, 'chat'>) => {
    const pathByView = {
      knowledge: '/knowledge',
      architecture: '/architecture',
      settings: '/settings',
    }
    navigate(pathByView[view])
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc] text-[#182230] dark:bg-slate-950 dark:text-slate-100">
      <ConversationSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        activeView={activeView}
        collapsed={sidebarCollapsed}
        isDark={resolvedTheme === 'dark'}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onToggleTheme={toggleTheme}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={deleteSession}
        onNavigate={handleNavigate}
      />

      {/* 主内容区域：核心视图常驻挂载；架构页首次访问后常驻，避免对话页跳转时卸载中断流式等 */}
      <main
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfcfe] dark:bg-slate-950"
        aria-label="主内容区"
      >
        <div
          className={cn('flex-1 min-h-0 overflow-hidden', !isChatActive && 'hidden')}
          aria-hidden={!isChatActive}
          aria-label="对话工作区"
          hidden={!isChatActive}
          role="region"
        >
          <ChatInterface />
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden p-2 md:p-3', !isKnowledgeActive && 'hidden')}
          aria-hidden={!isKnowledgeActive}
          aria-label="知识库工作台"
          hidden={!isKnowledgeActive}
          role="region"
        >
          {(isKnowledgeActive || hasVisitedKnowledge) ? (
            <Suspense fallback={<RoutePanelLoading label="正在载入知识库工作台…" />}>
              <KnowledgeList />
            </Suspense>
          ) : null}
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden p-2 md:p-3', !isSettingsActive && 'hidden')}
          aria-hidden={!isSettingsActive}
          aria-label="设置中心"
          hidden={!isSettingsActive}
          role="region"
        >
          {(isSettingsActive || hasVisitedSettings) ? (
            <Suspense fallback={<RoutePanelLoading label="正在载入设置中心…" />}>
              <SettingsPage />
            </Suspense>
          ) : null}
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden p-2 md:p-3', !isArchitectureActive && 'hidden')}
          aria-hidden={!isArchitectureActive}
          aria-label="架构导读"
          hidden={!isArchitectureActive}
          role="region"
        >
          {(isArchitectureActive || hasVisitedArchitecture) ? (
            <Suspense fallback={<RoutePanelLoading label="正在载入架构导读…" />}>
              <ArchitecturePage />
            </Suspense>
          ) : null}
        </div>
      </main>

      {inspectorOpen ? (
        <Suspense fallback={null}>
          <InspectorDrawer
            isOpen={inspectorOpen}
            onClose={() => setInspectorOpen(false)}
            citations={citations}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
