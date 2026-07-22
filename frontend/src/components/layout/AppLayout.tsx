import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { InspectorDrawer } from '@/components/debug/InspectorDrawer'
import { useChatStore } from '@/store/useChatStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import ChatInterface from '@/components/chat/ChatInterface'
import KnowledgeList from '@/components/knowledge/KnowledgeList'
import { SettingsPage } from '@/pages/SettingsPage'
import { ArchitecturePage } from '@/pages/ArchitecturePage'
import { ConversationSidebar, type SidebarView } from './ConversationSidebar'

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
  const { resolvedTheme, setTheme } = useTheme()
  const { updateSystemConfig, markAsSaved } = useConfigStore()

  const session = getActiveSession()
  const lastAssistant = session?.messages
    .filter((m) => m.role === 'assistant')
    .pop()
  const citations = lastAssistant?.citations ?? []

  const toggleTheme = () => {
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    updateSystemConfig({ theme: nextTheme })
    markAsSaved()
  }

  const getActiveView = (): SidebarView => {
    if (location.pathname === '/') return 'chat'
    if (location.pathname === '/knowledge') return 'knowledge'
    if (location.pathname === '/settings') return 'settings'
    if (location.pathname === '/architecture') return 'architecture'
    return 'chat'
  }

  const activeView = getActiveView()

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

      {/* 主内容区域：三视图常驻挂载，按路径显隐，避免对话页跳转时卸载中断流式等 */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfcfe] dark:bg-slate-950">
        <div
          className={cn('flex-1 min-h-0 overflow-hidden', location.pathname !== '/' && 'hidden')}
          aria-hidden={location.pathname !== '/'}
        >
          <ChatInterface />
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden p-2 md:p-3', location.pathname !== '/knowledge' && 'hidden')}
          aria-hidden={location.pathname !== '/knowledge'}
        >
          <KnowledgeList />
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden p-2 md:p-3', location.pathname !== '/settings' && 'hidden')}
          aria-hidden={location.pathname !== '/settings'}
        >
          <SettingsPage />
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden p-2 md:p-3', location.pathname !== '/architecture' && 'hidden')}
          aria-hidden={location.pathname !== '/architecture'}
        >
          <ArchitecturePage />
        </div>
      </div>

      <InspectorDrawer
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        citations={citations as any}
      />
    </div>
  )
}
