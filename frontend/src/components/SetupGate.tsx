import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { SetupError, setupApi } from '@/services/setup'

export function SetupGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [state, setState] = useState<'loading' | 'setup' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (location.pathname === '/setup') return
    let active = true
    setState('loading')
    setupApi.status().then(status => {
      if (active) setState(status.managed && status.setup_required ? 'setup' : 'ready')
    }).catch(error => {
      if (active) setState(error instanceof SetupError && error.status === 404 ? 'ready' : 'error')
    })
    return () => { active = false }
  }, [location.pathname === '/setup', attempt])
  if (location.pathname === '/setup' || state === 'ready') return children
  if (state === 'setup') return <Navigate to="/setup" replace />
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
    <p role="status">{state === 'error' ? '暂时无法连接 Tessmora。确认服务已启动后重试。' : '正在连接 Tessmora…'}</p>
    {state === 'error' && <button className="rounded-lg border px-6 py-3" onClick={() => setAttempt(value => value + 1)}>重新连接</button>}
  </main>
}
