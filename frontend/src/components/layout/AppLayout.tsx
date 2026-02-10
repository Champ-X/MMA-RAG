import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Database, Settings, MessageSquare, Layers, User, Moon, Sun, Network } from 'lucide-react'
import { InspectorDrawer } from '@/components/debug/InspectorDrawer'
import { useChatStore } from '@/store/useChatStore'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import ChatInterface from '@/components/chat/ChatInterface'
import KnowledgeList from '@/components/knowledge/KnowledgeList'
import { SettingsPage } from '@/pages/SettingsPage'
import { ArchitecturePage } from '@/pages/ArchitecturePage'

function NavButton({ 
  active, 
  onClick, 
  icon, 
  label 
}: { 
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'group relative grid h-11 w-11 place-items-center rounded-xl transition-all duration-200',
        active
          ? 'bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white shadow-inner shadow-white/10'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-100 active:scale-95'
      )}
    >
      {icon}
      <span className="pointer-events-none absolute left-14 hidden rounded-lg bg-slate-950/80 px-2 py-1 text-xs text-slate-100 shadow-lg shadow-black/30 group-hover:block z-50">
        {label}
      </span>
    </button>
  )
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getActiveSession } = useChatStore()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const { theme, setTheme } = useTheme()

  const session = getActiveSession()
  const lastAssistant = session?.messages
    .filter((m) => m.role === 'assistant')
    .pop()
  const citations = lastAssistant?.citations ?? []

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const getActiveView = () => {
    if (location.pathname === '/') return 'chat'
    if (location.pathname === '/knowledge') return 'knowledge'
    if (location.pathname === '/settings') return 'settings'
    if (location.pathname === '/architecture') return 'architecture'
    return 'chat'
  }

  const activeView = getActiveView()

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-slate-50 to-indigo-50 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950">
      {/* 左侧深色导航栏 */}
      <aside className="flex w-16 flex-col items-center justify-between bg-gradient-to-b from-slate-950 to-indigo-950 py-4 text-slate-200 flex-shrink-0 z-50">
        <div className="flex w-full flex-col items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 shadow-lg shadow-fuchsia-500/10">
            <Layers className="h-5 w-5 text-white" />
          </div>

          <div className="mt-2 flex w-full flex-col items-center gap-1">
            <NavButton 
              active={activeView === 'chat'} 
              onClick={() => navigate('/')} 
              icon={<MessageSquare size={20} />} 
              label="对话"
            />
            <NavButton 
              active={activeView === 'knowledge'} 
              onClick={() => navigate('/knowledge')} 
              icon={<Database size={20} />} 
              label="知识库"
            />
            <NavButton 
              active={activeView === 'architecture'} 
              onClick={() => navigate('/architecture')} 
              icon={<Network size={20} />} 
              label="架构"
            />
            <NavButton 
              active={activeView === 'settings'} 
              onClick={() => navigate('/settings')} 
              icon={<Settings size={20} />} 
              label="设置"
            />
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-2 pb-1">
          <button
            type="button"
            onClick={toggleTheme}
            title="切换主题"
            className="grid h-11 w-11 place-items-center rounded-xl text-slate-300 transition-all duration-200 hover:bg-white/5 hover:text-white active:scale-95"
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          <div
            title="用户"
            className="grid h-11 w-11 place-items-center rounded-xl bg-white/5 text-slate-200 ring-1 ring-white/10"
          >
            <User className="h-5 w-5" />
          </div>
        </div>
      </aside>

      {/* 主内容区域：三视图常驻挂载，按路径显隐，避免对话页跳转时卸载中断流式等 */}
      <div className="flex min-w-0 flex-1 flex-col p-4 md:p-6 relative overflow-hidden">
        <div
          className={cn('flex-1 min-h-0 overflow-hidden', location.pathname !== '/' && 'hidden')}
          aria-hidden={location.pathname !== '/'}
        >
          <ChatInterface />
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden', location.pathname !== '/knowledge' && 'hidden')}
          aria-hidden={location.pathname !== '/knowledge'}
        >
          <KnowledgeList />
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden', location.pathname !== '/settings' && 'hidden')}
          aria-hidden={location.pathname !== '/settings'}
        >
          <SettingsPage />
        </div>
        <div
          className={cn('flex-1 min-h-0 overflow-hidden', location.pathname !== '/architecture' && 'hidden')}
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
