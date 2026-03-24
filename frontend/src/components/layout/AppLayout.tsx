import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Database, Settings, MessageSquare, User, Moon, Sun, Network } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
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
  label,
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
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-all duration-200',
        'ring-1 ring-inset',
        active
          ? 'bg-gradient-to-br from-indigo-500/75 to-violet-600/65 text-white ring-2 ring-indigo-300/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_28px_-6px_rgba(67,56,202,0.55)]'
          : 'bg-white/[0.06] text-slate-400 ring-white/[0.08] hover:bg-white/[0.1] hover:text-slate-100 hover:ring-white/12 active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a2332]'
      )}
    >
      {icon}
      <span className="pointer-events-none absolute left-[calc(100%+10px)] z-50 hidden whitespace-nowrap rounded-lg border border-white/10 bg-slate-950/95 px-2.5 py-1 text-xs font-medium text-slate-100 shadow-lg shadow-black/40 backdrop-blur-sm group-hover:block group-focus-visible:block">
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
      <aside className="z-50 flex w-16 shrink-0 flex-col items-center justify-between border-r border-white/10 bg-gradient-to-b from-slate-800 via-slate-800 to-indigo-950 py-5 text-slate-200 shadow-[4px_0_24px_-4px_rgba(0,0,0,0.2)]">
        <div className="flex w-full flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            title="首页"
            aria-label="返回首页"
            className={cn(
              'flex h-[3.35rem] w-[3.35rem] shrink-0 items-center justify-center overflow-hidden rounded-full p-0 transition-all duration-200',
              'bg-transparent hover:opacity-90 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e293b]'
            )}
          >
            <img
              src="/logo.png"
              alt=""
              className="h-full w-full origin-center scale-[1.14] object-contain object-center select-none"
              width={54}
              height={54}
              decoding="async"
              draggable={false}
            />
          </button>

          <div className="flex w-full flex-col items-center gap-2">
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

        <div className="flex w-full flex-col items-center gap-2.5 pb-0.5">
          <button
            type="button"
            onClick={toggleTheme}
            title="切换主题"
            aria-label="切换主题"
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 transition-all duration-200 ring-1 ring-inset ring-white/[0.08]',
              'bg-white/[0.06] hover:bg-white/[0.1] hover:text-slate-100 hover:ring-white/12 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e293b]'
            )}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" strokeWidth={2.25} /> : <Moon className="h-5 w-5" strokeWidth={2.25} />}
          </button>

          <span title="用户" className="block">
            <Avatar
              size="lg"
              fallback={<User className="h-5 w-5 text-white" strokeWidth={2} aria-hidden />}
              rootClassName="bg-gradient-to-br from-indigo-500/85 to-violet-600/85 text-white ring-1 ring-inset ring-white/20 shadow-md shadow-black/25"
              fallbackClassName="bg-transparent text-white"
            />
          </span>
        </div>
      </aside>

      {/* 主内容区域：三视图常驻挂载，按路径显隐，避免对话页跳转时卸载中断流式等 */}
      <div className="flex min-w-0 flex-1 flex-col p-2 md:p-3 relative overflow-hidden">
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
